// The canvas engine's pure maths: world/screen transforms, zooming about a
// point, fitting a rectangle, culling and the "fly to" path. No DOM, so the
// tests run it under Node (test/canvas.test.ts).
//
// A view maps world coordinates to screen (CSS pixels inside the canvas
// element): screen = world * k + (x, y).

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type View = { x: number; y: number; k: number };
export type ZoomLimits = { min: number; max: number };

export const toScreen = (v: View, p: Point): Point => ({ x: p.x * v.k + v.x, y: p.y * v.k + v.y });
export const toWorld = (v: View, p: Point): Point => ({ x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k });

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The world rectangle the viewport shows, grown by `margin` screen pixels on every side. */
export function visibleRect(v: View, viewport: Size, margin = 0): Rect {
  const m = margin / v.k;
  return { x: -v.x / v.k - m, y: -v.y / v.k - m, w: viewport.w / v.k + 2 * m, h: viewport.h / v.k + 2 * m };
}

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** The smallest rectangle holding all of `rects` (null for none). */
export function union(rects: Iterable<Rect>): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Pan by a screen-pixel delta. */
export const panBy = (v: View, dx: number, dy: number): View => ({ x: v.x + dx, y: v.y + dy, k: v.k });

/** Zoom by `factor` keeping the world point under screen point `at` fixed. */
export function zoomAt(v: View, at: Point, factor: number, limits: ZoomLimits): View {
  const k = clamp(v.k * factor, limits.min, limits.max);
  const f = k / v.k;
  return { x: at.x - (at.x - v.x) * f, y: at.y - (at.y - v.y) * f, k };
}

/** The view that shows world rect `r` centred in the viewport, with `pad` screen pixels around it. */
export function fitView(r: Rect, viewport: Size, limits: ZoomLimits, pad = 24): View {
  const w = Math.max(1, viewport.w - 2 * pad), h = Math.max(1, viewport.h - 2 * pad);
  const k = clamp(Math.min(w / Math.max(r.w, 1), h / Math.max(r.h, 1)), limits.min, limits.max);
  const c = center(r);
  return { x: viewport.w / 2 - c.x * k, y: viewport.h / 2 - c.y * k, k };
}

/** The view centred on world point `c` at zoom k. */
export const viewAt = (c: Point, k: number, viewport: Size): View => ({ x: viewport.w / 2 - c.x * k, y: viewport.h / 2 - c.y * k, k });

/** Items whose rect meets `r`, in input order. Linear: 1,000 rects take microseconds. */
export function cull<T>(items: readonly T[], rectOf: (t: T) => Rect, r: Rect): T[] {
  const out: T[] = [];
  for (const it of items) if (intersects(rectOf(it), r)) out.push(it);
  return out;
}

/** Snap a world position to a grid of `step` (no-op without one). */
export const snap = (p: Point, step?: number): Point =>
  step && step > 0 ? { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step } : p;

// Smooth zoom-and-pan (van Wijk & Nuij, "Smooth and efficient zooming and
// panning", 2003): flies out and back in when the target is far away, so the
// path keeps context. Returns the view at t in [0, 1] and a duration in ms.
export function flyPath(from: View, to: View, viewport: Size, rho = 1.4): { at: (t: number) => View; ms: number } {
  const c0 = toWorld(from, { x: viewport.w / 2, y: viewport.h / 2 });
  const c1 = toWorld(to, { x: viewport.w / 2, y: viewport.h / 2 });
  const w0 = viewport.w / from.k, w1 = viewport.w / to.k;
  const dx = c1.x - c0.x, dy = c1.y - c0.y;
  const d = Math.hypot(dx, dy);
  const r2 = rho * rho;
  const make = (c: Point, w: number): View => viewAt(c, viewport.w / w, viewport);
  if (d < 1e-6 * Math.max(w0, w1)) {
    // Only zooming.
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    return {
      at: (t) => make(c0, w0 * Math.exp(Math.log(w1 / w0) * t)),
      ms: msFor(S),
    };
  }
  const b = (w: number, sign: number) => (w1 * w1 - w0 * w0 + sign * r2 * r2 * d * d) / (2 * w * r2 * d);
  const rOf = (bb: number) => Math.log(-bb + Math.sqrt(bb * bb + 1));
  const r0 = rOf(b(w0, 1));
  const r1 = rOf(b(w1, -1));
  const S = (r1 - r0) / rho;
  const cosh = Math.cosh(r0), sinh = Math.sinh(r0);
  return {
    at: (t) => {
      if (t >= 1) return to;
      const s = t * S;
      const u = (w0 / (r2 * d)) * (cosh * Math.tanh(rho * s + r0) - sinh);
      const w = (w0 * cosh) / Math.cosh(rho * s + r0);
      return make({ x: c0.x + u * dx, y: c0.y + u * dy }, w);
    },
    ms: msFor(S),
  };
}
const msFor = (S: number) => clamp(Math.abs(S) * 420, 250, 1400);

/** Ease for the fly animation's time. */
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// Wires: a card's anchor points and the curve between two cards.
export type Side = "left" | "right" | "top" | "bottom";

export function anchor(r: Rect, side: Side): Point {
  if (side === "left") return { x: r.x, y: r.y + r.h / 2 };
  if (side === "right") return { x: r.x + r.w, y: r.y + r.h / 2 };
  if (side === "top") return { x: r.x + r.w / 2, y: r.y };
  return { x: r.x + r.w / 2, y: r.y + r.h };
}

/** The sides two cards' wire leaves and enters by: the facing ones. */
export function facingSides(a: Rect, b: Rect): [Side, Side] {
  const ca = center(a), cb = center(b);
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gapX >= gapY) return cb.x >= ca.x ? ["right", "left"] : ["left", "right"];
  return cb.y >= ca.y ? ["bottom", "top"] : ["top", "bottom"];
}

const normal: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

/** A cubic Bézier from card a to card b, as SVG path data, plus its bounding box (for culling). */
export function wirePath(a: Rect, b: Rect, sides?: [Side?, Side?]): { d: string; box: Rect } {
  const auto = facingSides(a, b);
  const sa = sides?.[0] ?? auto[0], sb = sides?.[1] ?? auto[1];
  const p0 = anchor(a, sa), p3 = anchor(b, sb);
  const pull = clamp(Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.4, 24, 400);
  const p1 = { x: p0.x + normal[sa].x * pull, y: p0.y + normal[sa].y * pull };
  const p2 = { x: p3.x + normal[sb].x * pull, y: p3.y + normal[sb].y * pull };
  const r = (n: number) => Math.round(n * 10) / 10;
  const d = `M${r(p0.x)},${r(p0.y)} C${r(p1.x)},${r(p1.y)} ${r(p2.x)},${r(p2.y)} ${r(p3.x)},${r(p3.y)}`;
  // The control polygon's box holds the curve.
  return { d, box: union([p0, p1, p2, p3].map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))! };
}

/** Scale and offset that fit world rect `r` into a box of `box` pixels (the minimap). */
export function miniMapping(r: Rect, box: Size, pad = 6) {
  const s = Math.min((box.w - 2 * pad) / Math.max(1, r.w), (box.h - 2 * pad) / Math.max(1, r.h));
  return { s, ox: (box.w - r.w * s) / 2 - r.x * s, oy: (box.h - r.h * s) / 2 - r.y * s };
}
