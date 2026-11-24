// A small shape per article pack, marking its cards (a corner of the card,
// before its name in the index and its title) and shown beside it in the
// packs menu; the book's own cards have none. Shapes go to packs in their
// order (filled ones first, then outlined), the same everywhere. Each is an
// SVG path in a 10×10 box (even-odd for the outlined ones), drawn on the
// canvas as a Path2D and in the page as a CSS mask.
import { BASE_PACK } from "./regions.ts";

const SHAPES: { d: string; hollow?: boolean }[] = [
  { d: "M5 0.5A4.5 4.5 0 1 1 5 9.5A4.5 4.5 0 1 1 5 0.5Z" },
  { d: "M1 1H9V9H1Z" },
  { d: "M5 0.5L9.6 9H0.4Z" },
  { d: "M5 0L10 5L5 10L0 5Z" },
  { d: "M5 0.2L6.2 3.6L9.8 3.7L7 5.9L8 9.4L5 7.4L2 9.4L3 5.9L0.2 3.7L3.8 3.6Z" },
  { d: "M5 0.5A4.5 4.5 0 1 1 5 9.5A4.5 4.5 0 1 1 5 0.5ZM5 2.7A2.3 2.3 0 1 0 5 7.3A2.3 2.3 0 1 0 5 2.7Z", hollow: true },
  { d: "M1 1H9V9H1ZM3.2 3.2V6.8H6.8V3.2Z", hollow: true },
  { d: "M5 0.5L9.6 9H0.4ZM5 4.4L3.1 7.6H6.9Z", hollow: true },
  { d: "M5 0L10 5L5 10L0 5ZM5 2.9L2.9 5L5 7.1L7.1 5Z", hollow: true },
  { d: "M3.5 0.5H6.5V3.5H9.5V6.5H6.5V9.5H3.5V6.5H0.5V3.5H3.5Z" },
];

export type Mark = { d: string; hollow: boolean; css: string };

const css = (s: { d: string; hollow?: boolean }) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill-rule="${s.hollow ? "evenodd" : "nonzero"}" d="${s.d}"/></svg>`)}")`;

/** Each article pack's mark, by pack id (the book's own pack has none). */
export function marksOf(packs: readonly { id: string }[]): Map<string, Mark> {
  const out = new Map<string, Mark>();
  let i = 0;
  for (const p of packs) {
    if (p.id === BASE_PACK) continue;
    const s = SHAPES[i++ % SHAPES.length];
    out.set(p.id, { d: s.d, hollow: !!s.hollow, css: css(s) });
  }
  return out;
}

const paths = new Map<string, Path2D>();
/** Draws a mark `size` wide with its top-left at (x, y), in the current fill style. */
export function drawMark(g: CanvasRenderingContext2D, m: Mark, x: number, y: number, size: number): void {
  let p = paths.get(m.d);
  if (!p) paths.set(m.d, (p = new Path2D(m.d)));
  g.save();
  g.translate(x, y);
  g.scale(size / 10, size / 10);
  g.fill(p, m.hollow ? "evenodd" : "nonzero");
  g.restore();
}
