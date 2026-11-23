// What a chip needs to know beyond its effect: the book names of the
// entries it refers to (across every visible pack), the entry's own option
// and subtype names, and each table's die.
import type { Compendium } from "../../shared/rules/compendium.ts";
import type { Effect, Entry, Option } from "../../shared/rules/schema.ts";

export type RefKind = "talent" | "exotic" | "item" | "mutation" | "power" | "table" | "archetype" | "rule";

export type Names = {
  name(kind: RefKind, id: string): string;
  has(kind: RefKind, id: string): boolean;
  die(table: string): string | null;
  /** Every entry of a kind, for pickers: [id, name][] in name order. */
  list(kind: RefKind): [string, string][];
  /** A table's columns. */
  columns(table: string): string[];
};

const MAPS: Record<RefKind, keyof Compendium> = {
  talent: "talents",
  exotic: "exotics",
  item: "items",
  mutation: "mutations",
  power: "powers",
  table: "tables",
  archetype: "archetypes",
  rule: "rules",
};

export function namesOf(c: Compendium): Names {
  const lists = new Map<RefKind, [string, string][]>();
  const map = (k: RefKind) => c[MAPS[k]] as Map<string, Entry>;
  return {
    name: (k, id) => map(k).get(id)?.name ?? id,
    has: (k, id) => map(k).has(id),
    die: (t) => {
      const e = c.tables.get(t);
      return e ? String(e.die) : null;
    },
    columns: (t) => c.tables.get(t)?.columns ?? [],
    list(k) {
      let l = lists.get(k);
      if (!l) {
        l = [...map(k).values()].map((e) => [e.id, e.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
        lists.set(k, l);
      }
      return l;
    },
  };
}

export type Ctx = {
  names: Names;
  /** Named options anywhere in the entry, by id. */
  options: Map<string, string>;
  /** The entry's subtypes (archetypes), by id. */
  subtypes: Map<string, string>;
  /** A pick's options are named by a stat ("Sg"): their stat chips leave the stat out. */
  statName?: string;
  /** Show the card of an entry a chip names (fly to it). */
  go?: (kind: RefKind, id: string) => void;
};

export const isOption = (o: Option | Effect): o is Option =>
  typeof o === "object" && o !== null && "name" in o && "id" in o && !("stat" in o) && Object.keys(o).every((k) => k === "id" || k === "name" || k === "text" || k === "when" || k === "effects");

export function ctxOf(e: Entry, names: Names): Ctx {
  const options = new Map<string, string>();
  const walk = (effects: Effect[] | undefined) => {
    for (const x of effects ?? []) {
      if (!x || typeof x !== "object") continue;
      if ("pick" in x && x.from) {
        for (const o of x.from) {
          if (isOption(o)) {
            options.set(o.id, o.name);
            walk(o.effects);
          } else walk([o]);
        }
      }
      if ("then" in x) {
        walk(x.then);
        walk(x.else);
      }
      if ("optional" in x) walk(x.optional);
      if ("wielded" in x) walk(x.wielded);
      if ("trade" in x) walk(x.trade.get);
    }
  };
  if (e.kind === "archetype") e.sections.forEach((s) => walk(s.effects));
  else if (e.kind === "table") e.rows.forEach((r) => walk(r.effects));
  else walk(e.effects);
  const subtypes = new Map<string, string>();
  if (e.kind === "archetype") for (const s of e.subtypes) subtypes.set(s.id, s.name);
  return { names, options, subtypes };
}

/** "−20", "+10", "+D10": signs with a true minus. */
export function signed(v: number | string): string {
  const s = String(v);
  if (typeof v === "number") return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0";
  if (s.startsWith("-")) return `−${s.slice(1)}`;
  if (s.startsWith("+")) return s;
  return `+${s}`;
}

export const isNegative = (v: unknown): boolean => (typeof v === "number" ? v < 0 : typeof v === "string" && v.trim().startsWith("-"));

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
