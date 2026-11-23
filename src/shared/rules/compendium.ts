// A compendium is every entry of a stack of packs, indexed by kind and id.
// Pure (no fs): the server loads YAML from disk (src/lib/rules-files.ts) and
// the browser receives the compiled JSON.
import type { Ability, Archetype, Effect, Entry, Item, Pack, Rule, Table } from "./schema.ts";

export const KIND_DIRS = {
  archetype: "archetypes",
  talent: "talents",
  exotic: "exotics",
  mutation: "mutations",
  power: "powers",
  item: "items",
  table: "tables",
  rule: "rules",
} as const;
export type KindKey = keyof typeof KIND_DIRS;

export const kindKey = (e: Entry): KindKey => e.kind as KindKey;

export type PackEntries = { pack: Pack; entries: Entry[] };

export interface Compendium {
  packs: Pack[];
  archetypes: Map<string, Archetype>;
  talents: Map<string, Ability>;
  exotics: Map<string, Ability>;
  mutations: Map<string, Ability>;
  powers: Map<string, Ability>;
  items: Map<string, Item>;
  tables: Map<string, Table>;
  rules: Map<string, Rule>;
  // which pack each entry (by "kind/id") finally came from
  origin: Map<string, string>;
}

export const entryKey = (kind: string, id: string) => `${kind}/${id}`;

// Later packs override earlier ones entry by entry.
export function buildCompendium(stack: PackEntries[]): Compendium {
  const c: Compendium = {
    packs: stack.map((p) => p.pack),
    archetypes: new Map(),
    talents: new Map(),
    exotics: new Map(),
    mutations: new Map(),
    powers: new Map(),
    items: new Map(),
    tables: new Map(),
    rules: new Map(),
    origin: new Map(),
  };
  for (const { pack, entries } of stack) {
    for (const e of entries) {
      mapFor(c, e.kind).set(e.id, e as never);
      c.origin.set(entryKey(e.kind, e.id), pack.id);
    }
  }
  return c;
}

export function mapFor(c: Compendium, kind: KindKey): Map<string, Entry> {
  switch (kind) {
    case "archetype": return c.archetypes;
    case "talent": return c.talents;
    case "exotic": return c.exotics;
    case "mutation": return c.mutations;
    case "power": return c.powers;
    case "item": return c.items;
    case "table": return c.tables;
    case "rule": return c.rules;
  }
}

export function allEntries(c: Compendium): Entry[] {
  return (Object.keys(KIND_DIRS) as KindKey[]).flatMap((k) => [...mapFor(c, k).values()]);
}

// Every effect list an entry has, with a label for error messages.
export function effectLists(e: Entry): { where: string; effects: Effect[] }[] {
  switch (e.kind) {
    case "archetype":
      return e.sections.map((s) => ({ where: `section "${s.name}"`, effects: s.effects }));
    case "table":
      return e.rows.map((r, i) => ({ where: `row ${i + 1} (${r.label})`, effects: r.effects }));
    default:
      return e.effects ? [{ where: "effects", effects: e.effects }] : [];
  }
}

// Depth-first walk over effects, including options' and branches' effects.
export function walkEffects(effects: Effect[], visit: (e: Effect, path: string) => void, path = ""): void {
  effects.forEach((e, i) => {
    const p = `${path}/${i}`;
    visit(e, p);
    if ("then" in e) {
      walkEffects(e.then, visit, `${p}/then`);
      if (e.else) walkEffects(e.else, visit, `${p}/else`);
    }
    if ("optional" in e) walkEffects(e.optional, visit, `${p}/optional`);
    if ("pick" in e && e.from) {
      e.from.forEach((o, j) => {
        if ("name" in o && "id" in o && !("stat" in o)) {
          if (o.effects) walkEffects(o.effects, visit, `${p}/from/${j}`);
        } else walkEffects([o as Effect], visit, `${p}/from/${j}`);
      });
    }
  });
}

// Cross-reference and id checks the schema can't do. Returns messages.
export function checkCompendium(c: Compendium): string[] {
  const problems: string[] = [];
  const has = (kind: KindKey, id: string) => mapFor(c, kind).has(id);
  for (const e of allEntries(c)) {
    const at = `${e.kind}/${e.id}`;
    const ids = new Set<string>();
    for (const { where, effects } of effectLists(e)) {
      walkEffects(effects, (x) => {
        if ("id" in x && x.id && !("name" in x)) {
          if (ids.has(x.id)) problems.push(`${at} ${where}: effect id "${x.id}" used twice in this entry`);
          ids.add(x.id);
        }
        if ("talent" in x && !has("talent", x.talent)) problems.push(`${at} ${where}: unknown talent "${x.talent}"`);
        if ("exotic" in x && !has("exotic", x.exotic)) problems.push(`${at} ${where}: unknown exotic "${x.exotic}"`);
        if ("item" in x && !has("item", x.item)) problems.push(`${at} ${where}: unknown item "${x.item}"`);
        if ("mutation" in x && !has("mutation", x.mutation)) problems.push(`${at} ${where}: unknown mutation "${x.mutation}"`);
        if ("power" in x && !has("power", x.power)) problems.push(`${at} ${where}: unknown power "${x.power}"`);
        if ("roll" in x && !has("table", x.roll)) problems.push(`${at} ${where}: unknown table "${x.roll}"`);
      });
    }
    if (e.kind === "archetype") {
      const subIds = new Set<string>();
      for (const s of e.subtypes) {
        if (subIds.has(s.id)) problems.push(`${at}: subtype "${s.id}" twice`);
        subIds.add(s.id);
      }
    }
    if (e.kind === "table") {
      for (const [i, r] of e.rows.entries()) {
        if (!r.range && !r.ranges) problems.push(`${at} row ${i + 1}: needs range or ranges`);
        if (r.ranges && e.columns) {
          for (const col of Object.keys(r.ranges)) {
            if (!e.columns.includes(col)) problems.push(`${at} row ${i + 1}: unknown column "${col}"`);
          }
        }
      }
    }
  }
  return problems;
}
