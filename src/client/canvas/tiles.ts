// Cards drawn ahead into tiles (docs/CANVAS.md, "Drawn cards"): when the
// caller can draw a card (CanvasProps.drawCard), cards that aren't mounted
// are drawn from these tiles, not card by card on every frame. Like a map's:
// the world is cut into squares of TILE device pixels at a level L (2^L
// device pixels a world unit), each drawn once into its own canvas, a few
// cards at a time when the main thread is idle, and blitted with the view.
// A frame shows the level nearest above the view's scale; a tile not drawn
// yet is stood in for by a coarser or finer one already drawn, else the
// caller's plain boxes. A card that changes marks the tiles it was and is
// on stale: they keep showing until drawn again.
import { intersects, type Rect, type View } from "./geometry.ts";

/** Device pixels a tile is wide and tall. */
export const TILE = 512;

export type TileItem = { id: string; rect: Rect; version: unknown };
export type DrawItem = (g: CanvasRenderingContext2D, id: string, scale: number) => void;

/** The level of tiles for a view `d` device pixels a world unit: the nearest at or above (sharp), at most `maxL`. */
export const tileLevel = (d: number, maxL: number): number => Math.min(maxL, Math.ceil(Math.log2(d) - 1e-9)) | 0;

/** The tiles (column/row range) of level L that cover world rect r. */
export function tileRange(r: Rect, L: number): { i0: number; i1: number; j0: number; j1: number; size: number } {
  const size = TILE / 2 ** L;
  return { i0: Math.floor(r.x / size), i1: Math.floor((r.x + r.w) / size), j0: Math.floor(r.y / size), j1: Math.floor((r.y + r.h) / size), size };
}

type Tile = {
  L: number;
  i: number;
  j: number;
  /** What's shown (null until first drawn). */
  shown: HTMLCanvasElement | null;
  /** Needs (re)drawing. */
  stale: boolean;
  /** A drawing under way: the canvas and the items left. */
  work: { canvas: HTMLCanvasElement; todo: number[] } | null;
  used: number;
};

const BUCKET = 2048;

export class Tiles {
  private items: TileItem[] = [];
  private byId = new Map<string, TileItem>();
  private buckets = new Map<string, number[]>();
  private tiles = new Map<string, Tile>();
  private spare: HTMLCanvasElement[] = [];
  private frame = 0;
  private draw: DrawItem;
  /** Most tiles kept (each TILE² × 4 bytes). */
  max: number;

  constructor(draw: DrawItem, max = 96) {
    this.draw = draw;
    this.max = max;
  }

  /** Every card looks different (the caller's drawing changed): every tile is stale. */
  invalidate(): void {
    for (const t of this.tiles.values()) t.stale = true;
  }

  /** The cards to draw; tiles under one that changed (moved, resized, new version), came or went become stale. */
  setItems(items: TileItem[]): void {
    const next = new Map(items.map((it) => [it.id, it]));
    const dirty: Rect[] = [];
    for (const it of items) {
      const old = this.byId.get(it.id);
      if (!old) dirty.push(it.rect);
      else if (old.version !== it.version || old.rect.x !== it.rect.x || old.rect.y !== it.rect.y || old.rect.w !== it.rect.w || old.rect.h !== it.rect.h)
        dirty.push(old.rect, it.rect);
    }
    for (const [id, old] of this.byId) if (!next.has(id)) dirty.push(old.rect);
    this.items = items;
    this.byId = next;
    this.buckets.clear();
    items.forEach((it, n) => {
      for (let i = Math.floor(it.rect.x / BUCKET); i <= Math.floor((it.rect.x + it.rect.w) / BUCKET); i++)
        for (let j = Math.floor(it.rect.y / BUCKET); j <= Math.floor((it.rect.y + it.rect.h) / BUCKET); j++) {
          const k = `${i},${j}`;
          let b = this.buckets.get(k);
          if (!b) this.buckets.set(k, (b = []));
          b.push(n);
        }
    });
    if (!dirty.length) return;
    for (const t of this.tiles.values()) {
      const r = this.rectOf(t);
      if (dirty.some((d) => intersects(d, r))) t.stale = true;
    }
  }

  private rectOf(t: { L: number; i: number; j: number }): Rect {
    const size = TILE / 2 ** t.L;
    return { x: t.i * size, y: t.j * size, w: size, h: size };
  }

  private itemsIn(r: Rect): number[] {
    const out = new Set<number>();
    for (let i = Math.floor(r.x / BUCKET); i <= Math.floor((r.x + r.w) / BUCKET); i++)
      for (let j = Math.floor(r.y / BUCKET); j <= Math.floor((r.y + r.h) / BUCKET); j++)
        for (const n of this.buckets.get(`${i},${j}`) ?? []) if (intersects(this.items[n].rect, r)) out.add(n);
    return [...out].sort((a, b) => a - b);
  }

  private tile(L: number, i: number, j: number, create: boolean): Tile | undefined {
    const k = `${L}/${i}/${j}`;
    let t = this.tiles.get(k);
    if (!t && create) this.tiles.set(k, (t = { L, i, j, shown: null, stale: true, work: null, used: this.frame }));
    return t;
  }

  /**
   * Draws the tiles for a view onto `g` (device pixels, identity transform):
   * level L, else stand-ins. Returns the world rects nothing covered, and
   * whether tiles are still to be drawn (call work()).
   */
  paint(g: CanvasRenderingContext2D, v: View, vis: Rect, dpr: number, maxL: number): { missing: Rect[]; pending: boolean } {
    this.frame++;
    const L = tileLevel(v.k * dpr, maxL);
    const { i0, i1, j0, j1, size } = tileRange(vis, L);
    const missing: Rect[] = [];
    let pending = false;
    // Device pixel edges of a world x/y, rounded so neighbouring tiles meet.
    const X = (wx: number) => Math.round((wx * v.k + v.x) * dpr);
    const Y = (wy: number) => Math.round((wy * v.k + v.y) * dpr);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const t = this.tile(L, i, j, true)!;
        t.used = this.frame;
        if (t.stale || t.work) pending = true;
        const r = { x: i * size, y: j * size, w: size, h: size };
        if (t.shown) {
          g.drawImage(t.shown, X(r.x), Y(r.y), X(r.x + size) - X(r.x), Y(r.y + size) - Y(r.y));
          continue;
        }
        if (!this.itemsIn(r).length) continue;
        // Stand-ins: a coarser tile's part, else finer tiles.
        let done = false;
        for (let up = 1; up <= 3 && !done; up++) {
          const f = 2 ** up;
          const p = this.tile(L - up, Math.floor(i / f), Math.floor(j / f), false);
          if (!p?.shown) continue;
          p.used = this.frame;
          const sx = ((i - p.i * f) * TILE) / f, sy = ((j - p.j * f) * TILE) / f;
          g.drawImage(p.shown, sx, sy, TILE / f, TILE / f, X(r.x), Y(r.y), X(r.x + size) - X(r.x), Y(r.y + size) - Y(r.y));
          done = true;
        }
        if (done) continue;
        let kids = 0;
        for (let dj = 0; dj < 2; dj++)
          for (let di = 0; di < 2; di++) {
            const c = this.tile(L + 1, 2 * i + di, 2 * j + dj, false);
            const cr = { x: r.x + (di * size) / 2, y: r.y + (dj * size) / 2, w: size / 2, h: size / 2 };
            if (c?.shown) {
              c.used = this.frame;
              g.drawImage(c.shown, X(cr.x), Y(cr.y), X(cr.x + cr.w) - X(cr.x), Y(cr.y + cr.h) - Y(cr.y));
              kids++;
            } else missing.push(cr);
          }
        if (kids === 0) missing.splice(missing.length - 4, 4, r);
      }
    this.evict();
    return { missing, pending };
  }

  private evict(): void {
    if (this.tiles.size <= this.max) return;
    const old = [...this.tiles.entries()].filter(([, t]) => t.used < this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [k, t] of old.slice(0, this.tiles.size - this.max)) {
      this.tiles.delete(k);
      if (t.shown) this.spare.push(t.shown);
      if (t.work) this.spare.push(t.work.canvas);
    }
    this.spare.length = Math.min(this.spare.length, 8);
  }

  /** A blank tile canvas (setting its size clears it). */
  private canvas(): HTMLCanvasElement {
    const c = this.spare.pop() ?? document.createElement("canvas");
    c.width = c.height = TILE;
    return c;
  }

  /**
   * Draws stale tiles of the last frame's (those nearest `center` first)
   * for up to `ms`; returns whether any tile became ready (redraw) and
   * whether more are left.
   */
  work(ms: number, center: { x: number; y: number }): { ready: boolean; more: boolean } {
    const t0 = performance.now();
    const todo = [...this.tiles.values()]
      .filter((t) => t.used === this.frame && (t.stale || t.work))
      .sort((a, b) => dist(this.rectOf(a), center) - dist(this.rectOf(b), center));
    let ready = false;
    for (const t of todo) {
      if (performance.now() - t0 > ms) return { ready, more: true };
      if (!t.work || t.stale) {
        const r = this.rectOf(t);
        const todoItems = this.itemsIn(r);
        if (t.work) this.spare.push(t.work.canvas);
        t.stale = false;
        if (!todoItems.length) {
          if (t.shown) this.spare.push(t.shown);
          t.shown = null;
          t.work = null;
          continue;
        }
        t.work = { canvas: this.canvas(), todo: todoItems };
      }
      const w = t.work!;
      const g = w.canvas.getContext("2d")!;
      const s = 2 ** t.L;
      const size = TILE / s;
      while (w.todo.length && performance.now() - t0 <= ms) {
        const it = this.items[w.todo.shift()!];
        g.setTransform(s, 0, 0, s, -t.i * size * s, -t.j * size * s);
        g.save();
        g.translate(it.rect.x, it.rect.y);
        this.draw(g, it.id, s);
        g.restore();
      }
      if (w.todo.length) return { ready, more: true };
      if (t.shown) this.spare.push(t.shown);
      t.shown = w.canvas;
      t.work = null;
      ready = true;
    }
    return { ready, more: false };
  }

  /** Forget every tile (e.g. the theme changed). */
  clear(): void {
    this.tiles.clear();
  }
}

const dist = (r: Rect, p: { x: number; y: number }) => Math.hypot(r.x + r.w / 2 - p.x, r.y + r.h / 2 - p.y);
