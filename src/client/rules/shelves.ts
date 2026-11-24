// The rules canvas's layout ("shelves", docs/CANVAS.md): a region per kind
// of entry across every book (./regions.ts), and in each region the book's
// own groups as labelled shelves stacked top to bottom, each holding its
// cards A–Z in balanced columns read top to bottom, left to right, like a
// dictionary's. Regions stand side by side, each as many columns wide as it
// takes to be about as tall as the others, the whole board about `aspect`
// wide for its height. Worked out in the browser from the cards' sizes (the
// server's heights) whenever the visible books change: a few milliseconds.
// Also here, as pure functions: the A–Z index drawn over a region when its
// cards are too small to tell apart, card titles' lines, the right-angled
// route of a wire along the gutters, and the view that keeps a card still
// when the layout changes. Deterministic; no DOM.
import type { Point, Rect, View } from "../canvas/geometry.ts";
import { faceFor, textWidth, type Face } from "../../shared/layout/text.ts";

export type ShelfCard = {
  id: string;
  region: string;
  /** The shelf's label: the book's group ("" for none). */
  shelf: string;
  /** Sorted by (A–Z). */
  name: string;
  w: number;
  h: number;
};

export type ShelfRegion = {
  id: string;
  /** A shelf labelled with the region's own title shows no label. */
  title: string;
};

export type ShelfOptions = {
  /** Between a column's cards. */
  gap?: number;
  /** Between columns (the gutters wires run along). */
  colGap?: number;
  /** Inside a region's edge. */
  padding?: number;
  /** Room above a labelled shelf's cards for its label. */
  labelH?: number;
  /** Between a shelf and the next one's label. */
  shelfGap?: number;
  /** Between a region's stacks of shelves. */
  stackGap?: number;
  /** Between regions (their titles are drawn above them). */
  regionGap?: number;
  /** Width over height the whole board aims for. */
  aspect?: number;
  /** Shelves' order in a region (lower first); ties A–Z by label. */
  shelfRank?: (region: string, shelf: string) => number;
};

export type ShelfColumn = { x: number; w: number; ids: string[] };

export type Shelf = {
  id: string;
  region: string;
  /** Its stack (index into stacks). */
  stack: number;
  /** Drawn above its cards ("" for none). */
  label: string;
  /** Top-left of the shelf, label included. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where its cards start. */
  top: number;
  cols: ShelfColumn[];
  /** The ids of its cards, A–Z. */
  ids: string[];
};

/** Shelves one above another within a region (a region has one or more, side by side). */
export type Stack = { region: string; x: number; y: number; w: number; h: number; shelves: number[] };

export type ShelfLayout = {
  positions: Map<string, Point>;
  regions: Map<string, Rect>;
  shelves: Shelf[];
  /** Left to right across the board. */
  stacks: Stack[];
  /** Each card's shelf (index into shelves) and column. */
  place: Map<string, { shelf: number; col: number }>;
  bounds: Rect;
  /** Options as used (defaults filled in). */
  o: Required<Omit<ShelfOptions, "shelfRank">>;
};

export const SHELF_DEFAULTS: Required<Omit<ShelfOptions, "shelfRank">> = {
  gap: 16, colGap: 32, padding: 32, labelH: 150, shelfGap: 64, stackGap: 64, regionGap: 240, aspect: 1.6,
};

const collator = typeof Intl !== "undefined" ? new Intl.Collator("en", { sensitivity: "base", numeric: true }) : null;
const lead = /^[^\p{L}\p{N}]+/u;
/** A–Z as an index has it: word by word ("Bolt Pistol" before "Bolter"), case and accents aside, numbers by value, leading punctuation ("’Ead Butt") ignored. */
export const compareNames = (a: string, b: string): number => {
  a = a.replace(lead, "");
  b = b.replace(lead, "");
  return collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
};

type Run = { ids: string[]; w: number; h: number };
type Packed = { cols: Run[]; w: number; h: number };

/**
 * `cards` (in order) in at most k columns, cut where the tallest column is
 * lowest (bisection on its height, then greedy), each column as wide as its
 * widest card.
 */
export function columns(cards: readonly { id: string; w: number; h: number }[], k: number, gap: number, colGap: number): Packed {
  const n = cards.length;
  if (!n) return { cols: [], w: 0, h: 0 };
  k = Math.max(1, Math.min(k, n));
  let lo = 0, total = 0;
  for (const c of cards) {
    lo = Math.max(lo, c.h);
    total += c.h + gap;
  }
  // How many columns cards take if none may be taller than `limit`.
  const need = (limit: number) => {
    let cols = 1, h = -gap;
    for (const c of cards) {
      if (h + gap + c.h > limit + 1e-6) {
        cols++;
        h = c.h;
      } else h += gap + c.h;
    }
    return cols;
  };
  let hi = total;
  if (k === 1) lo = hi;
  else
    for (let i = 0; i < 40 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2;
      if (need(mid) <= k) hi = mid;
      else lo = mid;
    }
  const cols: Run[] = [];
  let cur: Run | null = null;
  for (const c of cards) {
    if (!cur || cur.h + gap + c.h > hi + 1e-6) {
      cur = { ids: [c.id], w: c.w, h: c.h };
      cols.push(cur);
    } else {
      cur.ids.push(c.id);
      cur.h += gap + c.h;
      cur.w = Math.max(cur.w, c.w);
    }
  }
  let w = -colGap, h = 0;
  for (const r of cols) {
    w += r.w + colGap;
    h = Math.max(h, r.h);
  }
  return { cols, w, h };
}

/** A region's shelf: the book's group, its label ("" for none: the region's own title, or no group), its cards A–Z. */
export type ShelfGroup<C extends ShelfCard = ShelfCard> = { region: string; name: string; label: string; cards: C[] };

/**
 * The cards on their shelves: region by region (in `regions` order), each
 * region's shelves in book order (`rank`, ties A–Z), each shelf's cards A–Z.
 * What the canvas lays out, and what the rules page lists. Pure.
 */
export function groupShelves<C extends ShelfCard>(regions: readonly ShelfRegion[], cards: readonly C[], rank: (region: string, shelf: string) => number = () => 0): ShelfGroup<C>[] {
  const regionShelves = new Map<string, ShelfGroup<C>[]>(regions.map((r) => [r.id, []]));
  const titles = new Map(regions.map((r) => [r.id, r.title]));
  for (const c of cards) {
    const list = regionShelves.get(c.region);
    if (!list) continue;
    let s = list.find((x) => x.name === c.shelf);
    if (!s) list.push((s = { region: c.region, name: c.shelf, label: c.shelf === titles.get(c.region) ? "" : c.shelf, cards: [] }));
    s.cards.push(c);
  }
  for (const [region, list] of regionShelves) {
    list.sort((a, b) => rank(region, a.name) - rank(region, b.name) || compareNames(a.name, b.name));
    for (const s of list) s.cards.sort((a, b) => compareNames(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return [...regionShelves.values()].flat();
}

export function layoutShelves(regions: readonly ShelfRegion[], cards: readonly ShelfCard[], opts: ShelfOptions = {}): ShelfLayout {
  const o = { ...SHELF_DEFAULTS, ...opts };
  const byId = new Map(cards.map((c) => [c.id, c]));
  // Each region's shelves, in order, each with its cards A–Z.
  type S = ShelfGroup & { memo: Map<number, Packed> };
  const regionShelves = new Map<string, S[]>(regions.map((r) => [r.id, []]));
  for (const g of groupShelves(regions, cards, opts.shelfRank)) regionShelves.get(g.region)!.push({ ...g, memo: new Map() });
  const packed = (s: S, k: number) => {
    const kk = Math.min(k, s.cards.length);
    let p = s.memo.get(kk);
    if (!p) s.memo.set(kk, (p = columns(s.cards, kk, o.gap, o.colGap)));
    return p;
  };
  // The fewest columns that keep a shelf's cards within `limit` tall (or as low as they go).
  const fewest = (s: S, limit: number) => {
    let lo = 1, hi = s.cards.length;
    if (packed(s, hi).h > limit) limit = packed(s, hi).h;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (packed(s, mid).h <= limit + 1e-6) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  type Plan = { stacks: { items: { s: S; p: Packed }[]; w: number; h: number }[]; w: number; h: number };
  // A region within `limit` tall: its shelves (each within `colH`) flow down a
  // stack and on into the next, side by side. The narrowest of a few `colH`s.
  const plan = (list: S[], limit: number): Plan => {
    let best: Plan | null = null;
    const inner = limit - 2 * o.padding;
    for (let i = 0; i <= 12; i++) {
      const colH = inner / 2 ** (i / 2);
      const stacks: Plan["stacks"] = [];
      let cur: Plan["stacks"][number] | null = null;
      for (const s of list) {
        const p = packed(s, fewest(s, colH - (s.label ? o.labelH : 0)));
        const h = (s.label ? o.labelH : 0) + p.h;
        if (cur && cur.h + o.shelfGap + h <= inner + 1e-6) {
          cur.items.push({ s, p });
          cur.h += o.shelfGap + h;
          cur.w = Math.max(cur.w, p.w);
        } else stacks.push((cur = { items: [{ s, p }], w: p.w, h }));
      }
      let w = 2 * o.padding - o.stackGap, h = 0;
      for (const st of stacks) {
        w += st.w + o.stackGap;
        h = Math.max(h, st.h);
      }
      const pl = { stacks, w, h: h + 2 * o.padding };
      const fits = (x: Plan) => x.h <= limit + 1e-6;
      if (!best || (fits(pl) && (!fits(best) || pl.w < best.w - 1e-6)) || (!fits(pl) && !fits(best) && pl.h < best.h)) best = pl;
    }
    return best!;
  };
  const lists = regions.map((r) => regionShelves.get(r.id)!).filter((l) => l.length);
  const board = (limit: number) => {
    const plans = lists.map((l) => plan(l, limit));
    let w = -o.regionGap, h = 0;
    for (const p of plans) {
      w += p.w + o.regionGap;
      h = Math.max(h, p.h);
    }
    return { plans, w, h };
  };
  // The height to aim for: from the cards' area, then a few corrections towards the aspect.
  let area = 0;
  for (const c of cards) area += (c.w + o.colGap) * (c.h + o.gap);
  let limit = Math.sqrt((area * 1.25) / o.aspect);
  let best = lists.length ? board(limit) : { plans: [], w: 0, h: 0 };
  let score = Math.abs(Math.log(best.w / best.h / o.aspect));
  for (let i = 0; i < 10 && lists.length; i++) {
    const r = best.w / best.h / o.aspect;
    if (Math.abs(Math.log(r)) < 0.03) break;
    limit *= Math.sqrt(r);
    const b = board(limit);
    const sc = Math.abs(Math.log(b.w / b.h / o.aspect));
    if (sc < score - 1e-9) {
      best = b;
      score = sc;
    }
  }

  const positions = new Map<string, Point>();
  const rects = new Map<string, Rect>();
  const shelves: Shelf[] = [];
  const stacks: Stack[] = [];
  const place = new Map<string, { shelf: number; col: number }>();
  let x = 0;
  let li = 0;
  for (const r of regions) {
    if (!regionShelves.get(r.id)!.length) continue;
    const pl = best.plans[li++];
    let sx = x + o.padding;
    for (const st of pl.stacks) {
      let y = o.padding;
      const first = shelves.length;
      st.items.forEach(({ s, p }, i) => {
        if (i) y += o.shelfGap;
        const top = y + (s.label ? o.labelH : 0);
        const cols: ShelfColumn[] = [];
        let cx = sx;
        const si = shelves.length;
        p.cols.forEach((run, ci) => {
          let cy = top;
          for (const id of run.ids) {
            positions.set(id, { x: cx, y: cy });
            place.set(id, { shelf: si, col: ci });
            cy += byId.get(id)!.h + o.gap;
          }
          cols.push({ x: cx, w: run.w, ids: run.ids });
          cx += run.w + o.colGap;
        });
        shelves.push({ id: `${r.id}/${s.name}`, region: r.id, stack: stacks.length, label: s.label, x: sx, y, w: p.w, h: top - y + p.h, top, cols, ids: s.cards.map((c) => c.id) });
        y = top + p.h;
      });
      stacks.push({ region: r.id, x: sx, y: o.padding, w: st.w, h: st.h, shelves: shelves.slice(first).map((_, i) => first + i) });
      sx += st.w + o.stackGap;
    }
    rects.set(r.id, { x, y: 0, w: pl.w, h: pl.h });
    x += pl.w + o.regionGap;
  }
  const all = [...rects.values()];
  const bounds = all.length ? { x: 0, y: 0, w: Math.max(...all.map((r) => r.x + r.w)), h: Math.max(...all.map((r) => r.h)) } : { x: 0, y: 0, w: 0, h: 0 };
  return { positions, regions: rects, shelves, stacks, place, bounds, o };
}

// --- text ---------------------------------------------------------------------

let face: Face | null = null;
/** Width of a name in em, as the index and titles draw it (Ubuntu, medium). */
export const emWidth = (s: string): number => textWidth((face ??= faceFor("Ubuntu", 500, "normal")), 1, s);

/** A title's lines at `size` within `width` (word wrap; a word longer than the line is left whole: drawing squeezes it). */
export function wrap(text: string, size: number, width: number, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && emWidth(next) * size > width) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(" ");
    lines.length = maxLines - 1;
    lines.push(rest);
  }
  return lines;
}

export type IndexItem = { id: string | null; name: string; heading: boolean; x: number; y: number; w: number };
/** A region's A–Z index: each shelf's label as a heading and its names under it, in columns read top to bottom. */
export type RegionIndex = { size: number; line: number; items: IndexItem[] };

/** Line height of the index, in its font size; room kept left of each name (for a book's mark), in em. */
export const INDEX_LINE = 1.3;
export const INDEX_INDENT = 1;

/**
 * Lays a region's index over its area: its shelves in order, each label a
 * heading (never left alone at a column's foot) over its names A–Z, in the
 * column count that lets the font be largest, the widest names (beyond the
 * 90th percentile) squeezed to fit rather than shrinking every name. At
 * most `maxSize`.
 */
export function indexLayout(area: Rect, groups: readonly { label: string; items: readonly { id: string; name: string }[] }[], maxSize = 400): RegionIndex {
  const lines: { id: string | null; name: string; heading: boolean }[] = [];
  for (const g of groups) {
    if (!g.items.length) continue;
    if (g.label) lines.push({ id: null, name: g.label, heading: true });
    for (const it of g.items) lines.push({ id: it.id, name: it.name, heading: false });
  }
  const n = lines.length;
  if (!n || area.w <= 0 || area.h <= 0) return { size: 0, line: 0, items: [] };
  const widths = lines.map((x) => emWidth(x.name)).sort((a, b) => a - b);
  const wide = widths[Math.min(n - 1, Math.floor(n * 0.9))] + INDEX_INDENT + 0.8;
  // Column and row of each line for `rows` rows a column (a heading on a column's last row moves on).
  const flow = (rows: number) => {
    const at: { col: number; row: number }[] = [];
    let col = 0, row = 0;
    for (const l of lines) {
      if (row >= rows || (l.heading && row === rows - 1 && rows > 1)) {
        col++;
        row = 0;
      }
      at.push({ col, row: row++ });
    }
    return { at, cols: col + 1 };
  };
  let best = { size: 0, rows: n, cols: 1 };
  for (let rows = n; rows >= 1; rows = rows > 40 ? Math.floor(rows * 0.97) : rows - 1) {
    const { cols } = flow(rows);
    const size = Math.min(maxSize, area.h / (rows * INDEX_LINE), area.w / cols / wide);
    if (size > best.size) best = { size, rows, cols };
  }
  const { size, rows, cols } = best;
  const { at } = flow(rows);
  const colW = area.w / cols;
  const items = lines.map((l, i) => ({
    ...l,
    x: area.x + at[i].col * colW + (l.heading ? 0 : INDEX_INDENT * size),
    y: area.y + at[i].row * size * INDEX_LINE,
    w: colW - (l.heading ? 0.5 : INDEX_INDENT + 0.5) * size,
  }));
  return { size, line: size * INDEX_LINE, items };
}

/** The index name (not a heading) under a world point, if any. */
export function indexAt(ix: RegionIndex, p: Point): IndexItem | null {
  for (const it of ix.items)
    if (!it.heading && p.x >= it.x - INDEX_INDENT * ix.size && p.x <= it.x + it.w && p.y >= it.y && p.y < it.y + ix.line) return it;
  return null;
}

// --- wires --------------------------------------------------------------------

/**
 * A right-angled route from card `a` to card `b` along the gutters: out of
 * a's side (by its title), along its column's gutter to the band above or
 * below its shelf's cards, along that band to the gap beside its stack of
 * shelves, along that gap (and, to a stack that isn't the next one, along
 * the board's top or bottom edge, or its region's) to b's stack, and the
 * same way in to b. The shortest of those choices. World units.
 */
export function route(l: ShelfLayout, a: string, b: string, rectOf: (id: string) => Rect | null, inset = 19): Point[] | null {
  const A = rectOf(a), B = rectOf(b), pa = l.place.get(a), pb = l.place.get(b);
  if (!A || !B || !pa || !pb) return null;
  const o = l.o;
  const sa = l.shelves[pa.shelf], sb = l.shelves[pb.shelf];
  const ya = A.y + Math.min(inset, A.h / 2), yb = B.y + Math.min(inset, B.h / 2);
  // A card's gutter on a side: half a gap out from its column (the shelf's edge: half the stack gap, or the region's padding).
  const gutter = (s: Shelf, col: number, right: boolean) => {
    const c = s.cols[col];
    if (right) return col + 1 < s.cols.length ? c.x + c.w + o.colGap / 2 : side(s.stack, true);
    return col ? c.x - o.colGap / 2 : side(s.stack, false);
  };
  // The gap beside a stack (half way to the next stack, or the region's padding).
  const side = (st: number, right: boolean) => {
    const S = l.stacks[st], r = l.regions.get(S.region)!;
    const n = l.stacks[st + (right ? 1 : -1)];
    if (n && n.region === S.region) return right ? S.x + S.w + o.stackGap / 2 : S.x - o.stackGap / 2;
    return right ? r.x + r.w - o.padding / 2 : r.x + o.padding / 2;
  };
  // The bands a shelf's gutters meet: above its cards (under its label), and below them.
  const bands = (s: Shelf): number[] => {
    const S = l.stacks[s.stack];
    const i = S.shelves.indexOf(l.shelves.indexOf(s));
    const r = l.regions.get(s.region)!;
    const above = s.label ? s.top - Math.min(o.gap, o.labelH / 4) : i ? s.y - o.shelfGap / 2 : r.y + o.padding / 2;
    const below = i + 1 < S.shelves.length ? l.shelves[S.shelves[i + 1]].y - o.shelfGap / 2 : r.y + r.h - o.padding / 2;
    return [above, below];
  };
  const len = (ps: Point[]) => {
    let d = 0;
    for (let i = 1; i < ps.length; i++) d += Math.abs(ps[i].x - ps[i - 1].x) + Math.abs(ps[i].y - ps[i - 1].y);
    return d;
  };
  const found: { ps: Point[] | null } = { ps: null };
  const consider = (ps: Point[]) => {
    // (Drop points that don't turn.)
    const out: Point[] = [];
    for (const p of ps) {
      const q = out[out.length - 1], r = out[out.length - 2];
      if (q && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6) continue;
      if (q && r && ((Math.abs(r.x - q.x) < 1e-6 && Math.abs(q.x - p.x) < 1e-6) || (Math.abs(r.y - q.y) < 1e-6 && Math.abs(q.y - p.y) < 1e-6))) out[out.length - 1] = p;
      else out.push(p);
    }
    if (!found.ps || len(out) < len(found.ps)) found.ps = out;
  };
  // Clear across the whole board: the top padding (every region's top is at the board's), and below the tallest.
  const lanes = [l.bounds.y + o.padding / 2, l.bounds.y + l.bounds.h - o.padding / 2];
  const region = l.regions.get(sa.region)!;
  if (sa.region === sb.region) lanes.push(region.y + region.h - o.padding / 2);
  for (const rightA of [true, false])
    for (const rightB of [true, false]) {
      const ga = gutter(sa, pa.col, rightA), gb = gutter(sb, pb.col, rightB);
      const start = { x: rightA ? A.x + A.w : A.x, y: ya }, end = { x: rightB ? B.x + B.w : B.x, y: yb };
      // One gutter between them (neighbouring columns, or a shelf's edge and the next stack's).
      if (Math.abs(ga - gb) < 1e-6) consider([start, { x: ga, y: ya }, { x: ga, y: yb }, end]);
      for (const ba of bands(sa))
        for (const bb of bands(sb)) {
          const head = [start, { x: ga, y: ya }, { x: ga, y: ba }];
          const tail = [{ x: gb, y: bb }, { x: gb, y: yb }, end];
          if (sa === sb && Math.abs(ba - bb) < 1e-6) consider([...head, ...tail]);
          for (const ra of [false, true])
            for (const rb of [false, true]) {
              const xa = side(sa.stack, ra), xb = side(sb.stack, rb);
              // The same gap: straight along it.
              if (Math.abs(xa - xb) < 1e-6) consider([...head, { x: xa, y: ba }, { x: xa, y: bb }, ...tail]);
              // Facing gaps of neighbouring stacks in different regions: across the gap between the regions.
              else if (sb.stack === sa.stack + (ra ? 1 : -1) && rb === !ra) consider([...head, { x: xa, y: ba }, { x: xb, y: ba }, { x: xb, y: bb }, ...tail]);
              else for (const y of lanes) consider([...head, { x: xa, y: ba }, { x: xa, y }, { x: xb, y }, { x: xb, y: bb }, ...tail]);
            }
        }
    }
  return found.ps;
}

// --- reflow -------------------------------------------------------------------

/**
 * The card to keep still when the layout changes: the selected card if it
 * stays and is in view, else the one nearest the view's centre that stays.
 */
export function anchorOf(
  positions: ReadonlyMap<string, Point>,
  sizes: (id: string) => { w: number; h: number } | null,
  stays: (id: string) => boolean,
  view: View,
  screen: { w: number; h: number },
  selected: string | null,
): string | null {
  const c = { x: (screen.w / 2 - view.x) / view.k, y: (screen.h / 2 - view.y) / view.k };
  const vis = { x: -view.x / view.k, y: -view.y / view.k, w: screen.w / view.k, h: screen.h / view.k };
  if (selected && stays(selected)) {
    const p = positions.get(selected), s = sizes(selected);
    if (p && s && p.x < vis.x + vis.w && p.x + s.w > vis.x && p.y < vis.y + vis.h && p.y + s.h > vis.y) return selected;
  }
  let best: string | null = null, bestD = Infinity;
  for (const [id, p] of positions) {
    if (!stays(id)) continue;
    const s = sizes(id);
    if (!s) continue;
    const dx = Math.max(p.x - c.x, 0, c.x - p.x - s.w), dy = Math.max(p.y - c.y, 0, c.y - p.y - s.h);
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** The view that shows the card moved from `from` to `to` where it was on screen. */
export const keepStill = (view: View, from: Point, to: Point): View => ({ x: view.x + (from.x - to.x) * view.k, y: view.y + (from.y - to.y) * view.k, k: view.k });
