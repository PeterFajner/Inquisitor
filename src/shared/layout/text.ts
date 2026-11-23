// Text measuring for the card layout: advance widths from ./fonts.ts (the
// self-hosted faces), font matching as CSS does it, and where a line may
// break. Cards turn kerning and ligatures off (rules.css), so a run's width
// is the sum of its characters' advances.
import { CODE_POINTS, FACES, type FaceData } from "./fonts.ts";

export type Face = {
  key: string;
  /** Ascent and descent in em. */
  ascent: number;
  descent: number;
  lineGap: number;
  /** Advance in em, by code point; 0 or missing when the face lacks it. */
  adv: Map<number, number>;
};

const faces = new Map<string, Face>();

function decode(key: string, f: FaceData): Face {
  const bin = typeof atob === "function" ? atob(f.advances) : Buffer.from(f.advances, "base64").toString("latin1");
  const adv = new Map<number, number>();
  let i = 0;
  for (const [start, count] of CODE_POINTS)
    for (let c = start; c < start + count; c++, i++) {
      const units = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (units) adv.set(c, units / f.upem);
    }
  return { key, ascent: f.ascent / f.upem, descent: f.descent / f.upem, lineGap: f.lineGap / f.upem, adv };
}

const families = new Map<string, { weight: number; style: string; key: string }[]>();
for (const key of Object.keys(FACES)) {
  const m = /^(.*) (\d+) (\w+)$/.exec(key)!;
  const list = families.get(m[1]) ?? [];
  list.push({ weight: +m[2], style: m[3], key });
  families.set(m[1], list);
}

/** CSS font matching: the face of the first known family nearest the weight and style. */
export function faceFor(family: string, weight: number, style: string): Face {
  const names = family.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
  const list = names.map((n) => families.get(n)).find(Boolean) ?? families.get("Ubuntu")!;
  const styled = list.filter((f) => f.style === style);
  const pool = styled.length ? styled : list;
  const ws = [...new Set(pool.map((f) => f.weight))].sort((a, b) => a - b);
  let w: number;
  if (ws.includes(weight)) w = weight;
  else if (weight >= 400 && weight <= 500) w = ws.find((x) => x > weight && x <= 500) ?? [...ws].reverse().find((x) => x < weight) ?? ws.find((x) => x > weight)!;
  else if (weight > 500) w = ws.find((x) => x > weight) ?? [...ws].reverse().find((x) => x < weight)!;
  else w = [...ws].reverse().find((x) => x < weight) ?? ws.find((x) => x > weight)!;
  const key = pool.find((f) => f.weight === w)!.key;
  let face = faces.get(key);
  if (!face) faces.set(key, (face = decode(key, FACES[key])));
  return face;
}

/** Width in em of a character the face lacks (drawn by a system font): a full em, on the safe side. */
const MISSING = 1;

export function textWidth(face: Face, size: number, text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) c = ((c - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00) + 0x10000;
    // Variation selectors and joiners take no room.
    if ((c >= 0xfe00 && c <= 0xfe0f) || c === 0x200b || c === 0x200c || c === 0x200d || c === 0xfeff) continue;
    w += face.adv.get(c) ?? (c < 0x20 ? 0 : MISSING);
  }
  return w * size;
}

// ---------------------------------------------------------------------------
// Line breaking: where Chrome breaks Latin text (measured; scripts/heights-check.ts)
// ---------------------------------------------------------------------------

// A line may break after these…
const BREAK_AFTER = new Set([..."-‐–?…"]);
// …and before an opening bracket that follows one of these.
const BEFORE_OPEN = new Set([...")]}.,;:!?+=%\"°−&*#|\\~>"]);

/**
 * Whether a line may break between the characters `a` and `b` (spaces
 * aside; `before` is the character before `a`): after hyphens (not a
 * minus sign before a figure), en dashes, "?" and "…",
 * around an em dash, and before "(" or "[" after closing punctuation. Never
 * at a slash.
 */
export function breakBetween(a: string, b: string, before = ""): boolean {
  if (!a || !b) return false;
  if (b === "-" || b === "‐" || b === "–") return false;
  if (a === "—" || b === "—") return a !== b;
  // A hyphen-minus starting a word before a figure is a minus sign ("-30%"): kept with it ("3-4" may break).
  if (a === "-" && b >= "0" && b <= "9" && (before === "" || before === " ")) return false;
  if (BREAK_AFTER.has(a)) return true;
  if ((b === "(" || b === "[") && BEFORE_OPEN.has(a)) return true;
  return false;
}
