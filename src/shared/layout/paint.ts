// A laid-out card's look, compactly (./box.ts's PaintOp, for the rules
// canvas to draw cards too small to read: GET /api/v1/rules/geometry). Each
// piece is a look (a text style, a box style, an image's colour: shared by
// every card in a table of looks) and a rectangle, in CSS px quantised to
// half pixels; positions are deltas from the end of the piece before (so a
// line's words differ by about a space). The numbers are
// written as a string of URL-safe characters (5 bits each, the sixth bit
// saying another follows), which JSON keeps as is and gzip squeezes well.
// Colours are the app's tokens ("var(--ink-2)") or CSS literals.
import type { PaintOp } from "./box.ts";
import type { Style } from "./css.ts";

/** How a piece looks. Text: its colour, font size (px) and weight; y is its baseline. */
export type Look =
  | { t: "text"; c: string; fs: number; fw: number }
  | {
      t: "box";
      /** Background (null: none). */
      bg: string | null;
      r: number;
      /** Border widths, colours and dashed-ness per side (top, right, bottom, left). */
      bw: [number, number, number, number];
      bc: [string, string, string, string];
      dash: [boolean, boolean, boolean, boolean];
      /** box-shadow: "x y colour" or a token holding one. */
      sh: string | null;
    }
  | { t: "img"; c: string };

/** A card's pieces, decoded: per piece its look (an index into `looks`) and rectangle (x, y, w, h; text: y is the baseline, h 0). */
export type Geo = { looks: readonly Look[]; a: Float32Array };

/** Numbers per piece in Geo.a. */
export const STRIDE = 5;

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i++) VALUE[ALPHA.charCodeAt(i)] = i;

const q = (v: number) => Math.round(v * 2);
const zig = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
const unzig = (n: number) => (n & 1 ? -(n + 1) / 2 : n / 2);

function put(out: string[], n: number): void {
  while (n >= 32) {
    out.push(ALPHA[32 | (n & 31)]);
    n = Math.floor(n / 32);
  }
  out.push(ALPHA[n]);
}

const visible = (s: Style, i: number) => s.border[i] > 0 && s.borderStyle[i] !== "none" && s.borderStyle[i] !== "hidden";

/** A piece's look. */
export function lookOf(op: PaintOp): Look {
  const s = op.s;
  if (op.t === "text") return { t: "text", c: s.color, fs: s.fontSize, fw: s.fontWeight };
  if (op.t === "img") return { t: "img", c: s.color };
  const sides = [0, 1, 2, 3] as const;
  return {
    t: "box",
    bg: s.background,
    r: s.radius,
    bw: sides.map((i) => (visible(s, i) ? s.border[i] : 0)) as [number, number, number, number],
    bc: sides.map((i) => (visible(s, i) ? s.borderColor[i] ?? s.color : "")) as [string, string, string, string],
    dash: sides.map((i) => visible(s, i) && (s.borderStyle[i] === "dashed" || s.borderStyle[i] === "dotted")) as [boolean, boolean, boolean, boolean],
    sh: s.shadow,
  };
}

/** Writes cards' pieces against one table of looks (start it from an earlier table to keep its indices). */
export class GeoWriter {
  readonly looks: Look[];
  private index = new Map<string, number>();
  constructor(looks: readonly Look[] = []) {
    this.looks = [...looks];
    this.looks.forEach((l, i) => this.index.set(JSON.stringify(l), i));
  }
  private lookIndex(op: PaintOp): number {
    const l = lookOf(op);
    const k = JSON.stringify(l);
    let i = this.index.get(k);
    if (i === undefined) {
      i = this.looks.length;
      this.looks.push(l);
      this.index.set(k, i);
    }
    return i;
  }
  /** One card's pieces as a string. */
  card(ops: readonly PaintOp[]): string {
    const out: string[] = [];
    let px = 0, py = 0;
    for (const op of ops) {
      const x = q(op.x), y = q(op.y);
      put(out, this.lookIndex(op));
      put(out, zig(x - px));
      put(out, zig(y - py));
      put(out, Math.max(0, q(op.w)));
      if (op.t !== "text") put(out, Math.max(0, q(op.h)));
      px = x + Math.max(0, q(op.w));
      py = y;
    }
    return out.join("");
  }
}

/** A card's pieces from GeoWriter.card, against the same looks. */
export function decodeGeo(str: string, looks: readonly Look[]): Geo {
  const nums: number[] = [];
  let n = 0, mul = 1;
  for (let i = 0; i < str.length; i++) {
    const v = VALUE[str.charCodeAt(i)] ?? -1;
    if (v < 0) throw new Error("bad geometry");
    n += (v & 31) * mul;
    if (v & 32) mul *= 32;
    else {
      nums.push(n);
      n = 0;
      mul = 1;
    }
  }
  const a: number[] = [];
  let px = 0, py = 0;
  for (let i = 0; i < nums.length; ) {
    const li = nums[i++];
    const look = looks[li];
    if (!look) throw new Error("bad geometry");
    const x = px + unzig(nums[i++]);
    py += unzig(nums[i++]);
    const w = nums[i++];
    const h = look.t === "text" ? 0 : nums[i++];
    a.push(li, x / 2, py / 2, w / 2, h / 2);
    px = x + w;
  }
  return { looks, a: Float32Array.from(a) };
}

/** Pieces straight from the layout (a card worked out in the browser), as decoded ones are. */
export function geoOf(ops: readonly PaintOp[]): Geo {
  const w = new GeoWriter();
  return decodeGeo(w.card(ops), w.looks);
}
