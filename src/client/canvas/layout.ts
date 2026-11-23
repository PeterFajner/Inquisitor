// Places cards that have no position yet: each region gets its entries in
// the given order, in columns, every entry going into the shortest column
// so far (masonry by height; ties go to the leftmost). Regions follow one
// another left to right, wrapping into a new row past `rowWidth`.
// Deterministic: the same input always gives the same layout. Pure.
import type { Rect } from "./geometry.ts";

export type LayoutRegion = {
  id: string;
  /** Columns in this region; by default chosen so the region's shape comes closest to `aspect`. */
  columns?: number;
};

export type LayoutEntry = {
  id: string;
  region: string;
  /** Height in world units: measured, or an estimate until it is. */
  h: number;
  /** Width; defaults to the layout's columnWidth. Wider entries span columns. */
  w?: number;
};

export type LayoutOptions = {
  columnWidth: number;
  /** Space between cards (and columns). */
  gap?: number;
  /** Space inside a region's edge. */
  padding?: number;
  /** Space reserved at the top of each region (default 0: the canvas draws titles above regions). */
  header?: number;
  /** Space between regions. */
  regionGap?: number;
  /** Width/height a region aims for when its columns aren't given. */
  aspect?: number;
  /** Start a new row of regions once a row would grow wider than this. */
  rowWidth?: number;
  /** Where the first region's top-left corner goes. */
  origin?: { x: number; y: number };
};

export type Layout = {
  positions: Map<string, { x: number; y: number }>;
  regions: Map<string, Rect>;
  bounds: Rect;
};

type Placed = { id: string; x: number; y: number };

// Masonry inside one region, relative to its top-left corner.
function masonry(entries: LayoutEntry[], columns: number, o: Required<Omit<LayoutOptions, "origin" | "rowWidth" | "aspect">>) {
  const step = o.columnWidth + o.gap;
  const tops = new Array<number>(columns).fill(0);
  const placed: Placed[] = [];
  for (const e of entries) {
    const span = clampInt(Math.ceil(((e.w ?? o.columnWidth) + o.gap) / step), 1, columns);
    // The run of `span` columns whose tallest is lowest.
    let best = 0, bestTop = Infinity;
    for (let c = 0; c + span <= columns; c++) {
      const top = Math.max(...tops.slice(c, c + span));
      if (top < bestTop - 1e-9) { best = c; bestTop = top; }
    }
    placed.push({ id: e.id, x: o.padding + best * step, y: o.padding + o.header + bestTop });
    for (let c = best; c < best + span; c++) tops[c] = bestTop + e.h + o.gap;
  }
  const height = Math.max(0, ...tops) - (entries.length ? o.gap : 0);
  return {
    placed,
    w: 2 * o.padding + columns * o.columnWidth + (columns - 1) * o.gap,
    h: 2 * o.padding + o.header + height,
  };
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export function layoutRegions(regions: LayoutRegion[], entries: LayoutEntry[], opts: LayoutOptions): Layout {
  const o = { gap: 16, padding: 32, header: 0, regionGap: 120, aspect: 16 / 10, rowWidth: Infinity, origin: { x: 0, y: 0 }, ...opts };
  const byRegion = new Map<string, LayoutEntry[]>(regions.map((r) => [r.id, []]));
  for (const e of entries) byRegion.get(e.region)?.push(e);

  const positions = new Map<string, { x: number; y: number }>();
  const rects = new Map<string, Rect>();
  let x = o.origin.x, y = o.origin.y, rowH = 0;
  for (const region of regions) {
    const list = byRegion.get(region.id)!;
    let best: ReturnType<typeof masonry>;
    if (region.columns) best = masonry(list, Math.max(1, region.columns), o);
    else {
      // Try 1..n columns; keep the one whose shape is nearest the aspect (in log terms).
      const maxCols = Math.max(1, Math.min(list.length, 24));
      best = masonry(list, 1, o);
      let score = Math.abs(Math.log(best.w / best.h / o.aspect));
      for (let c = 2; c <= maxCols; c++) {
        const m = masonry(list, c, o);
        const s = Math.abs(Math.log(m.w / m.h / o.aspect));
        if (s < score - 1e-9) { best = m; score = s; }
      }
    }
    if (x > o.origin.x && x + best.w > o.origin.x + o.rowWidth) {
      x = o.origin.x;
      y += rowH + o.regionGap;
      rowH = 0;
    }
    rects.set(region.id, { x, y, w: best.w, h: best.h });
    for (const p of best.placed) positions.set(p.id, { x: x + p.x, y: y + p.y });
    x += best.w + o.regionGap;
    rowH = Math.max(rowH, best.h);
  }
  const all = [...rects.values()];
  const x0 = Math.min(o.origin.x, ...all.map((r) => r.x)), y0 = Math.min(o.origin.y, ...all.map((r) => r.y));
  const x1 = Math.max(o.origin.x, ...all.map((r) => r.x + r.w)), y1 = Math.max(o.origin.y, ...all.map((r) => r.y + r.h));
  return { positions, regions: rects, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
