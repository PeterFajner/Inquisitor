// Dice strings: integers and [N]D<M> terms joined by + or - ("60+2D10",
// "D3+3", "-D10", "D100"); a dice term may be multiplied ("D6x10"). A roll is recorded as its faces: one number per
// die, in the order the dice appear in the string, so a stored roll can be
// replayed exactly.
import { DICE_RE, STATS, type Dice, type Stat } from "../rules/schema.ts";

export type DiceTerm = { sign: 1 | -1; count: number; sides: number; times?: number };
export type DiceExpr = { dice: DiceTerm[]; constant: number; text: string };

export function isDice(d: unknown): d is Dice {
  if (typeof d === "number") return Number.isInteger(d);
  return typeof d === "string" && DICE_RE.test(d.trim());
}

export function parseDice(d: Dice): DiceExpr {
  if (typeof d === "number") {
    if (!Number.isInteger(d)) throw new Error(`dice: ${d} is not an integer`);
    return { dice: [], constant: d, text: String(d) };
  }
  const text = d.trim();
  if (!DICE_RE.test(text)) throw new Error(`dice: "${d}" is not like 60+2D10`);
  const out: DiceExpr = { dice: [], constant: 0, text };
  for (const m of text.matchAll(/([+-]?)(\d*)(D?)(\d+)(?:x(\d+))?/g)) {
    const sign = m[1] === "-" ? -1 : 1;
    if (m[3]) {
      const count = m[2] === "" ? 1 : Number(m[2]);
      const sides = Number(m[4]);
      if (sides < 1) throw new Error(`dice: "${d}" has a die with no sides`);
      const t: DiceTerm = { sign, count, sides };
      if (m[5] !== undefined) t.times = Number(m[5]);
      if (count > 0) out.dice.push(t);
    } else {
      out.constant += sign * Number(m[2] + m[4]);
    }
  }
  return out;
}

/** True when the expression involves no dice (a fixed number). */
export const isFixed = (d: Dice): boolean => parseDice(d).dice.length === 0;

/** Number of faces a roll of this expression records. */
export const faceCount = (e: DiceExpr): number => e.dice.reduce((n, t) => n + t.count, 0);

/** The sides of each die in face order: "2D10+D6" → [10, 10, 6]. */
export const faceSides = (e: DiceExpr): number[] => e.dice.flatMap((t) => Array<number>(t.count).fill(t.sides));

/** Whether `faces` is a valid recorded roll of `e`. */
export function validFaces(e: DiceExpr, faces: unknown): faces is number[] {
  const sides = faceSides(e);
  return (
    Array.isArray(faces) &&
    faces.length === sides.length &&
    faces.every((f, i) => Number.isInteger(f) && f >= 1 && f <= sides[i])
  );
}

/** The total of a roll from its faces. Throws when the faces don't fit. */
export function total(e: DiceExpr, faces: number[]): number {
  if (!validFaces(e, faces)) throw new Error(`dice: faces [${faces}] don't fit ${e.text}`);
  let i = 0;
  let sum = e.constant;
  for (const t of e.dice) for (let k = 0; k < t.count; k++) sum += t.sign * faces[i++] * (t.times ?? 1);
  return sum;
}

/** Roll every die with `roll(sides)` (1..sides). */
export function rollFaces(e: DiceExpr, roll: (sides: number) => number): number[] {
  return faceSides(e).map((s) => roll(s));
}

export function roll(d: Dice, rollDie: (sides: number) => number): { faces: number[]; total: number } {
  const e = parseDice(d);
  const faces = rollFaces(e, rollDie);
  return { faces, total: total(e, faces) };
}

export function mean(d: Dice): number {
  const e = parseDice(d);
  return e.dice.reduce((s, t) => s + (t.sign * t.count * (t.sides + 1) * (t.times ?? 1)) / 2, e.constant);
}

export function min(d: Dice): number {
  const e = parseDice(d);
  return e.dice.reduce((s, t) => s + (t.times ?? 1) * (t.sign > 0 ? t.count : -t.count * t.sides), e.constant);
}

export function max(d: Dice): number {
  const e = parseDice(d);
  return e.dice.reduce((s, t) => s + (t.times ?? 1) * (t.sign > 0 ? t.count * t.sides : -t.count), e.constant);
}

/** A stat line with every die at its mean, rounded down ("max: average"). */
export function averageStats(stats: Partial<Record<Stat, Dice>>): Partial<Record<Stat, number>> {
  const out: Partial<Record<Stat, number>> = {};
  for (const s of STATS) {
    const d = stats[s];
    if (d !== undefined) out[s] = Math.floor(mean(d));
  }
  return out;
}
