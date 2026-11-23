// What a version's card and the compare panel show, from the engine's build
// of the version's record: the sheet's Starting row (the nine stats and Kbk,
// BIV, SS, Cnc, Spd), the alignment, the talents, exotic abilities,
// mutations, powers and items, the named options and table results; and the
// difference between two of them, in those terms (the book's names only).
import type { Character } from "../../shared/engine/build.ts";
import type { ThingKind } from "../../shared/engine/record.ts";
import { DERIVED, STATS } from "../../shared/rules/schema.ts";
import { SHEET_STATS, type SheetStat } from "../../shared/sheet.ts";

export type Thing = { key: string; kind: ThingKind; id: string; name: string; qty: number };

export type Summary = {
  name: string;
  /** "Inquisitor, Puritan": the archetype, and the subtype when it isn't the same word. */
  tag: string;
  archetype: string;
  subtype: string;
  alignment: string | null;
  stats: Record<SheetStat, number | "No">;
  things: Thing[];
  options: { id: string; name: string }[];
  rolls: string[];
};

export function summarize(ch: Character): Summary {
  const stats = {} as Record<SheetStat, number | "No">;
  for (const s of STATS) stats[s] = ch.stats[s].final;
  for (const d of DERIVED) stats[d] = ch.derived[d].value;
  const things: Thing[] = [];
  for (const list of [ch.talents, ch.exotics, ch.mutations, ch.powers])
    for (const t of list) things.push({ key: `${t.kind}/${t.id}`, kind: t.kind, id: t.id, name: t.name, qty: 1 });
  for (const t of ch.items) things.push({ key: `item/${t.id}`, kind: "item", id: t.id, name: t.name, qty: t.qty });
  const tag = [ch.archetype.name, ch.subtype.name.toLowerCase() !== ch.archetype.name.toLowerCase() ? ch.subtype.name : ""].filter(Boolean).join(", ");
  return {
    name: ch.name,
    tag,
    archetype: ch.archetype.id,
    subtype: ch.subtype.id,
    alignment: ch.alignment ?? null,
    stats,
    things,
    options: ch.options.map((o) => ({ id: o.id, name: o.name })),
    rolls: ch.rolls.filter((r) => !r.lost).map((r) => r.label),
  };
}

export type StatChange = { stat: SheetStat; from: number | "No"; to: number | "No"; dir: 1 | -1 | 0 };

export type Comparison = {
  changed: boolean;
  name?: { from: string; to: string };
  tag?: { from: string; to: string };
  alignment?: { from: string | null; to: string | null };
  stats: StatChange[];
  gained: Thing[];
  lost: Thing[];
  options: { gained: string[]; lost: string[] };
  rolls: { gained: string[]; lost: string[] };
};

const count = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};
/** a minus b, as multisets, in a's order. */
const minus = (a: string[], b: string[]): string[] => {
  const left = count(b);
  return a.filter((x) => {
    const n = left.get(x) ?? 0;
    if (n > 0) {
      left.set(x, n - 1);
      return false;
    }
    return true;
  });
};

/** What changes going from `a` to `b`. A higher value is `dir` 1 (shown as good), lower -1 (bad). */
export function compare(a: Summary, b: Summary): Comparison {
  const stats: StatChange[] = [];
  for (const s of SHEET_STATS) {
    const from = a.stats[s];
    const to = b.stats[s];
    if (from === to) continue;
    const dir = typeof from === "number" && typeof to === "number" ? (to > from ? 1 : -1) : 0;
    stats.push({ stat: s, from, to, dir });
  }
  const ta = new Map(a.things.map((t) => [t.key, t]));
  const tb = new Map(b.things.map((t) => [t.key, t]));
  const gained: Thing[] = [];
  const lost: Thing[] = [];
  for (const t of b.things) {
    const o = ta.get(t.key);
    if (!o) gained.push(t);
    else if (t.qty > o.qty) gained.push({ ...t, qty: t.qty - o.qty });
  }
  for (const t of a.things) {
    const n = tb.get(t.key);
    if (!n) lost.push(t);
    else if (t.qty > n.qty) lost.push({ ...t, qty: t.qty - n.qty });
  }
  const oa = a.options.map((o) => o.name);
  const ob = b.options.map((o) => o.name);
  const out: Comparison = {
    changed: false,
    stats,
    gained,
    lost,
    options: { gained: minus(ob, oa), lost: minus(oa, ob) },
    rolls: { gained: minus(b.rolls, a.rolls), lost: minus(a.rolls, b.rolls) },
  };
  if (a.name !== b.name) out.name = { from: a.name, to: b.name };
  if (a.tag !== b.tag) out.tag = { from: a.tag, to: b.tag };
  if (a.alignment !== b.alignment) out.alignment = { from: a.alignment, to: b.alignment };
  out.changed =
    !!(out.name || out.tag || out.alignment) ||
    stats.length > 0 ||
    gained.length > 0 ||
    lost.length > 0 ||
    out.options.gained.length + out.options.lost.length + out.rolls.gained.length + out.rolls.lost.length > 0;
  return out;
}

/** "Name ×2" for more than one. */
export const thingText = (t: Thing): string => (t.qty > 1 ? `${t.name} ×${t.qty}` : t.name);

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Infinity],
];

/** When a version was made, relative to now: "5 minutes ago", "yesterday" (approved text). */
export function when(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  let v = Math.max(0, (now - t) / 1000);
  for (const [unit, next] of UNITS) {
    // under a minute is just "now"
    if (v < next) return RELATIVE.format(unit === "second" ? 0 : -Math.floor(v), unit);
    v /= next;
  }
  return "";
}

/** The full local date and time, numbers only, for a tooltip. */
export function fullTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
