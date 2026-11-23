// A compendium is every entry of a stack of packs, indexed by kind and id.
// Pure (no fs): the server loads YAML from disk (src/lib/rules-files.ts) and
// the browser receives the compiled JSON.
import { POOLS, type Ability, type Archetype, type Effect, type Entry, type Item, type Pack, type PickFilter, type Pool, type Restriction, type Rule, type Table } from "./schema.ts";

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

// A pack comes after the packs it extends (otherwise the given order is kept).
export function packOrder(stack: PackEntries[]): PackEntries[] {
  const byId = new Map(stack.map((p) => [p.pack.id, p]));
  const out: PackEntries[] = [];
  const seen = new Set<string>();
  const visit = (p: PackEntries) => {
    if (seen.has(p.pack.id)) return;
    seen.add(p.pack.id);
    for (const x of p.pack.extends ?? []) {
      const dep = byId.get(x);
      if (dep) visit(dep);
    }
    out.push(p);
  };
  stack.forEach(visit);
  return out;
}

// Later packs override earlier ones entry by entry; a pack always comes after
// the packs it extends.
export function buildCompendium(given: PackEntries[]): Compendium {
  const stack = packOrder(given);
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
    if ("wielded" in e) walkEffects(e.wielded, visit, `${p}/wielded`);
    if ("trade" in e) walkEffects(e.trade.get, visit, `${p}/trade/get`);
    if ("pick" in e && e.from) {
      e.from.forEach((o, j) => {
        if ("name" in o && "id" in o && !("stat" in o)) {
          if (o.effects) walkEffects(o.effects, visit, `${p}/from/${j}`);
        } else walkEffects([o as Effect], visit, `${p}/from/${j}`);
      });
    }
  });
}

/**
 * The names an entry answers to in filters and restrictions (`tag`,
 * `exclude`, `only`, `except`, a restriction's scope), compared exactly:
 * its id, group, category, tags, product, and "alien" for alien items.
 */
export function entryNames(e: Ability | Item): string[] {
  const out = [e.id];
  if (e.group) out.push(e.group);
  if (e.kind === "item") {
    if (e.category) out.push(e.category);
    if (e.tags) out.push(...e.tags);
    if (e.product) out.push(e.product);
    if (e.alien) out.push("alien");
  }
  return out;
}

const POOL_KEYS = { talent: "talent", exotic: "exotic", item: "item", mutation: "mutation", power: "power" } as const satisfies Record<Pool, KindKey>;

// The names filters may use, per pool: every entry's names (entryNames),
// its groups, and items' categories.
type Vocab = Record<Pool, { names: Set<string>; groups: Set<string> }> & { categories: Set<string> };
function vocabulary(c: Compendium): Vocab {
  const v = { categories: new Set<string>() } as Vocab;
  for (const pool of POOLS) {
    const names = new Set<string>();
    const groups = new Set<string>();
    for (const e of mapFor(c, POOL_KEYS[pool]).values() as Iterable<Ability | Item>) {
      for (const n of entryNames(e)) names.add(n);
      if (e.group) groups.add(e.group);
      if (e.kind === "item" && e.category) v.categories.add(e.category);
    }
    v[pool] = { names, groups };
  }
  return v;
}

// Every name a filter, restriction, access list or row reference uses must be
// spelled exactly as the entries (or rows) spell it.
function checkNames(c: Compendium, v: Vocab, x: Effect, say: (m: string) => void): void {
  const unknown = (what: string, list: string[] | undefined, known: Set<string>, of: string) => {
    for (const n of list ?? []) if (!known.has(n)) say(`${what} "${n}" matches no ${of}`);
  };
  const filter = (f: PickFilter | undefined, pools: Pool[], what: string) => {
    if (!f) return;
    const groups = new Set(pools.flatMap((p) => [...v[p].groups]));
    const names = new Set(pools.flatMap((p) => [...v[p].names]));
    const of = pools.join("/");
    unknown(`${what} group`, f.group, groups, `${of} group`);
    unknown(`${what} discipline`, f.discipline, v.power.groups, "power group");
    unknown(`${what} category`, f.category, v.categories, "item category");
    unknown(`${what} tag`, f.tag, names, of);
    unknown(`${what} exclude`, f.exclude, names, of);
  };
  const rowsOf = (id: string) => new Set((c.tables.get(id)?.rows ?? []).map((r) => r.label));
  if ("pick" in x && x.pool) filter(x.filter, [x.pool], "filter");
  if ("trade" in x) {
    const lose = x.trade.give.lose;
    filter(x.trade.give.filter, lose === undefined ? ["item"] : Array.isArray(lose) ? lose : [lose], "trade filter");
  }
  if ("restrict" in x || "exclusive" in x) {
    const r: Partial<Restriction> & { pool: Pool } = "restrict" in x ? x.restrict : x.exclusive;
    const what = "restrict" in x ? "restrict" : "exclusive";
    unknown(`${what} group`, r.group, v[r.pool].groups, `${r.pool} group`);
    unknown(`${what} category`, r.category, v.categories, "item category");
    unknown(`${what} tag`, r.tag, v[r.pool].names, r.pool);
    unknown(`${what} only`, r.only, v[r.pool].names, r.pool);
    unknown(`${what} except`, r.except, v[r.pool].names, r.pool);
  }
  if ("access" in x) unknown("access group", x.access.group, v[x.access.pool].groups, `${x.access.pool} group`);
  if ("powers" in x) unknown("discipline", x.powers.disciplines, v.power.groups, "power group");
  if ("gear" in x) {
    const rows = rowsOf(EQUIPMENT_GENERATOR);
    unknown("gear exclude", x.gear.exclude, v.item.names, "item");
    for (const list of x.gear.require ?? []) unknown("gear require", list, rows, `row of "${EQUIPMENT_GENERATOR}"`);
    if (typeof x.gear.downgrade === "object") unknown("downgrade only", x.gear.downgrade.only, rows, `row of "${EQUIPMENT_GENERATOR}"`);
  }
  if ("bionics" in x) {
    const t = x.bionics.table ?? "bionics-table";
    unknown("bionics only", x.bionics.only, rowsOf(t), `row of "${t}"`);
  }
  if ("roll" in x && typeof x.column === "object") {
    const cols = new Set(c.tables.get(x.roll)?.columns ?? []);
    for (const [col, names] of Object.entries(x.column.owned)) {
      if (!cols.has(col)) say(`column "${col}" isn't a column of "${x.roll}"`);
      unknown(`column ${col}`, names, v.item.names, "item");
    }
  }
  // a grant's `set` answers for the granted entry's rolls are row labels
  const t = thingOf(x);
  const set = t && (x as { set?: Record<string, string[]> }).set;
  if (t && set) {
    const target = mapFor(c, POOL_KEYS[t.kind]).get(t.id);
    for (const { effects } of target ? effectLists(target) : []) {
      walkEffects(effects, (y) => {
        if ("roll" in y && set[y.id]) unknown(`set ${y.id}`, set[y.id], rowsOf(y.roll), `row of "${y.roll}"`);
      });
    }
  }
}

const thingOf = (e: Effect): { kind: Pool; id: string } | undefined => {
  if ("pick" in e) return undefined;
  for (const k of POOLS) if (k in e) return { kind: k, id: (e as Record<string, string>)[k] };
  return undefined;
};

// The equipment generator (docs/ENGINE.md: conventions the engine relies on).
export const EQUIPMENT_GENERATOR = "equipment-generator";

// Cross-reference and id checks the schema can't do. Returns messages.
export function checkCompendium(c: Compendium): string[] {
  const problems: string[] = [];
  const has = (kind: KindKey, id: string) => mapFor(c, kind).has(id);
  const vocab = vocabulary(c);
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
        if ("armour" in x && x.armour.as && !has("item", x.armour.as)) problems.push(`${at} ${where}: armour as unknown item "${x.armour.as}"`);
        if ("pick" in x && x.into && x.into !== "self" && !has("item", x.into)) problems.push(`${at} ${where}: into unknown item "${x.into}"`);
        if ("item" in x && "alterations" in x) {
          for (const a of x.alterations ?? []) if (!has("item", a)) problems.push(`${at} ${where}: unknown alteration "${a}"`);
        }
        if ("remove" in x) {
          for (const [k, ids] of Object.entries(x.remove) as [KindKey, string[]][]) {
            for (const id of ids) if (!has(k, id)) problems.push(`${at} ${where}: remove unknown ${k} "${id}"`);
          }
        }
        if ("companion" in x && !c.archetypes.has(x.companion.archetype)) problems.push(`${at} ${where}: unknown archetype "${x.companion.archetype}"`);
        if ("bionics" in x && !has("table", x.bionics.table ?? "bionics-table")) problems.push(`${at} ${where}: unknown table "${x.bionics.table ?? "bionics-table"}"`);
        checkNames(c, vocab, x, (m) => problems.push(`${at} ${where}: ${m}`));
      });
    }
    if (e.kind === "archetype") {
      const subIds = new Set<string>();
      for (const s of e.subtypes) {
        if (subIds.has(s.id)) problems.push(`${at}: subtype "${s.id}" twice`);
        subIds.add(s.id);
        if (e.subtypeDie && !s.range) problems.push(`${at}: subtype "${s.id}" needs a range (the archetype has a subtypeDie)`);
      }
    }
    if (e.kind === "rule" && e.apply && typeof e.apply === "object" && e.apply.after && e.apply.before) {
      problems.push(`${at}: apply takes after or before, not both`);
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
