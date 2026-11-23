// Cards too small to read, drawn rather than mounted (the canvas's drawCard):
// from each card's geometry (src/shared/layout/paint.ts: where its layout
// put every box, word and icon), its background, chips, borders and rules as
// they are, and each word as a bar in its text's colour over the band its
// letters fill, faint enough to hold about the same ink. Mounted over its
// drawing once readable, the real card fades in and the words seem to
// sharpen in place.
import { STRIDE, type Geo, type Look } from "../../shared/layout/paint.ts";

/** Ubuntu's x-height, in em (OS/2 sxHeight 520/1000). */
export const X_HEIGHT = 0.52;
// A word's bar: from a little above its x-height down to its baseline.
const BAR_TOP = 0.6;
const BAR_H = 0.6;
// Alpha of a word's bar (lowercase text covers about this much of its band), heavier for bold.
const ALPHA = 0.42;
const ALPHA_BOLD = 0.55;
const ALPHA_ICON = 0.45;

const colours = new Map<string, string>();
let root: CSSStyleDeclaration | null = null;
/** A token ("var(--ink-2)") or literal colour, as the page's theme has it. */
function colour(c: string): string {
  let v = colours.get(c);
  if (v === undefined) {
    const m = /^var\((--[\w-]+)\)$/.exec(c);
    root ??= getComputedStyle(document.documentElement);
    v = m ? root.getPropertyValue(m[1]).trim() || "transparent" : c;
    colours.set(c, v);
  }
  return v;
}
/** Forget resolved colours (the theme changed). */
export function resetColours(): void {
  colours.clear();
  root = null;
}

/** "2px 2px #0d0d0d" (a token holding one, too): offset and colour; null for none. */
const shadows = new Map<string, { x: number; y: number; c: string } | null>();
function shadowOf(sh: string): { x: number; y: number; c: string } | null {
  let s = shadows.get(sh);
  if (s === undefined) {
    const m = /^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(.+)$/.exec(colour(sh).trim());
    s = m && !/,/.test(m[3]) ? { x: +m[1], y: +m[2], c: m[3] } : null;
    shadows.set(sh, s);
  }
  return s;
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (r > 0 && typeof g.roundRect === "function") g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  else g.rect(x, y, w, h);
}

type BoxLook = Extract<Look, { t: "box" }>;

function box(g: CanvasRenderingContext2D, L: BoxLook, x: number, y: number, w: number, h: number, scale: number) {
  const r = L.r * scale >= 0.75 ? L.r : 0;
  if (L.sh) {
    const s = shadowOf(L.sh);
    if (s && Math.max(Math.abs(s.x), Math.abs(s.y)) * scale >= 0.25) {
      g.fillStyle = colour(s.c);
      g.beginPath();
      round(g, x + s.x, y + s.y, w, h, r);
      g.fill();
    }
  }
  if (L.bg) {
    g.fillStyle = colour(L.bg);
    g.beginPath();
    round(g, x, y, w, h, r);
    g.fill();
  }
  const [bt, br, bb, bl] = L.bw;
  if (!(bt || br || bb || bl) || Math.max(bt, br, bb, bl) * scale < 0.2) return;
  const all = bt && bt === br && bt === bb && bt === bl && L.bc.every((c) => c === L.bc[0]) && L.dash.every((d) => d === L.dash[0]);
  if (all) {
    g.strokeStyle = colour(L.bc[0]);
    g.lineWidth = bt;
    g.setLineDash(L.dash[0] ? [3 * bt, 3 * bt] : []);
    g.beginPath();
    round(g, x + bt / 2, y + bt / 2, w - bt, h - bt, Math.max(0, r - bt / 2));
    g.stroke();
    g.setLineDash([]);
    return;
  }
  // Sides apart: solid ones as bands (inside the rounded corners), dashed ones as lines.
  const clip = r > 0;
  if (clip) {
    g.save();
    g.beginPath();
    round(g, x, y, w, h, r);
    g.clip();
  }
  const sides: [number, number, number, number, number][] = [
    [0, x, y, w, bt],
    [1, x + w - br, y, br, h],
    [2, x, y + h - bb, w, bb],
    [3, x, y, bl, h],
  ];
  for (const [i, sx, sy, sw, sh] of sides) {
    if (!L.bw[i]) continue;
    const c = colour(L.bc[i]);
    if (!L.dash[i]) {
      g.fillStyle = c;
      g.fillRect(sx, sy, sw, sh);
      continue;
    }
    const b = L.bw[i];
    g.strokeStyle = c;
    g.lineWidth = b;
    g.setLineDash([3 * b, 3 * b]);
    g.beginPath();
    if (i % 2 === 0) {
      g.moveTo(sx, sy + b / 2);
      g.lineTo(sx + sw, sy + b / 2);
    } else {
      g.moveTo(sx + b / 2, sy);
      g.lineTo(sx + b / 2, sy + sh);
    }
    g.stroke();
    g.setLineDash([]);
  }
  if (clip) g.restore();
}

// A frame's bars, by fill (colour and alpha), drawn together.
const batch = new Map<string, number[]>();
function bar(key: string, x: number, y: number, w: number, h: number) {
  let b = batch.get(key);
  if (!b) batch.set(key, (b = []));
  b.push(x, y, w, h);
}

/** Text lines with their words joined (for far away, where a word's gaps are under a pixel). */
const joined = new WeakMap<Geo, Float32Array>();
function linesOf(geo: Geo): Float32Array {
  let out = joined.get(geo);
  if (out) return out;
  const a = geo.a, looks = geo.looks;
  const o: number[] = [];
  for (let i = 0; i < a.length; i += STRIDE) {
    const L = looks[a[i]];
    const n = o.length;
    if (L.t === "text" && n && o[n - STRIDE] === a[i] && o[n - STRIDE + 2] === a[i + 2] && a[i + 1] - (o[n - STRIDE + 1] + o[n - STRIDE + 3]) < L.fs) {
      o[n - STRIDE + 3] = a[i + 1] + a[i + 3] - o[n - STRIDE + 1];
      continue;
    }
    o.push(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4]);
  }
  joined.set(geo, (out = Float32Array.from(o)));
  return out;
}

/** Draws a card from its geometry, in CSS px from its top-left, `scale` device pixels a CSS pixel; the card's own box at least `h` tall (its slot). */
export function drawGeo(g: CanvasRenderingContext2D, geo: Geo, scale: number, h = 0): void {
  const looks = geo.looks;
  // Words under about 2 device pixels tall: whole lines.
  const a = scale * 12 < 2 ? linesOf(geo) : geo.a;
  for (let i = 0; i < a.length; i += STRIDE) {
    const L = looks[a[i]];
    if (L.t === "box") box(g, L, a[i + 1], a[i + 2], a[i + 3], i === 0 ? Math.max(h, a[i + 4]) : a[i + 4], scale);
  }
  batch.clear();
  for (let i = 0; i < a.length; i += STRIDE) {
    const L = looks[a[i]];
    const x = a[i + 1], y = a[i + 2], w = a[i + 3];
    if (L.t === "text") bar(`${L.c}|${L.fw >= 600 ? ALPHA_BOLD : ALPHA}`, x, y - BAR_TOP * L.fs, w, BAR_H * L.fs);
    else if (L.t === "img" && w * scale >= 1) {
      const h = a[i + 4];
      bar(`${L.c}|${ALPHA_ICON}`, x + w * 0.15, y + h * 0.15, w * 0.7, h * 0.7);
    }
  }
  for (const [key, rects] of batch) {
    const bar = key.lastIndexOf("|");
    g.fillStyle = colour(key.slice(0, bar));
    g.globalAlpha = +key.slice(bar + 1);
    g.beginPath();
    for (let i = 0; i < rects.length; i += 4) g.rect(rects[i], rects[i + 1], rects[i + 2], rects[i + 3]);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** A card with no geometry (yet): its background alone. */
export function drawBlank(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = colour("var(--surface)");
  g.beginPath();
  round(g, 0, 0, w, h, 10);
  g.fill();
}
