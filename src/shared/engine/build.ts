// The engine: builds a character from a compendium and a character record.
//
// build() walks the archetype's stat line and sections, interpreting every
// effect. Each die roll and choice is a decision under a stable key
// (docs/ENGINE.md): decisions already in the record are reused; missing
// dice are rolled with opts.roll; missing choices are made at random
// (random mode) or returned as pending (freeform mode). The returned record
// holds exactly the decisions this character uses.
import type { Compendium } from "../rules/compendium.ts";
import {
  AVAILABILITIES,
  STATS,
  type Ability,
  type Alignment,
  type Archetype,
  type Availability,
  type Condition,
  type Dice,
  type Effect,
  type Item,
  type Option,
  type Stat,
  type Subtype,
  type Table,
  type TableRow,
} from "../rules/schema.ts";
import { averageStats, faceCount, parseDice, rollFaces, total, validFaces } from "./dice.ts";
import { cloneRecord, type CharacterRecord, type Override, type ThingKind } from "./record.ts";
import { cryptoRoller } from "./rng.ts";

// Table ids the engine looks up by convention (docs/ENGINE.md).
export const EQUIPMENT_GENERATOR = "equipment-generator";
export const WEAPON_AVAILABILITY = "weapon-availability";

/** Most attempts at one roll that keeps being re-rolled (duplicates, gear). */
export const MAX_REROLLS = 50;
const MAX_DEPTH = 24;

export type RollFn = (sides: number) => number;
export type BuildMode = "random" | "freeform";

export type PendingChoice = {
  key: string;
  parent?: string;
  kind: "pick" | "pool" | "optional" | "alignment" | "gear-item" | "power";
  label: string; // the book's name of the entry (or table row) asking
  count: number; // how many to choose in total
  options: { id: string; label: string }[];
  chosen: string[]; // valid choices already in the record (partial)
  source: string; // entry id
};

export type BuildOptions = {
  mode: BuildMode;
  roll?: RollFn; // (sides) => 1..sides; default: crypto RNG
  // Make a choice the record doesn't have (both modes); return undefined to
  // fall back to random (random mode) or pending (freeform mode).
  pick?: (p: PendingChoice) => string[] | undefined;
};

export type Origin = { entry: string; key?: string; section?: string; override?: boolean };
export type Owned = { kind: ThingKind; id: string; name: string; from: Origin[]; overridden?: boolean };
export type OwnedItem = Owned & { qty: number };
export type StatMod = { add?: number; set?: number; source: string; key?: string };
export type StatCap = { max?: number; min?: number; source: string };
export type StatLine = {
  base: number; // rolled from the subtype's stat line
  modified: number; // after effects and caps
  final: number; // after overrides
  overridden: boolean;
  mods: StatMod[];
  caps: StatCap[];
};

export type ChosenOption = { id: string; name: string; text?: string; key: string; source: string };
export type RollResult = {
  key: string;
  table: string;
  label: string; // the row's label
  availability?: Availability; // gear: the rolled availability (after downgrade)
  lost?: boolean; // gear: a Common item downgraded, so lost
};
export type Note = { text: string; kind: "gameplay" | "gm" | "unfit"; proposal?: string; source: string; section?: string };

export type Character = {
  name: string;
  archetype: { id: string; name: string };
  subtype: { id: string; name: string };
  alignment?: Alignment;
  options: ChosenOption[];
  stats: Record<Stat, StatLine>;
  talents: Owned[];
  exotics: Owned[];
  mutations: Owned[];
  powers: Owned[];
  items: OwnedItem[];
  rolls: RollResult[]; // every table result (boons: table "boons"), row labels
  notes: Note[];
  warnings: string[];
  overridden: {
    stats: Stat[];
    alignment: boolean;
    added: { kind: ThingKind; id: string }[];
    removed: { kind: ThingKind; id: string }[];
    choices: string[];
  };
};

export type LogEntry = {
  key: string;
  parent?: string;
  type: "dice" | "choice";
  label: string; // book text: entry, table, stat or row name
  faces?: number[];
  total?: number;
  result: string[]; // book names: row label, option/entry names
  reused: boolean; // came from the input record unchanged
  forced?: boolean; // an override forced this choice
  rerolled?: boolean; // this result was re-rolled (a duplicate, or gear the character can't have)
};

export type BuildResult = {
  character: Character;
  record: CharacterRecord;
  pending: PendingChoice[];
  log: LogEntry[];
  warnings: string[];
};

export class BuildError extends Error {}

const KIND_MAP = {
  talent: "talents",
  exotic: "exotics",
  item: "items",
  mutation: "mutations",
  power: "powers",
} as const;

type Scope = { prefix: string; parent?: string; section?: string; depth: number };
type Source = { id: string; name: string };

const isOption = (o: Option | Effect): o is Option => "name" in o;

const thingOf = (e: Effect): { kind: ThingKind; id: string } | undefined => {
  if ("pick" in e) return undefined;
  for (const k of ["talent", "exotic", "item", "mutation", "power"] as const) {
    if (k in e) return { kind: k, id: (e as Record<string, string>)[k] };
  }
  return undefined;
};

const statList = (s: Stat | Stat[] | "all"): Stat[] => (s === "all" ? [...STATS] : Array.isArray(s) ? s : [s]);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/armour/g, "armor")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");

const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The availability named in a table row label ("Exotic*" → Exotic). */
export function availabilityOf(label: string): Availability | undefined {
  const l = label.toLowerCase();
  return AVAILABILITIES.find((a) => new RegExp(`\\b${a.toLowerCase()}\\b`).test(l));
}

/** The row of `table` a total lands on (in `column` for multi-column tables). */
export function findRow(table: Table, totalRolled: number, column?: string): TableRow | undefined {
  return table.rows.find((r) => {
    const range = column !== undefined && r.ranges ? r.ranges[column] : r.range;
    return range !== undefined && totalRolled >= range[0] && totalRolled <= range[1];
  });
}

// Per-compendium caches (compendiums are treated as immutable once built).
const sortedCache = new WeakMap<Map<string, unknown>, unknown[]>();
function sortedValues<T extends { id: string }>(m: Map<string, T>): T[] {
  let v = sortedCache.get(m) as T[] | undefined;
  if (!v) {
    v = [...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    sortedCache.set(m, v);
  }
  return v;
}
const categoryCache = new WeakMap<Map<string, Item>, Map<string, Item[]>>();
function itemsByCategory(c: Compendium): Map<string, Item[]> {
  let m = categoryCache.get(c.items);
  if (!m) {
    m = new Map();
    for (const it of sortedValues(c.items)) {
      if (it.category === undefined) continue;
      const k = norm(it.category);
      const list = m.get(k) ?? [];
      list.push(it);
      m.set(k, list);
    }
    categoryCache.set(c.items, m);
  }
  return m;
}

/** Drop cached lookups for a compendium whose maps were changed in place. */
export function invalidateCompendium(c: Compendium): void {
  for (const m of [c.talents, c.exotics, c.mutations, c.powers, c.items] as Map<string, unknown>[]) sortedCache.delete(m);
  categoryCache.delete(c.items);
}

const sameArray = (a: unknown[] | undefined, b: unknown[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

// One walk over the rules. build() may run two (see alignment lookahead).
class Pass {
  c: Compendium;
  arch: Archetype;
  sub: Subtype;
  rec: CharacterRecord; // working copy: input + new decisions
  orig: CharacterRecord;
  opts: BuildOptions;
  rollDie: RollFn;
  lookahead?: Alignment;
  peekedAlignment = false;
  forced = new Map<string, string[]>();
  forcedUsed = new Set<string>();

  used = new Set<string>(); // keys allocated this pass (occurrence counting)
  usedDice = new Set<string>();
  usedChoices = new Set<string>();
  log: LogEntry[] = [];
  pending: PendingChoice[] = [];
  warnings: string[] = [];
  stale: string[] = []; // warnings about stored dice (kept across passes)
  alignmentKeys: string[] = [];

  cur = {} as Record<Stat, number>;
  base = {} as Record<Stat, number>;
  mods = {} as Record<Stat, StatMod[]>;
  caps = {} as Record<Stat, StatCap[]>;
  owned = { talent: new Map(), exotic: new Map(), item: new Map(), mutation: new Map(), power: new Map() } as {
    [K in ThingKind]: Map<string, K extends "item" ? OwnedItem : Owned>;
  };
  applied = new Set<string>(); // things whose own effects have been applied
  options: ChosenOption[] = [];
  alignment?: Alignment;
  rolls: RollResult[] = [];
  notes: Note[] = [];

  constructor(
    c: Compendium,
    arch: Archetype,
    sub: Subtype,
    rec: CharacterRecord,
    orig: CharacterRecord,
    opts: BuildOptions,
    rollDie: RollFn,
    lookahead?: Alignment,
  ) {
    this.c = c;
    this.arch = arch;
    this.sub = sub;
    this.rec = rec;
    this.orig = orig;
    this.opts = opts;
    this.rollDie = rollDie;
    this.lookahead = lookahead;
    for (const o of rec.overrides) if (o.op === "choice") this.forced.set(o.key, o.value);
  }

  warn(m: string) {
    if (!this.warnings.includes(m)) this.warnings.push(m);
  }

  staleWarn(m: string) {
    this.warn(m);
    if (!this.stale.includes(m)) this.stale.push(m);
  }

  // A unique key for `base` in `scope`; repeats get "*2", "*3", …
  alloc(scope: Scope, base: string): string {
    const k = scope.prefix + base;
    let key = k;
    for (let n = 2; this.used.has(key); n++) key = `${k}*${n}`;
    this.used.add(key);
    return key;
  }

  // --- decisions ----------------------------------------------------------

  dice(key: string, d: Dice, label: string, parent?: string, extra?: Partial<LogEntry>): { total: number; faces: number[] } {
    const e = parseDice(d);
    if (faceCount(e) === 0) return { total: e.constant, faces: [] };
    this.used.add(key);
    this.usedDice.add(key);
    let faces = this.rec.dice[key];
    if (!validFaces(e, faces)) {
      if (faces !== undefined) this.staleWarn(`${key}: stored dice [${faces}] don't fit ${e.text}; rolled again`);
      faces = rollFaces(e, this.rollDie);
      this.rec.dice[key] = faces;
    }
    const t = total(e, faces);
    this.log.push({
      key,
      parent,
      type: "dice",
      label,
      faces: [...faces],
      total: t,
      result: [String(t)],
      reused: sameArray(this.orig.dice[key], faces),
      ...extra,
    });
    return { total: t, faces };
  }

  value(scope: Scope, base: string, d: Dice, label: string): number {
    if (faceCount(parseDice(d)) === 0) return parseDice(d).constant;
    return this.dice(this.alloc(scope, base), d, label, scope.parent).total;
  }

  // Returns the chosen ids (possibly partial when pending).
  choose(
    key: string,
    p: Omit<PendingChoice, "key" | "chosen">,
    distinct = true,
  ): { ids: string[]; complete: boolean } {
    this.used.add(key);
    this.usedChoices.add(key);
    const names = new Map(p.options.map((o) => [o.id, o.label]));
    const logIt = (ids: string[], forced?: boolean) =>
      this.log.push({
        key,
        parent: p.parent,
        type: "choice",
        label: p.label,
        result: ids.map((i) => names.get(i) ?? i),
        reused: sameArray(this.orig.choices[key], ids),
        forced,
      });
    const f = this.forced.get(key);
    if (f) {
      this.forcedUsed.add(key);
      logIt(f, true);
      return { ids: [...f], complete: true };
    }
    let count = p.count;
    if (distinct && count > p.options.length) {
      if (p.options.length < count) this.warn(`${key}: only ${p.options.length} to choose from, ${count} wanted`);
      count = p.options.length;
    }
    if (count <= 0) {
      this.rec.choices[key] = [];
      logIt([]);
      return { ids: [], complete: true };
    }
    const stored = this.rec.choices[key];
    const valid: string[] = [];
    for (const id of stored ?? []) {
      if (!names.has(id)) continue;
      if (distinct && valid.includes(id)) continue;
      if (valid.length < count) valid.push(id);
    }
    if (stored && valid.length === count && stored.length === count) {
      logIt(valid);
      return { ids: valid, complete: true };
    }
    if (stored && stored.length && valid.length !== stored.length) {
      this.warn(`${key}: stored choice [${stored.join(", ")}] isn't allowed now; chosen again`);
    }
    const pend: PendingChoice = { ...p, key, count, chosen: [...valid] };
    let ids: string[] | undefined;
    if (distinct && p.options.length === count) ids = p.options.map((o) => o.id);
    if (!ids && this.opts.pick) {
      const got = this.opts.pick(pend);
      if (got) {
        const ok = got.filter((id) => names.has(id));
        if (ok.length === count && (!distinct || new Set(ok).size === ok.length)) ids = ok;
        else this.warn(`${key}: pick() gave [${got.join(", ")}], which doesn't fit`);
      }
    }
    if (!ids && this.opts.mode === "random") {
      ids = [...valid];
      while (ids.length < count) {
        const rest = distinct ? p.options.filter((o) => !ids!.includes(o.id)) : p.options;
        ids.push(rest[this.rollDie(rest.length) - 1].id);
      }
    }
    if (!ids) {
      this.pending.push(pend);
      if (stored) this.rec.choices[key] = stored;
      return { ids: valid, complete: false };
    }
    this.rec.choices[key] = ids;
    logIt(ids);
    return { ids, complete: true };
  }

  // --- the walk -----------------------------------------------------------

  run(): void {
    for (const s of STATS) {
      const d = this.sub.stats[s];
      this.mods[s] = [];
      this.caps[s] = [];
      this.base[s] = d === undefined ? 0 : this.dice(`${this.arch.id}/@stats:${s}`, d, s).total;
      if (d === undefined) this.warn(`${this.arch.id}/${this.sub.id}: no ${s} in the stat line`);
      this.cur[s] = this.base[s];
    }
    for (const section of this.arch.sections) {
      this.effects(section.effects, this.arch, { prefix: "", section: section.name, depth: 0 });
    }
  }

  effects(list: Effect[], src: Source, scope: Scope): void {
    if (scope.depth > MAX_DEPTH) {
      this.warn(`${src.id}: effects nested too deep (a table rolling on itself?); stopped`);
      return;
    }
    for (const e of list) this.effect(e, src, scope);
  }

  origin(src: Source, scope: Scope): Origin {
    const o: Origin = { entry: src.id };
    if (scope.parent) o.key = scope.parent;
    if (scope.section) o.section = scope.section;
    return o;
  }

  effect(e: Effect, src: Source, scope: Scope): void {
    if ("prose" in e) {
      const n: Note = { text: e.prose, kind: e.kind, source: src.id };
      if (e.proposal) n.proposal = e.proposal;
      if (scope.section) n.section = scope.section;
      this.notes.push(n);
      return;
    }
    if ("when" in e) {
      this.effects(this.test(e.when) ? e.then : (e.else ?? []), src, scope);
      return;
    }
    if ("stat" in e) return this.stat(e, src, scope);
    const thing = thingOf(e);
    if (thing) {
      let qty = 1;
      if ("qty" in e && e.qty !== undefined) qty = this.value(scope, `${src.id}/@${thing.id}`, e.qty, this.nameOf(thing.kind, thing.id));
      this.grant(thing.kind, thing.id, this.origin(src, scope), scope, qty);
      return;
    }
    if ("pick" in e) return this.pick(e, src, scope);
    if ("optional" in e) {
      const key = this.alloc(scope, `${src.id}/${e.id}`);
      const { ids } = this.choose(key, {
        kind: "optional",
        label: src.name,
        count: 1,
        options: [
          { id: "yes", label: this.describe(e.optional) },
          { id: "no", label: "" },
        ],
        source: src.id,
        parent: scope.parent,
      });
      if (ids[0] === "yes") this.effects(e.optional, src, { ...scope, parent: key, depth: scope.depth + 1 });
      return;
    }
    if ("chance" in e) {
      const key = this.alloc(scope, `${src.id}/${e.id}`);
      const { total: t } = this.dice(key, "D100", src.name, scope.parent);
      this.effects(t <= e.chance ? e.then : (e.else ?? []), src, { ...scope, parent: key, depth: scope.depth + 1 });
      return;
    }
    if ("roll" in e) return this.roll(e, src, scope);
    if ("alignment" in e) {
      const key = this.alloc(scope, `${src.id}/${e.id}`);
      const { ids, complete } = this.choose(key, {
        kind: "alignment",
        label: src.name,
        count: 1,
        options: e.alignment.map((a) => ({ id: a, label: a })),
        source: src.id,
        parent: scope.parent,
      });
      this.alignmentKeys.push(key);
      if (complete && ids[0]) this.alignment = ids[0] as Alignment;
      return;
    }
    if ("gear" in e) return this.gear(e, src, scope);
    if ("powers" in e) return this.powers(e, src, scope);
  }

  test(c: Condition): boolean {
    if ("alignment" in c) {
      let a = this.alignment;
      if (a === undefined) {
        this.peekedAlignment = true;
        a = this.lookahead;
      }
      return a !== undefined && c.alignment.includes(a);
    }
    if ("subtype" in c) return c.subtype.includes(this.sub.id);
    if ("option" in c) return c.option.some((o) => this.options.some((x) => x.id === o));
    if ("archetype" in c) return c.archetype.includes(this.arch.id);
    if ("has" in c) {
      return (Object.entries(c.has) as [ThingKind, string | undefined][]).every(
        ([k, id]) => id === undefined || this.owned[k].has(id),
      );
    }
    if ("not" in c) return !this.test(c.not);
    if ("any" in c) return c.any.some((x) => this.test(x));
    return c.all.every((x) => this.test(x));
  }

  stat(e: Extract<Effect, { stat: unknown }>, src: Source, scope: Scope): void {
    const stats = statList(e.stat);
    const base = `${src.id}/${e.id ?? "@" + stats.join("+")}`;
    const parent = scope.parent;
    const apply = (op: "add" | "set", d: Dice) => {
      const fixed = faceCount(parseDice(d)) === 0;
      const key = fixed ? undefined : this.alloc(scope, op === "set" ? `${base}:set` : base);
      const once = key && !e.each ? this.dice(key, d, stats.join(", "), parent).total : undefined;
      for (const s of stats) {
        const v = fixed ? parseDice(d).constant : once ?? this.dice(`${key}:${s}`, d, s, parent).total;
        const m: StatMod = { [op]: v, source: src.id } as StatMod;
        if (key) m.key = e.each ? `${key}:${s}` : key;
        this.mods[s].push(m);
        this.cur[s] = op === "add" ? this.cur[s] + v : v;
      }
    };
    if (e.set !== undefined) apply("set", e.set);
    if (e.add !== undefined) apply("add", e.add);
    if (e.max !== undefined || e.min !== undefined) {
      const avg = averageStats(this.sub.stats);
      for (const s of stats) {
        const cap: StatCap = { source: src.id };
        if (e.max !== undefined) cap.max = e.max === "average" ? (avg[s] ?? 0) : e.max;
        if (e.min !== undefined) cap.min = e.min;
        this.caps[s].push(cap);
      }
    }
  }

  nameOf(kind: ThingKind, id: string): string {
    return this.c[KIND_MAP[kind]].get(id)?.name ?? id;
  }

  grant(kind: ThingKind, id: string, origin: Origin, scope: Scope, qty = 1): void {
    const entry = this.c[KIND_MAP[kind]].get(id) as Ability | Item | undefined;
    if (!entry) this.warn(`unknown ${kind} "${id}" (from ${origin.entry})`);
    const map = this.owned[kind] as Map<string, OwnedItem>;
    const have = map.get(id);
    if (have) {
      have.from.push(origin);
      if (kind === "item") have.qty += qty;
    } else {
      const o: Owned = { kind, id, name: entry?.name ?? id, from: [origin] };
      map.set(id, (kind === "item" ? { ...o, qty } : o) as OwnedItem);
    }
    const tag = `${kind}/${id}`;
    if (entry?.effects?.length && !this.applied.has(tag)) {
      this.applied.add(tag);
      this.effects(entry.effects, entry, { ...scope, section: undefined, depth: scope.depth + 1 });
    }
  }

  optionId(o: Option | Effect, i: number): string {
    if ("id" in o && o.id) return o.id;
    const t = thingOf(o as Effect);
    if (t) return `${t.kind}:${t.id}`;
    return `#${i + 1}`;
  }

  describe(list: Effect[]): string {
    return list.map((e) => this.labelOf(e)).filter(Boolean).join(", ");
  }

  labelOf(o: Option | Effect): string {
    if (isOption(o)) return o.name;
    const t = thingOf(o);
    if (t) return this.nameOf(t.kind, t.id);
    if ("stat" in o) {
      const st = statList(o.stat).join(", ");
      if (o.add !== undefined) return `${typeof o.add === "number" && o.add >= 0 ? "+" : ""}${o.add} ${st}`;
      if (o.set !== undefined) return `${st} ${o.set}`;
      return st;
    }
    if ("roll" in o) return this.c.tables.get(o.roll)?.name ?? o.roll;
    if ("prose" in o) return o.prose;
    if ("then" in o && !("chance" in o)) return this.describe(o.then);
    if ("pick" in o || "optional" in o || "chance" in o) return "";
    return "";
  }

  pick(e: Extract<Effect, { pick: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const count = faceCount(parseDice(e.pick)) === 0 ? parseDice(e.pick).constant : this.dice(`${key}:count`, e.pick, src.name, scope.parent).total;
    const distinct = e.distinct !== false;
    const inner: Scope = { ...scope, parent: key, depth: scope.depth + 1 };
    if (e.from) {
      const opts = e.from.map((o, i) => ({ id: this.optionId(o, i), label: this.labelOf(o), o }));
      const { ids } = this.choose(
        key,
        { kind: "pick", label: src.name, count, options: opts.map(({ id, label }) => ({ id, label })), source: src.id, parent: scope.parent },
        distinct,
      );
      for (const id of ids) {
        const o = opts.find((x) => x.id === id)?.o;
        if (!o) {
          this.warn(`${key}: "${id}" isn't one of the options`);
          continue;
        }
        if (isOption(o)) {
          const co: ChosenOption = { id: o.id, name: o.name, key, source: src.id };
          if (o.text) co.text = o.text;
          this.options.push(co);
          this.effects(o.effects ?? [], src, inner);
        } else this.effects([o], src, inner);
      }
      return;
    }
    const kind = e.pool!;
    const cands = this.poolOf(kind, e.filter);
    const { ids } = this.choose(
      key,
      { kind: "pool", label: src.name, count, options: cands.map((x) => ({ id: x.id, label: x.name })), source: src.id, parent: scope.parent },
      distinct,
    );
    for (const id of ids) {
      if (!this.c[KIND_MAP[kind]].has(id)) {
        this.warn(`${key}: unknown ${kind} "${id}"`);
        continue;
      }
      this.grant(kind, id, { ...this.origin(src, scope), key }, inner);
    }
  }

  poolOf(kind: ThingKind, f?: { group?: string[]; availability?: Availability[]; discipline?: string[]; maxDifficulty?: number }): (Ability | Item)[] {
    return sortedValues(this.c[KIND_MAP[kind]] as Map<string, Ability | Item>).filter((x) => {
        if (kind !== "item" && this.owned[kind].has(x.id)) return false;
        if (f?.group && !(x.group && f.group.includes(x.group))) return false;
        if (f?.discipline && !(x.group && f.discipline.includes(x.group))) return false;
        if (f?.availability && !(x.kind === "item" && x.availability && f.availability.includes(x.availability))) return false;
        if (f?.maxDifficulty !== undefined && !("difficulty" in x && x.difficulty !== undefined && x.difficulty <= f.maxDifficulty)) return false;
        return true;
      });
  }

  column(table: Table, col: string | undefined, key: string): string | undefined | false {
    const c = col === "$subtype" ? this.sub.id : col;
    if (table.columns) {
      if (c === undefined) {
        this.warn(`${key}: table "${table.id}" has columns; the roll names none`);
        return false;
      }
      if (!table.columns.includes(c)) {
        this.warn(`${key}: table "${table.id}" has no column "${c}"`);
        return false;
      }
    }
    return c;
  }

  // A row is a duplicate when it grants a talent, exotic ability, mutation
  // or power the character already has.
  duplicate(row: TableRow): boolean {
    return row.effects.some((x) => {
      const t = thingOf(x);
      return !!t && t.kind !== "item" && this.owned[t.kind].has(t.id);
    });
  }

  roll(e: Extract<Effect, { roll: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const table = this.c.tables.get(e.roll);
    if (!table) {
      this.warn(`${key}: no table "${e.roll}"`);
      return;
    }
    const col = this.column(table, e.column, key);
    if (col === false) return;
    const dupes = !!(e.rerollDuplicates ?? table.rerollDuplicates);
    const slots: string[] = [];
    if (e.times === undefined) slots.push(key);
    else {
      const n = faceCount(parseDice(e.times)) === 0 ? parseDice(e.times).constant : this.dice(`${key}:count`, e.times, table.name, scope.parent).total;
      for (let i = 1; i <= n; i++) slots.push(`${key}#${i}`);
    }
    for (const slot of slots) {
      let done = false;
      for (let attempt = 1; attempt <= MAX_REROLLS && !done; attempt++) {
        const k = attempt === 1 ? slot : `${slot}~${attempt}`;
        const { total: t } = this.dice(k, table.die, table.name, scope.parent);
        const row = findRow(table, t, col);
        const last = this.log[this.log.length - 1];
        if (!row) {
          this.warn(`${k}: ${t} isn't on table "${table.id}"${col ? ` (${col})` : ""}`);
          done = true;
          break;
        }
        last.result = [row.label];
        if (dupes && this.duplicate(row)) {
          last.rerolled = true;
          continue;
        }
        done = true;
        this.rolls.push({ key: k, table: table.id, label: row.label });
        this.effects(row.effects, table, { prefix: `${k}>`, parent: k, section: scope.section, depth: scope.depth + 1 });
      }
      if (!done) this.warn(`${slot}: still a duplicate after ${MAX_REROLLS} rolls`);
    }
  }

  // Availability from the availability table; a row with a roll effect
  // rolls on (e.g. 6 → roll another D6: 6 → Legendary).
  availability(key: string, table: Table, parent: string, depth = 0): Availability | undefined {
    const { total: t } = this.dice(key, table.die, table.name, parent);
    const row = findRow(table, t);
    if (!row) {
      this.warn(`${key}: ${t} isn't on table "${table.id}"`);
      return undefined;
    }
    this.log[this.log.length - 1].result = [row.label];
    const own = availabilityOf(row.label);
    const next = row.effects.find((x): x is Extract<Effect, { roll: unknown }> => "roll" in x);
    if (next && depth < 4) {
      const sub = this.c.tables.get(next.roll);
      if (!sub) this.warn(`${key}: no table "${next.roll}"`);
      else {
        const a = this.availability(`${key}>${table.id}/${next.id}`, sub, key, depth + 1);
        if (a) return a;
      }
    }
    return own;
  }

  gear(e: Extract<Effect, { gear: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const g = e.gear;
    const n = faceCount(parseDice(g.count)) === 0 ? parseDice(g.count).constant : this.dice(`${key}:count`, g.count, src.name, scope.parent).total;
    const gen = this.c.tables.get(EQUIPMENT_GENERATOR);
    if (!gen) {
      this.warn(`${key}: no "${EQUIPMENT_GENERATOR}" table; gear not generated`);
      return;
    }
    const col = this.column(gen, gen.columns ? this.sub.id : undefined, key);
    if (col === false) return;
    const avt = this.c.tables.get(WEAPON_AVAILABILITY);
    if (!avt) this.warn(`${key}: no "${WEAPON_AVAILABILITY}" table; any allowed availability is used`);
    const alienOk = g.alien === true || (typeof g.alien === "object" && this.test(g.alien));
    const excluded = (it: Item) =>
      !!g.exclude?.some((x) => x === it.id || x === kebab(it.group) || (it.category !== undefined && x === kebab(it.category)));
    for (let i = 1; i <= n; i++) {
      const slot = `${key}#${i}`;
      let done = false;
      for (let attempt = 1; attempt <= MAX_REROLLS && !done; attempt++) {
        const k = attempt === 1 ? slot : `${slot}~${attempt}`;
        const { total: t } = this.dice(k, gen.die, gen.name, key);
        const row = findRow(gen, t, col);
        const genLog = this.log[this.log.length - 1];
        if (!row) {
          this.warn(`${k}: ${t} isn't on table "${gen.id}"${col ? ` (${col})` : ""}`);
          break;
        }
        genLog.result = [row.label];
        let avail = avt ? this.availability(`${k}:avail`, avt, k) : undefined;
        if (avt && !avail) break;
        if (avail && g.downgrade) {
          const idx = AVAILABILITIES.indexOf(avail) - g.downgrade;
          if (idx < 0) {
            // "If a Common item is downgraded, it is lost instead."
            done = true;
            this.rolls.push({ key: k, table: gen.id, label: row.label, availability: avail, lost: true });
            break;
          }
          avail = AVAILABILITIES[idx];
        }
        if (avail && !g.availability.includes(avail)) {
          genLog.rerolled = true;
          continue;
        }
        const inner: Scope = { prefix: `${k}>`, parent: k, section: scope.section, depth: scope.depth + 1 };
        const result: RollResult = { key: k, table: gen.id, label: row.label };
        if (avail) result.availability = avail;
        // A row with effects other than prose (a roll on a sub-table, a
        // grant) makes its gear through them instead of by category.
        if (row.effects.some((x) => !("prose" in x))) {
          done = true;
          this.rolls.push(result);
          this.effects(row.effects, gen, inner);
          break;
        }
        const inCategory = itemsByCategory(this.c).get(norm(row.label)) ?? [];
        if (!inCategory.length) {
          // nothing to pick from: keep the generated type for the GM
          done = true;
          this.rolls.push(result);
          this.effects(row.effects, gen, inner);
          this.warn(`${k}: no items of category "${row.label}"`);
          break;
        }
        const cands = inCategory.filter(
          (it) =>
            it.availability !== undefined &&
            (avail ? it.availability === avail : g.availability.includes(it.availability)) &&
            (alienOk || !it.alien) &&
            !excluded(it),
        );
        if (!cands.length) {
          genLog.rerolled = true;
          continue;
        }
        done = true;
        this.rolls.push(result);
        this.effects(row.effects, gen, inner);
        const ck = `${k}:item`;
        const label = avail ? `${avail} ${row.label}` : row.label;
        const { ids } = this.choose(ck, {
          kind: "gear-item",
          label,
          count: 1,
          options: cands.map((x) => ({ id: x.id, label: x.name })),
          source: src.id,
          parent: k,
        });
        for (const id of ids) this.grant("item", id, { ...this.origin(src, scope), key: ck }, { ...scope, parent: ck, depth: scope.depth + 1 });
      }
      if (!done) this.warn(`${slot}: no gear the character can have after ${MAX_REROLLS} rolls`);
    }
  }

  powers(e: Extract<Effect, { powers: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const p = e.powers;
    const n = faceCount(parseDice(p.count)) === 0 ? parseDice(p.count).constant : this.dice(`${key}:count`, p.count, src.name, scope.parent).total;
    const cands = this.poolOf("power", { maxDifficulty: p.maxDifficulty, discipline: p.disciplines }) as Ability[];
    const chosen: Ability[] = [];
    let limit = n;
    for (let i = 1; i <= limit; i++) {
      const k = `${key}#${i}`;
      const left = cands.filter((x) => !chosen.includes(x) && !this.owned.power.has(x.id));
      if (!left.length && !this.forced.has(k)) {
        this.warn(`${key}: no powers left to generate (${i - 1} of ${limit})`);
        break;
      }
      const { ids, complete } = this.choose(k, {
        kind: "power",
        label: src.name,
        count: 1,
        options: left.map((x) => ({ id: x.id, label: x.name })),
        source: src.id,
        parent: key,
      });
      if (!complete) break;
      const pw = ids.length ? this.c.powers.get(ids[0]) : undefined;
      if (!pw) {
        if (ids.length) this.warn(`${k}: unknown power "${ids[0]}"`);
        continue;
      }
      chosen.push(pw);
      if (p.crossDisciplinePenalty && new Set(chosen.map((x) => x.group ?? "")).size > 1) limit = n - p.crossDisciplinePenalty;
      if (i <= limit) this.grant("power", pw.id, { ...this.origin(src, scope), key: k }, { ...scope, parent: k, depth: scope.depth + 1 });
    }
  }

  // --- the result ---------------------------------------------------------

  character(record: CharacterRecord): Character {
    const human = this.arch.human !== false;
    const stats = {} as Record<Stat, StatLine>;
    for (const s of STATS) {
      let v = this.cur[s];
      for (const cap of this.caps[s]) {
        if (cap.max !== undefined) v = Math.min(v, cap.max);
        if (cap.min !== undefined) v = Math.max(v, cap.min);
      }
      if (human) v = Math.min(v, 100);
      stats[s] = { base: this.base[s], modified: v, final: v, overridden: false, mods: this.mods[s], caps: this.caps[s] };
    }
    const ch: Character = {
      name: record.name,
      archetype: { id: this.arch.id, name: this.arch.name },
      subtype: { id: this.sub.id, name: this.sub.name },
      options: this.options,
      stats,
      talents: [],
      exotics: [],
      mutations: [],
      powers: [],
      items: [],
      rolls: this.rolls,
      notes: this.notes,
      warnings: this.warnings,
      overridden: { stats: [], alignment: false, added: [], removed: [], choices: [...this.forcedUsed] },
    };
    if (this.alignment) ch.alignment = this.alignment;
    for (const o of record.overrides) this.override(o, ch);
    for (const key of this.forced.keys()) {
      if (!this.forcedUsed.has(key)) this.warn(`override: no choice "${key}" on this character`);
    }
    for (const k of ["talent", "exotic", "mutation", "power", "item"] as const) {
      (ch[KIND_MAP[k]] as Owned[]) = [...this.owned[k].values()];
    }
    return ch;
  }

  override(o: Override, ch: Character): void {
    switch (o.op) {
      case "stat":
        ch.stats[o.stat].final = o.value;
        ch.stats[o.stat].overridden = true;
        if (!ch.overridden.stats.includes(o.stat)) ch.overridden.stats.push(o.stat);
        return;
      case "alignment":
        ch.alignment = o.value;
        ch.overridden.alignment = true;
        return;
      case "add": {
        if (!this.c[KIND_MAP[o.kind]].has(o.id)) this.warn(`override: unknown ${o.kind} "${o.id}"`);
        const map = this.owned[o.kind] as Map<string, OwnedItem>;
        const origin: Origin = { entry: "override", override: true };
        const have = map.get(o.id);
        if (have) {
          have.from.push(origin);
          have.overridden = true;
          if (o.kind === "item") have.qty += o.qty ?? 1;
        } else {
          const t: Owned = { kind: o.kind, id: o.id, name: this.nameOf(o.kind, o.id), from: [origin], overridden: true };
          map.set(o.id, (o.kind === "item" ? { ...t, qty: o.qty ?? 1 } : t) as OwnedItem);
        }
        ch.overridden.added.push({ kind: o.kind, id: o.id });
        return;
      }
      case "remove":
        if (!this.owned[o.kind].delete(o.id)) this.warn(`override: no ${o.kind} "${o.id}" to remove`);
        ch.overridden.removed.push({ kind: o.kind, id: o.id });
        return;
      case "choice":
        return; // applied during the walk
    }
  }
}

/**
 * Build a character. Throws BuildError when the record's archetype or
 * subtype isn't in the compendium.
 */
export function build(c: Compendium, input: CharacterRecord, opts: BuildOptions): BuildResult {
  const arch = c.archetypes.get(input.archetype);
  if (!arch) throw new BuildError(`no archetype "${input.archetype}"`);
  const sub = arch.subtypes.find((s) => s.id === input.subtype);
  if (!sub) throw new BuildError(`archetype "${arch.id}" has no subtype "${input.subtype}"`);
  const rollDie = opts.roll ?? cryptoRoller();
  // Conditions on alignment can come before the alignment is chosen (gear
  // in the Equipment row, alignment in the last row). When a pass peeks at
  // an alignment not yet chosen, it is run again knowing the outcome,
  // keeping the dice it rolled and the alignment it chose but no other new
  // choice (those were made without knowing the alignment).
  let work = cloneRecord(input);
  let lookahead: Alignment | undefined;
  let pass!: Pass;
  const stale: string[] = [];
  for (let i = 0; i < 3; i++) {
    pass = new Pass(c, arch, sub, work, input, opts, rollDie, lookahead);
    pass.run();
    for (const w of pass.stale) if (!stale.includes(w)) stale.push(w);
    if (!pass.peekedAlignment || pass.alignment === lookahead || pass.alignment === undefined) break;
    lookahead = pass.alignment;
    const next = cloneRecord(input);
    next.dice = { ...work.dice };
    for (const k of pass.alignmentKeys) if (work.choices[k]) next.choices[k] = [...work.choices[k]];
    work = next;
  }
  for (const w of stale) if (!pass.warnings.includes(w)) pass.warnings.unshift(w);
  const record = cloneRecord(work);
  record.dice = Object.fromEntries(Object.entries(work.dice).filter(([k]) => pass.usedDice.has(k)));
  record.choices = Object.fromEntries(Object.entries(work.choices).filter(([k]) => pass.usedChoices.has(k)));
  const packs = c.packs.map((p) => p.id);
  if (!sameArray(packs, input.packs)) pass.warn(`record packs [${input.packs.join(", ")}] differ from the compendium's [${packs.join(", ")}]`);
  const character = pass.character(record);
  return { character, record, pending: pass.pending, log: pass.log, warnings: pass.warnings };
}

/** Convenience: a full random build from a seedless roller. */
export function buildRandom(c: Compendium, record: CharacterRecord, roll?: RollFn): BuildResult {
  return build(c, record, { mode: "random", roll });
}
