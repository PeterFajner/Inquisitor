// The engine: builds a character from a compendium and a character record.
//
// build() walks the archetype's stat line and sections, interpreting every
// effect. Each die roll and choice is a decision under a stable key
// (docs/ENGINE.md): decisions already in the record are reused; missing
// dice are rolled with opts.roll; missing choices are made at random
// (random mode) or returned as pending (freeform mode). The returned record
// holds exactly the decisions this character uses.
import { EQUIPMENT_GENERATOR, entryNames, type Compendium } from "../rules/compendium.ts";
import {
  AVAILABILITIES,
  DERIVED,
  LOCATIONS,
  QUALITIES,
  STATS,
  type Ability,
  type Alignment,
  type Archetype,
  type Availability,
  type Condition,
  type DerivedStat,
  type Dice,
  type Effect,
  type GrantCovers,
  type Item,
  type Location,
  type LocationSet,
  type Option,
  type PickFilter,
  type Quality,
  type Restriction,
  type Rule,
  type Stat,
  type StatFormula,
  type Subtype,
  type Table,
  type TableRow,
} from "../rules/schema.ts";
import { averageStats, faceCount, parseDice, rollFaces, total, validFaces } from "./dice.ts";
import { deriveStats } from "./derived.ts";
import { cloneRecord, THING_KINDS, type CharacterRecord, type Override, type ThingKind } from "./record.ts";
import { cryptoRoller } from "./rng.ts";

// Table ids the engine looks up by convention (docs/ENGINE.md).
export { EQUIPMENT_GENERATOR };
export const WEAPON_AVAILABILITY = "weapon-availability";
export const BIONICS_TABLE = "bionics-table";

/** A powers effect's pending option that rolls its table instead of naming a power. */
export const ROLL_OPTION = "@roll";

/** Most attempts at one roll that keeps being re-rolled (duplicates, gear). */
export const MAX_REROLLS = 200;
/** Most times a `times: any` trade is offered. */
export const MAX_TRADES = 20;
const MAX_DEPTH = 24;

export type RollFn = (sides: number) => number;
export type BuildMode = "random" | "freeform";

export type PendingChoice = {
  key: string;
  parent?: string;
  kind: "pick" | "pool" | "optional" | "alignment" | "gear-item" | "power" | "trade" | "give" | "upgrade" | "location";
  label: string; // the book's name of the entry (or table row) asking
  count: number; // how many to choose in total (the most, when `min` is set)
  min?: number; // open picks ("any", "up to N"): the fewest allowed
  options: { id: string; label: string }[];
  chosen: string[]; // valid choices already in the record (partial)
  source: string; // entry id
  section?: string; // the archetype's section (or the rule) it is met in, by the book's name
};

export type BuildOptions = {
  mode: BuildMode;
  roll?: RollFn; // (sides) => 1..sides; default: crypto RNG
  // Make a choice the record doesn't have (both modes); return undefined to
  // fall back to random (random mode) or pending (freeform mode).
  pick?: (p: PendingChoice) => string[] | undefined;
};

export type Origin = { entry: string; key?: string; section?: string; override?: boolean };
export type Owned = {
  kind: ThingKind;
  id: string;
  name: string;
  from: Origin[];
  overridden?: boolean;
  // per time its own effects ran: the book names of the options it chose
  // and table rows it rolled ("Stunning Sermon"; "Advanced", "Heart"), and
  // its bionic quality
  variants?: string[][];
  // picks made `into` it (a toxin in a needle pistol, a power in archeotech)
  chosen?: { key: string; kind: ThingKind; id: string; name: string }[];
  restricted?: boolean; // breaks one of the character's restrictions (an override)
};
export type OwnedItem = Owned & {
  qty: number;
  implanted?: boolean;
  reloads?: number;
  alterations?: string[];
  availability?: Availability; // for this character (availabilityWhen, alterations)
  profile?: Record<string, string>; // the profile for this wielder, when profileWhen changes it
};
export type StatMod = { add?: number; set?: number; multiply?: number; formula?: StatFormula; source: string; key?: string };
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
/** A roll the book makes at the start of each game (a roll's `eachGame`): not rolled now; `text` is the book's sentence. */
export type EachGame = { key: string; table: string; text: string; source: string };
/** An item pick under a table roll with nothing to choose from: named by the results that led to it ("Heavy weapon", ["Common"]). */
export type EmptyResult = { key: string; name: string; variants: string[]; source: string };

/** One armour effect as worn: a piece (best per location counts) or extra AV on top. */
export type ArmourPiece = {
  source: string; // entry id
  name: string; // the entry's name
  locations: Location[];
  av?: number; // a piece's AV
  add?: number; // extra AV (no av: on top of the best piece)
  field?: string; // force field dice
};
export type LocationArmour = { av: number; fields: string[]; from: string[] };
export type DerivedLine = {
  base: number; // the core rulebook's formula (with any "counts as" stat changes)
  value: number | "No"; // after adds and sets
  mods: { add?: number; set?: number | "No"; counts?: Partial<Record<Stat, number>>; source: string }[];
};
export type Attribute = { name: string; value: number; source: string };
export type NaturalWeapon = { name: string; profile: Record<string, string>; qty: number; source: string };

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
  eachGame: EachGame[]; // rolls left for the start of each game
  empty: EmptyResult[]; // item picks a roll led to with nothing to choose from
  notes: Note[];
  warnings: string[];
  overridden: {
    stats: Stat[];
    alignment: boolean;
    added: { kind: ThingKind; id: string }[];
    removed: { kind: ThingKind; id: string }[];
    choices: string[];
  };
  // --- the rest of the sheet (docs/ENGINE.md "The sheet")
  armour: Record<Location, LocationArmour>;
  armourPieces: ArmourPiece[];
  derived: Record<DerivedStat, DerivedLine>;
  attributes: Attribute[];
  weapons: NaturalWeapon[];
  wielded: { source: string; name: string; effects: string[] }[]; // effects only while that item is wielded
  taken: { kind: ThingKind; id: string; name: string; by: string }[]; // lost to a remove effect
  reloads: { add: number; multiply: number };
  psyker: boolean;
  companions: { archetype: string; subtype?: string; option?: string; source: string }[];
  locations: { source: string; location: string }[]; // chosen/rolled/added hit locations
  restrictions: (Restriction & { source: string; exclusive?: boolean })[];
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
  eachGame?: boolean; // not rolled: the book rolls it at the start of each game (result: its sentence)
  section?: string; // the archetype's section (or the rule) it is met in, by the book's name
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

type GrantExtra = {
  quality?: Quality;
  implanted?: boolean;
  reloads?: number;
  alterations?: string[];
  set?: Record<string, string[]>;
  again?: boolean;
  variant?: string;
  covers?: GrantCovers;
};

type Scope = {
  prefix: string;
  parent?: string;
  section?: string;
  depth: number;
  dupes?: boolean; // re-roll duplicates in table rolls (inherited from the roll above)
  qty?: { table: string; value: number }; // a roll's qty for items its row grants
  grant?: { quality?: Quality }; // bionics: the quality of items granted below
  preset?: { entry: string; answers: Record<string, string[]> }; // a grant's `set`
  slotAvail?: Availability; // the gear result being made (its row's effects and what they roll)
  matchAvail?: Availability; // a roll's matchAvailability: its rows' items must be of this
  only?: Set<string>; // powers a table roll may give (a powers effect's candidates)
  covers?: { entry: string; covers: GrantCovers }; // a grant's `covers` for the item's armour
};
type Source = { id: string; name: string; kind?: string };
// What a table roll checks its rows against (unusable).
//  inSlot: under a gear result (items the GM rules on are never generated);
//  matchAvail: items must be of this availability (a roll's matchAvailability).
type RollCtx = { dupes: boolean; inSlot?: boolean; matchAvail?: Availability; only?: Set<string> };
type Rx = Restriction & { source: string; exempt?: string; exclusive?: boolean; sig: string };
type Access = { pool: ThingKind; group: string[]; source: string; sig: string };
type Look = { alignment?: Alignment; rx: Rx[]; access: Access[] };
type Slot = {
  key: string;
  row: string;
  availability?: Availability;
  item?: string;
  qty: number;
  lost?: boolean;
  candidates: (a: Availability) => Item[];
  src: Source;
  scope: Scope;
};

const isOption = (o: Option | Effect): o is Option => "name" in o;

const thingOf = (e: Effect): { kind: ThingKind; id: string } | undefined => {
  if ("pick" in e) return undefined;
  for (const k of ["talent", "exotic", "item", "mutation", "power"] as const) {
    if (k in e) return { kind: k, id: (e as Record<string, string>)[k] };
  }
  return undefined;
};

const statList = (s: Stat | Stat[] | "all"): Stat[] => (s === "all" ? [...STATS] : Array.isArray(s) ? s : [s]);

const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Core rulebook rounding: fractions of a half or more round up. */
export const roundOff = (x: number) => Math.floor(x + 0.5);

/** Every hit location a location set covers. */
export function expandLocations(l: LocationSet | LocationSet[] | undefined): Location[] {
  const list = l === undefined ? ["all" as const] : Array.isArray(l) ? l : [l];
  const out = new Set<Location>();
  for (const x of list) {
    if (x === "all") LOCATIONS.forEach((y) => out.add(y));
    else if (x === "non-head") LOCATIONS.filter((y) => y !== "Head").forEach((y) => out.add(y));
    else if (x === "arms") ["Left Arm", "Right Arm"].forEach((y) => out.add(y as Location));
    else if (x === "legs") ["Left Leg", "Right Leg"].forEach((y) => out.add(y as Location));
    else out.add(x);
  }
  return LOCATIONS.filter((y) => out.has(y));
}

/** The availability named in a table row label ("Exotic*" → Exotic). */
const AVAILABILITY_RE = AVAILABILITIES.map((a) => [a, new RegExp(`\\b${a.toLowerCase()}\\b`)] as const);
export function availabilityOf(label: string): Availability | undefined {
  const l = label.toLowerCase();
  return AVAILABILITY_RE.find(([, re]) => re.test(l))?.[0];
}

/** Whether `row` is on `table`'s `column` (single-column tables: always). */
const inColumn = (row: TableRow, column?: string) => (column !== undefined && row.ranges ? row.ranges[column] : row.range) !== undefined;

/** The row of `table` a total lands on (in `column` for multi-column tables). */
export function findRow(table: Table, totalRolled: number, column?: string): TableRow | undefined {
  return table.rows.find((r) => {
    const range = column !== undefined && r.ranges ? r.ranges[column] : r.range;
    return range !== undefined && totalRolled >= range[0] && totalRolled <= range[1];
  });
}

/** The names an entry matches in filters and restrictions, exactly (entryNames). */
const names = new WeakMap<Ability | Item, Set<string>>();
export function namesOf(e: Ability | Item): Set<string> {
  let s = names.get(e);
  if (!s) names.set(e, (s = new Set(entryNames(e))));
  return s;
}
const matches = (e: Ability | Item, names: string[]) => {
  const own = namesOf(e);
  return names.some((n) => own.has(n));
};

/** Whether a power's difficulty is within `max`; a formula ("TT/2") always is. */
export function difficultyWithin(d: number | string | undefined, max: number): boolean {
  if (d === undefined) return false;
  if (typeof d === "number") return d <= max;
  return /^\d+$/.test(d.trim()) ? Number(d) <= max : true;
}

/** The subtype a subtypeDie total gives (Alien Bounty Hunter's experience). */
export function subtypeFor(arch: Archetype, totalRolled: number): Subtype | undefined {
  return arch.subtypes.find((s) => s.range && totalRolled >= s.range[0] && totalRolled <= s.range[1]);
}
/** The record key for an archetype's subtype roll. */
export const subtypeKey = (arch: Archetype) => `${arch.id}/@subtype`;
/** Roll an archetype's subtype (when it has a subtypeDie): store `faces` under `key`. */
export function rollSubtype(arch: Archetype, roll: RollFn = cryptoRoller()): { key: string; faces: number[]; subtype?: Subtype } {
  const e = parseDice(arch.subtypeDie ?? "D1");
  const faces = rollFaces(e, roll);
  return { key: subtypeKey(arch), faces, subtype: subtypeFor(arch, total(e, faces)) };
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
      const k = it.category;
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
  for (const m of [c.talents, c.exotics, c.mutations, c.powers, c.items, c.rules] as Map<string, unknown>[]) sortedCache.delete(m);
  categoryCache.delete(c.items);
}

/**
 * An item's armour as worn, from its own armour effects (fixed values only;
 * `as` follows the other item). Dice AV is taken at its lowest.
 */
export function itemArmour(c: Compendium, item: Item, depth = 0): Omit<ArmourPiece, "source" | "name">[] {
  const out: Omit<ArmourPiece, "source" | "name">[] = [];
  for (const e of item.effects ?? []) {
    if (!("armour" in e)) continue;
    const a = e.armour;
    const fixed = (d: Dice | undefined) => (d === undefined ? undefined : parseDice(d).dice.length ? undefined : parseDice(d).constant);
    let base: Omit<ArmourPiece, "source" | "name">[] = [];
    if (a.as && depth < 4) {
      const ref = c.items.get(a.as);
      if (ref) base = itemArmour(c, ref, depth + 1);
    }
    const av = fixed(a.av);
    const add = fixed(a.add) ?? 0;
    const locs = a.locations !== undefined ? expandLocations(a.locations) : undefined;
    if (a.as) {
      if (!base.length) base = [{ locations: expandLocations(undefined), av: 0 }];
      for (const b of base) {
        const p = { ...b, locations: locs ?? b.locations, av: (av ?? b.av ?? 0) + add };
        if (a.field !== undefined) p.field = String(a.field);
        out.push(p);
      }
    } else {
      const p: Omit<ArmourPiece, "source" | "name"> = { locations: locs ?? expandLocations(undefined) };
      if (av !== undefined) p.av = av + add;
      else if (a.add !== undefined) p.add = add;
      if (a.field !== undefined) p.field = String(a.field);
      out.push(p);
    }
  }
  return out;
}
const bestAvCache = new WeakMap<Item, number | undefined>();
/** An item's best AV on any location (undefined when it isn't armour). */
export function bestAV(c: Compendium, item: Item): number | undefined {
  if (bestAvCache.has(item)) return bestAvCache.get(item);
  const avs = itemArmour(c, item).flatMap((p) => (p.av !== undefined ? [p.av] : []));
  const v = avs.length ? Math.max(...avs) : undefined;
  bestAvCache.set(item, v);
  return v;
}

const sameArray = (a: unknown[] | undefined, b: unknown[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

const rxSig = (r: Omit<Rx, "sig">) => JSON.stringify(r);
const sigs = (xs: { sig: string }[]) => xs.map((x) => x.sig).sort().join("\n");

function toRx(e: Effect, src: Source): Rx | undefined {
  if ("restrict" in e) {
    const r = { ...e.restrict, source: src.id };
    return { ...r, sig: rxSig(r) };
  }
  if ("exclusive" in e) {
    const r = { ...e.exclusive, source: src.id, exempt: src.id, exclusive: true };
    return { ...r, sig: rxSig(r) };
  }
  return undefined;
}
function toAccess(e: Effect, src: Source): Access | undefined {
  if (!("access" in e)) return undefined;
  const a = { pool: e.access.pool, group: e.access.group, source: src.id };
  return { ...a, sig: JSON.stringify(a) };
}

// One walk over the rules. build() may run more (see lookahead).
class Pass {
  c: Compendium;
  arch: Archetype;
  sub: Subtype;
  rec: CharacterRecord; // working copy: input + new decisions
  orig: CharacterRecord;
  opts: BuildOptions;
  rollDie: RollFn;
  look: Look;
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
  eachGame: EachGame[] = [];
  empty: EmptyResult[] = [];
  notes: Note[] = [];

  // constraints met this pass (compared with the lookahead)
  metRx: Rx[] = [];
  metAccess: Access[] = [];
  seedRx: Rx[] = []; // what the archetype states outright (seedLook)
  section?: string; // the archetype section or rule being walked (log and pending labels)
  armour: ArmourPiece[] = [];
  derivedMods: (DerivedLine["mods"][number] & { derived: DerivedStat })[] = [];
  attrs: { name: string; op: "set" | "add"; value: number | StatFormula; source: string }[] = [];
  weapons: NaturalWeapon[] = [];
  wielded: Character["wielded"] = [];
  removals: { kind: ThingKind; id: string; source: string }[] = [];
  reloadMods: { add?: number; multiply?: number; source: string }[] = [];
  psykerFlag: string[] = []; // sources of { psyker: true }
  companions: Character["companions"] = [];
  locations: Character["locations"] = [];
  slots: Slot[] = [];
  gearAvail = new Set<Availability>();
  slotAvail?: Availability; // the gear result being made (the `availability` condition)
  lastGear?: Availability[];
  collect: { entry: string; list: string[] }[] = [];

  constructor(
    c: Compendium,
    arch: Archetype,
    sub: Subtype,
    rec: CharacterRecord,
    orig: CharacterRecord,
    opts: BuildOptions,
    rollDie: RollFn,
    look: Look,
  ) {
    this.c = c;
    this.arch = arch;
    this.sub = sub;
    this.rec = rec;
    this.orig = orig;
    this.opts = opts;
    this.rollDie = rollDie;
    this.look = look;
    for (const o of rec.overrides) if (o.op === "choice") this.forced.set(o.key, o.value);
  }

  warn(m: string) {
    if (!this.warnings.includes(m)) this.warnings.push(m);
  }

  // What an archetype, rule or table adds (not a thing the character owns):
  // kept whatever things come and go, even when a thing shares its id
  // (the Cherubim archetype and the cherubim item).
  fixed = new WeakSet<object>();
  from<T extends object>(src: Source, x: T): T {
    if (!src.kind || !(THING_KINDS as readonly string[]).includes(src.kind)) this.fixed.add(x);
    return x;
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
      ...(this.section ? { section: this.section } : {}),
      ...extra,
    });
    return { total: t, faces };
  }

  value(scope: Scope, base: string, d: Dice, label: string): number {
    if (faceCount(parseDice(d)) === 0) return parseDice(d).constant;
    return this.dice(this.alloc(scope, base), d, label, scope.parent).total;
  }

  count(key: string, d: Dice, label: string, parent?: string): number {
    return faceCount(parseDice(d)) === 0 ? parseDice(d).constant : this.dice(`${key}:count`, d, label, parent).total;
  }

  // Returns the chosen ids (possibly partial when pending).
  //  x.min: open picks may choose fewer (min..count)
  //  x.randomDefault: random mode's answer when nothing is stored (trades: "no")
  //  x.randomCount: how many random mode chooses (open picks)
  //  x.preset: the rules' own answer (a grant's `set`), taken as given
  choose(
    key: string,
    p: Omit<PendingChoice, "key" | "chosen">,
    distinct = true,
    x: { min?: number; randomDefault?: string[]; randomCount?: () => number; preset?: string[] } = {},
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
        ...(this.section ? { section: this.section } : {}),
      });
    const f = this.forced.get(key);
    if (f) {
      this.forcedUsed.add(key);
      logIt(f, true);
      return { ids: [...f], complete: true };
    }
    if (x.preset) {
      const ids = x.preset.filter((id) => names.has(id));
      if (ids.length !== x.preset.length) this.warn(`${key}: set [${x.preset.join(", ")}] isn't among the options`);
      this.rec.choices[key] = ids;
      logIt(ids);
      return { ids, complete: true };
    }
    let count = p.count;
    if (distinct && count > p.options.length) {
      if (p.options.length < count && x.min === undefined) this.warn(`${key}: only ${p.options.length} to choose from, ${count} wanted`);
      count = p.options.length;
    }
    const lo = Math.min(x.min ?? count, count);
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
    if (stored && valid.length >= lo && valid.length <= count && stored.length === valid.length) {
      logIt(valid);
      return { ids: valid, complete: true };
    }
    // (a choice carried from an earlier pass, made before a restriction was known, is just made again)
    if (stored && stored.length && valid.length !== stored.length && sameArray(this.orig.choices[key], stored)) {
      this.warn(`${key}: stored choice [${stored.join(", ")}] isn't allowed now; chosen again`);
    }
    const pend: PendingChoice = { ...p, key, count, chosen: [...valid] };
    if (this.section) pend.section = this.section;
    if (x.min !== undefined) pend.min = lo;
    let ids: string[] | undefined;
    if (distinct && lo === count && p.options.length === count) ids = p.options.map((o) => o.id);
    if (!ids && this.opts.pick) {
      const got = this.opts.pick(pend);
      if (got) {
        const ok = got.filter((id) => names.has(id));
        if (ok.length === got.length && ok.length >= lo && ok.length <= count && (!distinct || new Set(ok).size === ok.length)) ids = ok;
        else this.warn(`${key}: pick() gave [${got.join(", ")}], which doesn't fit`);
      }
    }
    if (!ids && this.opts.mode === "random") {
      if (x.randomDefault) ids = [...x.randomDefault];
      else {
        const want = x.randomCount ? Math.max(0, Math.min(count, x.randomCount())) : count;
        ids = valid.slice(0, want);
        while (ids.length < want) {
          const rest = distinct ? p.options.filter((o) => !ids!.includes(o.id)) : p.options;
          ids.push(rest[this.rollDie(rest.length) - 1].id);
        }
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
      this.cur[s] = this.rolled(s);
    }
    if (this.arch.subtypeDie && this.rec.dice[subtypeKey(this.arch)]) {
      const { total: t } = this.dice(subtypeKey(this.arch), this.arch.subtypeDie, this.arch.name);
      const s = subtypeFor(this.arch, t);
      this.log[this.log.length - 1].result = [s?.name ?? String(t)];
      if (s?.id !== this.sub.id) this.warn(`${subtypeKey(this.arch)}: ${t} gives ${s?.id ?? "no subtype"}, not ${this.sub.id}`);
    }
    const rules = sortedValues(this.c.rules).filter((r) => r.apply && r.effects?.length);
    const done = new Set<string>();
    const runRule = (r: Rule) => {
      done.add(r.id);
      this.section = r.name;
      this.effects(r.effects!, r, { prefix: "", section: r.name, depth: 0 });
    };
    const at = (r: Rule, where: "after" | "before", section: string) =>
      typeof r.apply === "object" && r.apply[where] === section;
    for (const section of this.arch.sections) {
      for (const r of rules) if (!done.has(r.id) && at(r, "before", section.name)) runRule(r);
      this.section = section.name;
      this.effects(section.effects, this.arch, { prefix: "", section: section.name, depth: 0 });
      for (const r of rules) if (!done.has(r.id) && at(r, "after", section.name)) runRule(r);
    }
    for (const r of rules) if (!done.has(r.id)) runRule(r);
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

  presetFor(src: Source, scope: Scope, id: string): string[] | undefined {
    return scope.preset && scope.preset.entry === src.id ? scope.preset.answers[id] : undefined;
  }

  variant(src: Source, label: string): void {
    const top = this.collect[this.collect.length - 1];
    if (top && top.entry === src.id && label && !top.list.includes(label)) top.list.push(label);
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
      const g = e as GrantExtra & { qty?: Dice };
      let qty = 1;
      if (thing.kind === "item" && scope.qty && scope.qty.table === src.id) qty = scope.qty.value;
      else if (g.qty !== undefined) qty = this.value(scope, `${src.id}/@${thing.id}`, g.qty, this.nameOf(thing.kind, thing.id));
      this.grant(thing.kind, thing.id, this.origin(src, scope), scope, qty, g);
      return;
    }
    if ("pick" in e) return this.pick(e, src, scope);
    if ("optional" in e) {
      const key = this.alloc(scope, `${src.id}/${e.id}`);
      const { ids } = this.choose(
        key,
        {
          kind: "optional",
          label: src.name,
          count: 1,
          options: [
            { id: "yes", label: this.describe(e.optional) },
            { id: "no", label: "" },
          ],
          source: src.id,
          parent: scope.parent,
        },
        true,
        { preset: this.presetFor(src, scope, e.id) },
      );
      if (ids[0] === "yes") this.effects(e.optional, src, { ...scope, parent: key, depth: scope.depth + 1 });
      return;
    }
    if ("chance" in e) {
      const key = this.alloc(scope, `${src.id}/${e.id}`);
      const preset = this.presetFor(src, scope, e.id);
      let hit: boolean;
      if (preset) hit = preset[0] === "then";
      else if (typeof e.chance === "number") hit = this.dice(key, "D100", src.name, scope.parent).total <= e.chance;
      else hit = e.chance.on.includes(this.dice(key, e.chance.die, src.name, scope.parent).total);
      this.effects(hit ? e.then : (e.else ?? []), src, { ...scope, parent: key, depth: scope.depth + 1 });
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
    if ("armour" in e) return this.armourEffect(e, src, scope);
    if ("restrict" in e || "exclusive" in e) {
      const r = toRx(e, src)!;
      if (!this.metRx.some((x) => x.sig === r.sig)) this.metRx.push(r);
      return;
    }
    if ("access" in e) {
      const a = toAccess(e, src)!;
      if (!this.metAccess.some((x) => x.sig === a.sig)) this.metAccess.push(a);
      return;
    }
    if ("derived" in e) {
      const list = Array.isArray(e.derived) ? e.derived : [e.derived];
      const add = e.add === undefined ? undefined : this.value(scope, `${src.id}/${e.id ?? "@" + list.join("+")}`, e.add, src.name);
      list.forEach((d, i) => {
        const m: (typeof this.derivedMods)[number] = { derived: d, source: src.id };
        if (add !== undefined) m.add = add;
        if (e.set !== undefined) m.set = Array.isArray(e.set) ? e.set[i] : e.set;
        if (e.counts) m.counts = e.counts;
        this.derivedMods.push(this.from(src, m));
      });
      return;
    }
    if ("attribute" in e) {
      for (const op of ["set", "add"] as const) {
        const v = e[op];
        if (v === undefined) continue;
        const value = typeof v === "object" ? v : this.value(scope, `${src.id}/${e.id ?? "@" + kebab(e.attribute)}`, v, e.attribute);
        this.attrs.push(this.from(src, { name: e.attribute, op, value, source: src.id }));
      }
      return;
    }
    if ("wielded" in e) {
      this.wielded.push(this.from(src, { source: src.id, name: src.name, effects: e.wielded.map((x) => this.labelOf(x)).filter(Boolean) }));
      return;
    }
    if ("remove" in e) {
      for (const k of ["talent", "exotic", "item", "mutation", "power"] as const) {
        for (const id of e.remove[k] ?? []) this.removals.push({ kind: k, id, source: src.id });
      }
      return;
    }
    if ("reloads" in e && typeof e.reloads === "object") {
      this.reloadMods.push(this.from(src, { ...e.reloads, source: src.id }));
      return;
    }
    if ("trade" in e) return this.trade(e, src, scope);
    if ("upgrade" in e) {
      const key = this.alloc(scope, `${src.id}/${e.id}`);
      const slot = this.chooseSlots(key, 1, src, scope, "upgrade")[0];
      if (slot) this.shift(slot, e.upgrade, key);
      return;
    }
    if ("bionics" in e) return this.bionics(e, src, scope);
    if ("weapon" in e) {
      this.weapons.push(this.from(src, { name: e.weapon.name ?? src.name, profile: e.weapon.profile, qty: e.weapon.qty ?? 1, source: src.id }));
      return;
    }
    if ("psyker" in e) {
      this.psykerFlag.push(src.id);
      return;
    }
    if ("companion" in e) {
      this.companions.push(this.from(src, { ...e.companion, source: src.id }));
      return;
    }
    if ("warband" in e) return; // checked across a warband (warbandWarnings)
    if ("location" in e) {
      if ("add" in e.location) {
        this.locations.push({ source: src.id, location: e.location.add });
        return;
      }
      const le = e as { id: string; location: { from: Location[]; random?: boolean } };
      const key = this.alloc(scope, `${src.id}/${le.id}`);
      const from = le.location.from;
      let loc: string | undefined;
      if (le.location.random) {
        const { total: t } = this.dice(key, `D${from.length}`, src.name, scope.parent);
        loc = from[t - 1];
        this.log[this.log.length - 1].result = [loc];
      } else {
        const { ids } = this.choose(key, {
          kind: "location",
          label: src.name,
          count: 1,
          options: from.map((l) => ({ id: l, label: l })),
          source: src.id,
          parent: scope.parent,
        });
        loc = ids[0];
      }
      if (loc) {
        this.locations.push({ source: src.id, location: loc });
        this.variant(src, loc);
      }
      return;
    }
  }

  test(c: Condition): boolean {
    if ("alignment" in c) {
      let a = this.alignment;
      if (a === undefined) {
        this.peekedAlignment = true;
        a = this.look.alignment;
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
    if ("all" in c) return c.all.every((x) => this.test(x));
    if ("stat" in c) {
      const v = this.cur[c.stat];
      return (c.below === undefined || v < c.below) && (c.above === undefined || v > c.above);
    }
    if ("rolled" in c) return this.rolls.some((r) => c.rolled.includes(r.table));
    if ("psyker" in c) return this.isPsyker() === c.psyker;
    if ("availability" in c) return this.slotAvail !== undefined && c.availability.includes(this.slotAvail);
    return c.generates.some((a) => this.gearAvail.has(a));
  }

  isPsyker(): boolean {
    return this.psykerFlag.length > 0 || this.owned.power.size > 0 || this.sub.id === "psyker";
  }

  // The rolled stat line, capped for humans: p3 "Human characters' stats
  // can't surpass 100" applies to the roll (step A); bonuses afterwards
  // (boons, equipment, multipliers) may take a stat past 100.
  rolled(s: Stat): number {
    return this.arch.human !== false ? Math.min(this.base[s], 100) : this.base[s];
  }

  // The stat's value from its base and mods (adds and sets in order; formulas
  // and multiplies come at the end).
  fold(s: Stat): number {
    let v = this.rolled(s);
    for (const m of this.mods[s]) {
      if (m.formula || m.multiply !== undefined) continue;
      if (m.set !== undefined) v = m.set;
      else if (m.add !== undefined) v += m.add;
    }
    return v;
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
    if (e.add !== undefined) {
      if (typeof e.add === "object") for (const s of stats) this.mods[s].push({ formula: e.add, source: src.id });
      else apply("add", e.add);
    }
    if (e.multiply !== undefined) for (const s of stats) this.mods[s].push({ multiply: e.multiply, source: src.id });
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

  grant(kind: ThingKind, id: string, origin: Origin, scope: Scope, qty = 1, extra: GrantExtra = {}): void {
    const entry = this.c[KIND_MAP[kind]].get(id) as Ability | Item | undefined;
    if (!entry) this.warn(`unknown ${kind} "${id}" (from ${origin.entry})`);
    const map = this.owned[kind] as Map<string, OwnedItem>;
    let have = map.get(id);
    if (have) {
      have.from.push(origin);
      if (kind === "item") have.qty += qty;
    } else {
      const o: Owned = { kind, id, name: entry?.name ?? id, from: [origin] };
      have = (kind === "item" ? { ...o, qty } : o) as OwnedItem;
      map.set(id, have);
    }
    if (kind === "item") {
      if (extra.implanted) have.implanted = true;
      if (extra.reloads !== undefined) have.reloads = (have.reloads ?? 0) + extra.reloads;
      if (extra.alterations?.length) have.alterations = [...(have.alterations ?? []), ...extra.alterations];
    }
    const quality = extra.quality ?? (kind === "item" ? scope.grant?.quality : undefined);
    // a quality answers the item's own `quality` decision: a roll's row label
    // (Bionic Quality: "Average"), else a pick's option id ("average")
    const qRoll = !!entry?.effects?.some((x) => "roll" in x && x.id === "quality");
    const set: Record<string, string[]> = { ...(quality ? { quality: [qRoll ? quality : quality.toLowerCase()] } : {}), ...extra.set };
    const tag = `${kind}/${id}`;
    // Effects run once per thing, except: a grant that says so (again, set,
    // a quality), and items whose effects decide something (each Bionic
    // Organs rolls its own organ, each needle pistol holds its own toxin).
    const decides = kind === "item" && !!entry?.effects?.some((x) => "pick" in x || "roll" in x || "chance" in x || "optional" in x);
    // (a grant that says what its armour covers makes its own pieces)
    const rerun = extra.again || extra.set !== undefined || quality !== undefined || extra.covers !== undefined || decides;
    const frame = { entry: id, list: [...(extra.variant ? [extra.variant] : []), ...(quality ? [quality] : [])] };
    if (entry?.effects?.length && (!this.applied.has(tag) || rerun)) {
      this.applied.add(tag);
      this.collect.push(frame);
      const inner: Scope = { prefix: scope.prefix, parent: scope.parent, depth: scope.depth + 1 };
      if (Object.keys(set).length) inner.preset = { entry: id, answers: set };
      if (extra.covers) inner.covers = { entry: id, covers: extra.covers };
      this.effects(entry.effects, entry, inner);
      this.collect.pop();
    }
    if (frame.list.length) (have.variants ??= []).push(frame.list);
  }

  // Take one (or qty) of a thing away again, with what its own effects added.
  ungrant(kind: ThingKind, id: string, qty = 1): boolean {
    const map = this.owned[kind] as Map<string, OwnedItem>;
    const have = map.get(id);
    if (!have) return false;
    if (kind === "item" && have.qty > qty) {
      have.qty -= qty;
      return true;
    }
    map.delete(id);
    this.applied.delete(`${kind}/${id}`);
    const keep = <T extends { source: string }>(xs: T[]) => xs.filter((x) => x.source !== id || this.fixed.has(x));
    this.armour = keep(this.armour);
    this.derivedMods = keep(this.derivedMods);
    this.attrs = keep(this.attrs);
    this.weapons = keep(this.weapons);
    this.wielded = keep(this.wielded);
    this.removals = keep(this.removals);
    this.reloadMods = keep(this.reloadMods);
    this.companions = keep(this.companions);
    this.locations = keep(this.locations);
    this.metRx = keep(this.metRx);
    this.metAccess = keep(this.metAccess);
    this.notes = keep(this.notes);
    this.psykerFlag = this.psykerFlag.filter((x) => x !== id);
    for (const s of STATS) {
      this.mods[s] = keep(this.mods[s]);
      this.caps[s] = keep(this.caps[s]);
      this.cur[s] = this.fold(s);
    }
    for (const sl of this.slots) if (sl.item === id) sl.item = undefined;
    return true;
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
      if (o.add !== undefined && typeof o.add !== "object") return `${typeof o.add === "number" && o.add >= 0 ? "+" : ""}${o.add} ${st}`;
      if (o.set !== undefined) return `${st} ${o.set}`;
      return st;
    }
    if ("roll" in o) return this.c.tables.get(o.roll)?.name ?? o.roll;
    if ("prose" in o) return o.prose;
    if ("weapon" in o) return o.weapon.name ?? "";
    if ("then" in o && !("chance" in o)) return this.describe(o.then);
    return "";
  }

  // --- restrictions -------------------------------------------------------

  activeRx(): Rx[] {
    const out = [...this.look.rx];
    for (const r of this.metRx) if (!out.some((x) => x.sig === r.sig)) out.push(r);
    return out;
  }

  accessGroups(kind: ThingKind): string[] {
    const out: string[] = [];
    for (const a of [...this.look.access, ...this.metAccess]) if (a.pool === kind) out.push(...a.group);
    return out;
  }

  /** The item's availability for this character (availabilityWhen). */
  availabilityFor(it: Item): Availability | undefined {
    const w = it.availabilityWhen;
    if (!w) return it.availability;
    if (this.test(w.when)) return w.then ?? it.availability;
    return w.else === "gm" ? undefined : w.else;
  }

  availOk(it: Item, list: Availability[], exact?: Availability): boolean {
    if (it.unrestricted) return true;
    const a = this.availabilityFor(it);
    return a !== undefined && (exact ? a === exact : list.includes(a));
  }

  /** Whether the character may have this entry (restrictions, requires). */
  allowed(kind: ThingKind, x: Ability | Item): boolean {
    if (x.kind === "item" && x.requires && !this.test(x.requires)) return false;
    for (const r of this.activeRx()) {
      if (r.pool !== kind || r.exempt === x.id) continue;
      const scope = [...(r.group ?? []), ...(r.category ?? []), ...(r.tag ?? [])];
      if (scope.length && !matches(x, scope)) continue;
      if (r.exclusive) return false;
      if (r.only && !matches(x, r.only)) return false;
      if (r.except && matches(x, r.except)) return false;
      if (r.alien === false && x.kind === "item" && x.alien) return false;
      if (r.maxAV !== undefined && x.kind === "item") {
        const av = bestAV(this.c, x);
        if (av !== undefined && av > r.maxAV) return false;
      }
    }
    return true;
  }

  // --- picks --------------------------------------------------------------

  pick(e: Extract<Effect, { pick: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const open = e.pick === "any" || typeof e.pick === "object";
    const count = e.pick === "any" ? Infinity : typeof e.pick === "object" ? e.pick.max : this.count(key, e.pick, src.name, scope.parent);
    const distinct = e.distinct !== false;
    const inner: Scope = { ...scope, parent: key, depth: scope.depth + 1 };
    const x: Parameters<Pass["choose"]>[3] = { preset: this.presetFor(src, scope, e.id) };
    const countDice = e.random ?? (typeof e.pick === "object" ? `D${count + 1}-1` : undefined);
    if (open) {
      x.min = 0;
      x.randomCount = () => (countDice === undefined ? 0 : this.count(key, countDice, src.name, scope.parent));
    }
    // a random count already rolled stays in the record
    const keepCount = () => {
      if (open && countDice !== undefined && this.rec.dice[`${key}:count`] && !this.usedDice.has(`${key}:count`)) {
        this.count(key, countDice, src.name, scope.parent);
      }
    };
    const into = e.into ? this.intoTarget(e.into, src, key) : undefined;
    let qtyValue: number | undefined;
    const qtyOf = () => (qtyValue ??= e.qty === undefined ? 1 : this.value(scope, `${src.id}/${e.id}:qty`, e.qty, src.name));
    if (e.from) {
      const opts = e.from
        .map((o, i) => ({ id: this.optionId(o, i), label: this.labelOf(o), o }))
        .filter(({ o }) => {
          if (x.preset) return true; // the rules' own answer: every option stands
          if (isOption(o)) {
            if (o.when && !this.test(o.when)) return false;
            // the same pick run again (a second Word of the Emperor) offers what's left
            return !this.options.some((c) => c.source === src.id && c.id === o.id);
          }
          const t = thingOf(o);
          if (!t || t.kind === "item") return true;
          const entry = this.c[KIND_MAP[t.kind]].get(t.id) as Ability | undefined;
          if (entry && !this.allowed(t.kind, entry)) return false;
          if (scope.dupes) return !this.isDuplicate(t.kind, t.id);
          return e.filter?.owned !== false || !this.owned[t.kind].has(t.id);
        });
      const { ids } = this.choose(
        key,
        {
          kind: "pick",
          label: src.name,
          count: Math.min(count, open ? opts.length : count),
          options: opts.map(({ id, label }) => ({ id, label })),
          source: src.id,
          parent: scope.parent,
        },
        distinct,
        x,
      );
      keepCount();
      for (const id of ids) {
        const o = opts.find((y) => y.id === id)?.o ?? e.from.find((y, i) => this.optionId(y, i) === id);
        if (!o) {
          this.warn(`${key}: "${id}" isn't one of the options`);
          continue;
        }
        if (isOption(o)) {
          const co: ChosenOption = { id: o.id, name: o.name, key, source: src.id };
          if (o.text) co.text = o.text;
          this.options.push(co);
          this.variant(src, o.name);
          this.effects(o.effects ?? [], src, inner);
          continue;
        }
        const t = thingOf(o);
        if (t && into) {
          into.push({ key, kind: t.kind, id: t.id, name: this.nameOf(t.kind, t.id) });
          continue;
        }
        if (t && t.kind === "item" && (e.qty !== undefined || e.implanted)) {
          const g = o as GrantExtra & { qty?: Dice };
          const q = e.qty !== undefined ? qtyOf() : g.qty !== undefined ? this.value(inner, `${src.id}/@${t.id}`, g.qty, src.name) : 1;
          this.grant("item", t.id, this.origin(src, inner), inner, q, { ...g, implanted: e.implanted || g.implanted });
          continue;
        }
        this.effects([o], src, inner);
      }
      return;
    }
    const kind = e.pool!;
    const cands = this.poolOf(kind, e.filter);
    // A roll that led to an item with nothing to choose from (no Common heavy
    // weapon exists): the character still shows what was rolled.
    if (kind === "item" && !cands.length && !open && count > 0 && !x.preset && !this.forced.has(key)) {
      const chain = this.rolledChain(scope.parent);
      if (chain.length) this.empty.push({ key, name: chain[0], variants: chain.slice(1), source: src.id });
    }
    const { ids } = this.choose(
      key,
      {
        kind: "pool",
        label: src.name,
        count: Math.min(count, open ? cands.length : count),
        options: cands.map((y) => ({ id: y.id, label: y.name })),
        source: src.id,
        parent: scope.parent,
      },
      distinct,
      x,
    );
    keepCount();
    for (const id of ids) {
      if (!this.c[KIND_MAP[kind]].has(id)) {
        this.warn(`${key}: unknown ${kind} "${id}"`);
        continue;
      }
      if (into) {
        into.push({ key, kind, id, name: this.nameOf(kind, id) });
        continue;
      }
      const qty = kind === "item" ? qtyOf() : 1;
      this.grant(kind, id, { ...this.origin(src, scope), key }, inner, qty, e.implanted ? { implanted: true } : {});
    }
  }

  /** The table results that led to `key`, outermost first, through chances and choices ("Heavy weapon", "Common"). */
  rolledChain(key: string | undefined): string[] {
    const byKey = new Map(this.log.map((l) => [l.key, l]));
    const results = new Map(this.rolls.map((r) => [r.key, r.label]));
    const out: string[] = [];
    const seen = new Set<string>();
    for (let k = key; k !== undefined && !seen.has(k); k = byKey.get(k)?.parent) {
      seen.add(k);
      const r = results.get(k);
      if (r !== undefined) out.unshift(r);
    }
    return out;
  }

  intoTarget(into: string, src: Source, key: string): NonNullable<Owned["chosen"]> | undefined {
    let o: Owned | undefined;
    if (into === "self") {
      const kind = (src as { kind?: string }).kind;
      if (kind && kind in KIND_MAP) o = this.owned[kind as ThingKind].get(src.id);
    } else o = this.owned.item.get(into);
    if (!o) {
      this.warn(`${key}: nothing to put the pick into ("${into}"); given to the character`);
      return undefined;
    }
    return (o.chosen ??= []);
  }

  poolOf(kind: ThingKind, f?: PickFilter): (Ability | Item)[] {
    const groups = f?.group ? [...f.group, ...this.accessGroups(kind)] : undefined;
    const disciplines = f?.discipline ? [...f.discipline, ...this.accessGroups("power")] : undefined;
    const inList = (g: string | undefined, list: string[]) => g !== undefined && list.includes(g);
    return sortedValues(this.c[KIND_MAP[kind]] as Map<string, Ability | Item>).filter((x) => {
      const owned = this.owned[kind].has(x.id);
      if (f?.owned === true ? !owned : (f?.owned === false || kind !== "item") && owned) return false;
      if (groups && !inList(x.group, groups)) return false;
      if (disciplines && !inList(x.group, disciplines)) return false;
      if (f?.category && !(x.kind === "item" && x.category && f.category.includes(x.category))) return false;
      if (f?.tag && !matches(x, f.tag)) return false;
      if (f?.exclude && matches(x, f.exclude)) return false;
      if (f?.availability && !(x.kind === "item" && this.availOk(x, f.availability))) return false;
      if (f?.maxDifficulty !== undefined && !("difficulty" in x && difficultyWithin(x.difficulty, f.maxDifficulty))) return false;
      return f?.owned === true || this.allowed(kind, x);
    });
  }

  // --- tables -------------------------------------------------------------

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

  // A row is re-rolled when it grants a talent, exotic ability, mutation or
  // power the character already has (duplicates; also one its profile grants
  // in a later section), anything the character can't have (restrictions), a
  // power the powers effect rolling it doesn't allow, an item failing
  // `unless`, under a gear result an item of another availability, a row
  // `onlyRows` doesn't name, or a row whose own rolls can't land anywhere.
  unusable(row: TableRow, dupes: boolean, unless?: { profile: string; includes: string }, scope?: Scope, onlyRows?: string[]): boolean {
    if (onlyRows && !onlyRows.includes(row.label)) return true;
    const ctx: RollCtx = { dupes, inSlot: !!scope?.slotAvail, matchAvail: scope?.matchAvail, only: scope?.only };
    return this.refused(row, ctx, unless) || !this.feasible(row.effects, ctx, new Set(), 0);
  }

  // A row whose own grants the character can't take (see unusable).
  refused(row: TableRow, ctx: RollCtx, unless?: { profile: string; includes: string }): boolean {
    // a row's grants, through its conditions (the helmet table's "Adeptus Astartes … instead")
    const grants: Effect[] = [];
    const walk = (list: Effect[]) => {
      for (const x of list) {
        if (thingOf(x)) grants.push(x);
        else if ("when" in x && !("chance" in x)) walk(this.test(x.when) ? x.then : (x.else ?? []));
      }
    };
    walk(row.effects);
    if (ctx.only && !grants.some((x) => thingOf(x)?.kind === "power") && !row.effects.some((x) => "roll" in x)) return true; // a powers roll wants a power
    return grants.some((x) => {
      const t = thingOf(x);
      if (!t) return false;
      if (ctx.dupes && t.kind !== "item" && this.isDuplicate(t.kind, t.id)) return true;
      const entry = this.c[KIND_MAP[t.kind]].get(t.id) as Ability | Item | undefined;
      if (entry && !this.allowed(t.kind, entry)) return true;
      if (t.kind === "power" && ctx.only && !ctx.only.has(t.id)) return true;
      if (t.kind === "item" && entry && ctx.inSlot && (entry as Item).availabilityWhen && this.availabilityFor(entry as Item) === undefined) return true;
      if (t.kind === "item" && entry && ctx.matchAvail && !this.fitsSlot(entry as Item, ctx.matchAvail)) return true;
      if (unless && t.kind === "item") {
        const cell = (entry as Item | undefined)?.profile?.[unless.profile];
        if (!cell || !cell.toLowerCase().includes(unless.includes.toLowerCase())) return true;
      }
      return false;
    });
  }

  /** An item a gear result of availability `a` may make: of that availability (or any: unrestricted, or none given). */
  fitsSlot(it: Item, a: Availability): boolean {
    if (it.unrestricted) return true;
    if (it.availabilityWhen) return this.availabilityFor(it) === a;
    return it.availability === undefined || it.availability === a;
  }

  // Whether every roll in `list` can land on a usable row (a column with no
  // power the character may still take, Combat Stimms for a character who
  // can't take a stimm). Rolls on a table being checked count as dead ends.
  feasible(list: Effect[], ctx: RollCtx, seen: Set<string>, depth: number): boolean {
    if (depth > 6) return true;
    return list.every((e) => {
      if ("when" in e && !("chance" in e)) return this.feasible(this.test(e.when) ? e.then : (e.else ?? []), ctx, seen, depth + 1);
      if (!("roll" in e)) return true;
      const t = this.c.tables.get(e.roll);
      if (!t) return true;
      const cols = typeof e.column === "object" ? this.ownedColumns(e.column) : [e.column === "$subtype" ? this.sub.id : e.column];
      const dupes = !!(e.rerollDuplicates ?? t.rerollDuplicates ?? ctx.dupes);
      return cols.some((col) => {
        const sig = `${t.id}|${col ?? ""}`;
        if (seen.has(sig)) return false;
        seen.add(sig);
        const inner: RollCtx = { ...ctx, dupes, matchAvail: e.matchAvailability ? this.slotAvail : undefined };
        const ok = t.rows.some((r) => inColumn(r, col) && !this.refused(r, inner, e.rerollUnless) && this.feasible(r.effects, inner, seen, depth + 1));
        seen.delete(sig);
        return ok;
      });
    });
  }

  // A duplicate for a roll that re-rolls them: something the character has
  // other than from its gear (the book makes boons, step B, before gear,
  // step C), or that its profile grants (step A) in a later section.
  isDuplicate(kind: ThingKind, id: string): boolean {
    const o = this.owned[kind].get(id);
    // (an item's own effects run without an archetype section; the Cherubim archetype shares the cherubim item's id)
    if (o && o.from.some((f) => !this.c.items.has(f.entry) || f.section !== undefined || f.override)) return true;
    return this.profileGrants().has(`${kind}/${id}`);
  }

  // Talents and exotic abilities the archetype grants outright in its
  // sections (step A of Creating A Character comes before the boons, even
  // where the book lists Talents after Equipment).
  profileCache?: Set<string>;
  profileGrants(): Set<string> {
    if (this.profileCache) return this.profileCache;
    const out = new Set<string>();
    const walk = (list: Effect[]) => {
      for (const e of list) {
        const t = thingOf(e);
        if (t && (t.kind === "talent" || t.kind === "exotic")) out.add(`${t.kind}/${t.id}`);
        else if ("when" in e && !("chance" in e) && this.test(e.when)) walk(e.then);
      }
    };
    for (const sec of this.arch.sections) walk(sec.effects);
    this.profileCache = out;
    return out;
  }

  /** The columns of a `column: { owned }` whose names match an item the character has (else `else`). */
  ownedColumns(c: { owned: Record<string, string[]>; else?: string }): string[] {
    const items = [...this.owned.item.keys()].map((id) => this.c.items.get(id)).filter((x): x is Item => !!x);
    const out = Object.entries(c.owned)
      .filter(([, names]) => items.some((it) => matches(it, names)))
      .map(([col]) => col);
    return out.length ? out : c.else !== undefined ? [c.else] : [];
  }

  roll(e: Extract<Effect, { roll: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const table = this.c.tables.get(e.roll);
    if (!table) {
      this.warn(`${key}: no table "${e.roll}"`);
      return;
    }
    if (e.eachGame !== undefined) {
      // Rolled at the start of each game, not now: the book's sentence stands
      // where the result would (the GM's sheet lists the table).
      this.eachGame.push({ key, table: table.id, text: e.eachGame, source: src.id });
      this.log.push({
        key,
        parent: scope.parent,
        type: "dice",
        label: table.name,
        result: [e.eachGame],
        reused: true,
        eachGame: true,
        ...(this.section ? { section: this.section } : {}),
      });
      return;
    }
    let wanted: string | undefined;
    if (typeof e.column === "object") {
      const cols = this.ownedColumns(e.column);
      if (!cols.length) {
        this.warn(`${key}: the character has no item for any column of "${table.id}"`);
        return;
      }
      const label = (c: string) => c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, " ");
      const { ids } = this.choose(`${key}:column`, {
        kind: "pick",
        label: table.name,
        count: 1,
        options: cols.map((c) => ({ id: c, label: label(c) })),
        source: src.id,
        parent: scope.parent,
      });
      if (!ids[0]) return;
      wanted = ids[0];
    } else wanted = e.column;
    const col = this.column(table, wanted, key);
    if (col === false) return;
    const dupes = !!(e.rerollDuplicates ?? table.rerollDuplicates ?? scope.dupes);
    const slots: string[] = [];
    if (e.times === undefined) slots.push(key);
    else {
      const n = this.count(key, e.times, table.name, scope.parent);
      for (let i = 1; i <= n; i++) slots.push(`${key}#${i}`);
    }
    const preset = this.presetFor(src, scope, e.id);
    const qty = e.qty === undefined ? undefined : this.value(scope, `${src.id}/${e.id}:qty`, e.qty, table.name);
    for (const slot of slots) {
      const matchAvail = e.matchAvailability ? scope.slotAvail : undefined;
      this.rollSlot(table, col, slot, { ...scope, dupes, matchAvail, qty: qty === undefined ? undefined : { table: table.id, value: qty } }, src, {
        unless: e.rerollUnless,
        preset: preset?.[0],
      });
    }
  }

  // One roll on a table, re-rolled while the row is unusable.
  rollSlot(
    table: Table,
    col: string | undefined,
    slot: string,
    scope: Scope,
    src: Source,
    x: { unless?: { profile: string; includes: string }; preset?: string; onlyRows?: string[] } = {},
  ): TableRow | undefined {
    if (x.preset !== undefined) {
      const row = table.rows.find((r) => r.label === x.preset);
      if (!row) {
        this.warn(`${slot}: no row "${x.preset}" on table "${table.id}"`);
        return undefined;
      }
      this.rolls.push({ key: slot, table: table.id, label: row.label });
      this.variant(src, row.label);
      this.effects(row.effects, table, { ...scope, prefix: `${slot}>`, parent: slot, depth: scope.depth + 1 });
      return row;
    }
    for (let attempt = 1; attempt <= MAX_REROLLS; attempt++) {
      const k = attempt === 1 ? slot : `${slot}~${attempt}`;
      const { total: t } = this.dice(k, table.die, table.name, scope.parent);
      const row = findRow(table, t, col);
      const last = this.log[this.log.length - 1];
      if (!row) {
        this.warn(`${k}: ${t} isn't on table "${table.id}"${col ? ` (${col})` : ""}`);
        return undefined;
      }
      last.result = [row.label];
      if (this.unusable(row, !!scope.dupes, x.unless, scope, x.onlyRows)) {
        last.rerolled = true;
        continue;
      }
      this.rolls.push({ key: k, table: table.id, label: row.label });
      this.variant(src, row.label);
      this.effects(row.effects, table, { ...scope, prefix: `${k}>`, parent: k, depth: scope.depth + 1, preset: undefined });
      return row;
    }
    this.warn(`${slot}: still a duplicate after ${MAX_REROLLS} rolls`);
    return undefined;
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

  // --- gear ---------------------------------------------------------------

  gear(e: Extract<Effect, { gear: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const g = e.gear;
    const allowedAvail = g.availability ?? this.lastGear;
    if (!allowedAvail) {
      this.warn(`${key}: no availability given and no gear before it`);
      return;
    }
    this.lastGear = allowedAvail;
    for (const a of allowedAvail) this.gearAvail.add(a);
    const n = this.count(key, g.count, src.name, scope.parent);
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
    const down = typeof g.downgrade === "number" ? { steps: g.downgrade } : g.downgrade;
    const inRow = (label: string, names: string[]) => names.includes(label);
    const required = g.require ?? [];
    const got: string[] = []; // row labels generated so far
    // A row rolling in the column of a weapon the character carries (Special
    // ammunition) is made after the effect's other results ("Generate the
    // types of gear first before rolling for specifics").
    const byOwned = (row: TableRow) => row.effects.some((x) => "roll" in x && typeof x.roll === "string" && typeof x.column === "object");
    const later: number[] = [];
    const order: number[] = [];
    for (let i = 1; i <= n; i++) {
      const slot = `${key}#${i}`;
      const d = parseDice(gen.die);
      let faces = this.rec.dice[slot];
      if (!validFaces(d, faces)) this.rec.dice[slot] = faces = rollFaces(d, this.rollDie);
      const first = findRow(gen, total(d, faces), col);
      (first && byOwned(first) ? later : order).push(i);
    }
    for (const i of [...order, ...later]) {
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
        // "must generate at least one …": the last slots must fill what's missing
        const unmet = required.filter((r) => !got.some((l) => inRow(l, r)));
        if (unmet.length && unmet.length >= n - i + 1 && !unmet.some((r) => inRow(row.label, r))) {
          genLog.rerolled = true;
          continue;
        }
        let avail = avt ? this.availability(`${k}:avail`, avt, k) : undefined;
        if (avt && !avail) break;
        if (avail && down?.steps && (!down.only || inRow(row.label, down.only))) {
          const idx = AVAILABILITIES.indexOf(avail) - down.steps;
          if (idx < 0) {
            // "If a Common item is downgraded, it is lost instead."
            done = true;
            got.push(row.label);
            this.rolls.push({ key: k, table: gen.id, label: row.label, availability: avail, lost: true });
            break;
          }
          avail = AVAILABILITIES[idx];
        }
        if (avail && !allowedAvail.includes(avail)) {
          genLog.rerolled = true;
          continue;
        }
        const inner: Scope = { prefix: `${k}>`, parent: k, section: scope.section, depth: scope.depth + 1, slotAvail: avail };
        const quality = avail ? row.quality?.[avail] : undefined;
        if (quality) inner.grant = { quality };
        const result: RollResult = { key: k, table: gen.id, label: row.label };
        if (avail) result.availability = avail;
        // A row with effects other than prose (a roll on a sub-table, a
        // grant) makes its gear through them instead of by category: items
        // of the result's availability (or none given). A row that can't
        // make anything the character may have is rolled again.
        if (row.effects.some((x) => !("prose" in x))) {
          const was = this.slotAvail;
          this.slotAvail = avail;
          const ok = this.feasible(row.effects, { dupes: false, inSlot: true }, new Set(), 0);
          if (!ok) {
            this.slotAvail = was;
            genLog.rerolled = true;
            continue;
          }
          done = true;
          got.push(row.label);
          this.rolls.push(result);
          this.effects(row.effects, gen, inner);
          this.slotAvail = was;
          break;
        }
        const inCategory = itemsByCategory(this.c).get(row.label) ?? [];
        if (!inCategory.length) {
          // nothing to pick from: keep the generated type for the GM
          done = true;
          got.push(row.label);
          this.rolls.push(result);
          this.effects(row.effects, gen, inner);
          this.warn(`${k}: no items of category "${row.label}"`);
          break;
        }
        const candidates = (a: Availability | undefined) =>
          inCategory.filter(
            (it) =>
              (a ? this.availOk(it, [], a) : this.availOk(it, allowedAvail)) &&
              (alienOk || !it.alien) &&
              !(g.exclude && matches(it, g.exclude)) &&
              this.allowed("item", it),
          );
        const cands = candidates(avail);
        if (!cands.length) {
          genLog.rerolled = true;
          continue;
        }
        done = true;
        got.push(row.label);
        this.rolls.push(result);
        this.effects(row.effects, gen, inner);
        const sl: Slot = { key: k, row: row.label, availability: avail, qty: 1, candidates, src, scope };
        this.slots.push(sl);
        this.slotItem(sl, `${k}:item`, cands, row);
      }
      if (!done) this.warn(`${slot}: no gear the character can have after ${MAX_REROLLS} rolls`);
    }
  }

  // Choose (and grant) a gear slot's item among `cands`.
  slotItem(sl: Slot, ck: string, cands: Item[], row?: TableRow): void {
    const label = sl.availability ? `${sl.availability} ${sl.row}` : sl.row;
    const { ids } = this.choose(ck, {
      kind: "gear-item",
      label,
      count: 1,
      options: cands.map((x) => ({ id: x.id, label: x.name })),
      source: sl.src.id,
      parent: sl.key,
    });
    for (const id of ids) {
      let qty = 1;
      const it = this.c.items.get(id);
      const byAvail = row?.qty && it ? row.qty[this.availabilityFor(it) ?? sl.availability ?? "Common"] : undefined;
      if (byAvail !== undefined) qty = this.value({ prefix: "", depth: 0, parent: sl.key }, `${sl.key}:qty`, byAvail, sl.row);
      sl.item = id;
      sl.qty = qty;
      this.grant("item", id, { ...this.origin(sl.src, sl.scope), key: ck }, { ...sl.scope, parent: ck, depth: sl.scope.depth + 1 }, qty);
    }
  }

  // Move a generated gear result's availability by `steps` (negative =
  // downgrade) and choose its item again; a Common result downgraded is lost.
  shift(sl: Slot, steps: number, base: string): void {
    const rr = this.rolls.find((r) => r.key === sl.key);
    if (sl.item) this.ungrant("item", sl.item, sl.qty);
    sl.item = undefined;
    const idx = AVAILABILITIES.indexOf(sl.availability ?? "Common") + steps;
    if (idx < 0) {
      sl.lost = true;
      if (rr) rr.lost = true;
      return;
    }
    sl.availability = AVAILABILITIES[Math.min(idx, AVAILABILITIES.length - 1)];
    if (rr) rr.availability = sl.availability;
    const cands = sl.candidates(sl.availability);
    if (!cands.length) {
      this.warn(`${base}: no ${sl.availability} ${sl.row} to choose`);
      return;
    }
    this.slotItem(sl, `${base}>${sl.key}:item`, cands);
  }

  chooseSlots(key: string, count: number, src: Source, scope: Scope, kind: "give" | "upgrade"): Slot[] {
    const slots = this.slots.filter((s) => !s.lost && s.availability);
    const { ids } = this.choose(key, {
      kind,
      label: src.name,
      count,
      options: slots.map((s) => ({ id: s.key, label: `${s.availability} ${s.row}` })),
      source: src.id,
      parent: scope.parent,
    });
    return ids.flatMap((id) => slots.filter((s) => s.key === id));
  }

  trade(e: Extract<Effect, { trade: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const t = e.trade;
    const times = t.times === "any" ? MAX_TRADES : (t.times ?? 1);
    for (let n = 1; n <= times; n++) {
      const k = `${key}#${n}`;
      const { ids } = this.choose(
        k,
        {
          kind: "trade",
          label: src.name,
          count: 1,
          options: [
            { id: "yes", label: this.describe(t.get) },
            { id: "no", label: "" },
          ],
          source: src.id,
          parent: scope.parent,
        },
        true,
        { randomDefault: ["no"] },
      );
      if (ids[0] !== "yes") return;
      const count = t.give.count ?? 1;
      const gk = `${k}:give`;
      if (t.give.downgrade !== undefined) {
        const slots = this.chooseSlots(gk, count, src, { ...scope, parent: k }, "give");
        if (slots.length < count) return;
        for (const sl of slots) this.shift(sl, -t.give.downgrade, gk);
      } else {
        const kinds = Array.isArray(t.give.lose) ? t.give.lose : [t.give.lose!];
        const cands: { kind: ThingKind; o: Owned }[] = [];
        for (const kind of kinds) {
          const pool = new Set(this.poolOf(kind, { ...(t.give.filter as PickFilter | undefined), owned: true }).map((x) => x.id));
          for (const o of this.owned[kind].values()) {
            if (!pool.has(o.id)) continue;
            if (t.give.generated && !o.from.some((f) => f.key)) continue;
            cands.push({ kind, o });
          }
        }
        const { ids: give, complete } = this.choose(gk, {
          kind: "give",
          label: src.name,
          count,
          options: cands.map(({ kind, o }) => ({ id: `${kind}:${o.id}`, label: o.name })),
          source: src.id,
          parent: k,
        });
        if (!complete || give.length < count) return;
        for (const id of give) {
          const [kind, thing] = id.split(":") as [ThingKind, string];
          this.ungrant(kind, thing);
          // gear given up is gone from its slot ("lose two items you've generated")
          if (kind === "item" && !this.owned.item.has(thing)) {
            for (const sl of this.slots) if (sl.item === undefined && !sl.lost) sl.lost = true;
          }
        }
      }
      this.effects(t.get, src, { ...scope, prefix: `${k}>`, parent: k, depth: scope.depth + 1 });
    }
  }

  bionics(e: Extract<Effect, { bionics: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const b = e.bionics;
    const table = this.c.tables.get(b.table ?? BIONICS_TABLE);
    if (!table) {
      this.warn(`${key}: no table "${b.table ?? BIONICS_TABLE}"`);
      return;
    }
    const n = this.count(key, b.count, table.name, scope.parent);
    for (let i = 1; i <= n; i++) {
      const slot = `${key}#${i}`;
      let q = b.quality;
      if (q && b.upgrade !== undefined) {
        const { total: t } = this.dice(`${slot}:upgrade`, "D100", src.name, scope.parent);
        if (t <= b.upgrade) q = QUALITIES[Math.min(QUALITIES.indexOf(q) + 1, QUALITIES.length - 1)];
      }
      this.rollSlot(table, undefined, slot, { ...scope, grant: q ? { quality: q } : undefined }, src, { onlyRows: b.only });
    }
  }

  armourEffect(e: Extract<Effect, { armour: unknown }>, src: Source, scope: Scope): void {
    const a = e.armour;
    // a grant's `covers` ("Flak (All non-head locations)", "(D6 locations)")
    const cov = scope.covers && scope.covers.entry === src.id ? scope.covers.covers : undefined;
    let locs = expandLocations(cov ? (cov.locations ?? a.locations) : a.locations);
    const chooseKey = cov?.choose !== undefined || a.choose ? this.alloc(scope, `${src.id}/${e.id ?? "@locations"}`) : undefined;
    const howMany = cov?.choose !== undefined ? Math.min(locs.length, this.count(chooseKey!, cov.choose, src.name, scope.parent)) : a.choose;
    if (howMany) {
      const key = chooseKey!;
      const { ids } = this.choose(key, {
        kind: "location",
        label: src.name,
        count: howMany,
        options: locs.map((l) => ({ id: l, label: l })),
        source: src.id,
        parent: scope.parent,
      });
      locs = locs.filter((l) => ids.includes(l));
      for (const l of locs) this.variant(src, l);
    }
    const k = `${src.id}/${e.id ?? "@av"}`;
    const av = a.av === undefined ? undefined : this.value(scope, k, a.av, src.name);
    const add = a.add === undefined ? undefined : this.value(scope, a.av === undefined ? k : `${k}:add`, a.add, src.name);
    const field = a.field === undefined ? undefined : String(a.field);
    if (a.as) {
      const ref = this.c.items.get(a.as);
      if (!ref) this.warn(`${src.id}: armour "as" unknown item "${a.as}"`);
      const base = ref ? itemArmour(this.c, ref) : [];
      for (const b of base.length ? base : [{ locations: expandLocations(undefined), av: 0 }]) {
        const p: ArmourPiece = {
          source: src.id,
          name: src.name,
          locations: a.locations !== undefined || howMany || cov ? locs : b.locations,
          av: (av ?? b.av ?? 0) + (add ?? 0),
        };
        if (field ?? b.field) p.field = field ?? b.field;
        this.armour.push(this.from(src, p));
      }
      return;
    }
    const p: ArmourPiece = { source: src.id, name: src.name, locations: locs };
    if (av !== undefined) p.av = av + (add ?? 0);
    else if (add !== undefined) p.add = add;
    if (field) p.field = field;
    this.armour.push(this.from(src, p));
  }

  powers(e: Extract<Effect, { powers: unknown }>, src: Source, scope: Scope): void {
    const key = this.alloc(scope, `${src.id}/${e.id}`);
    const p = e.powers;
    const n = this.count(key, p.count, src.name, scope.parent);
    let cands = this.poolOf("power", { maxDifficulty: p.maxDifficulty, discipline: p.disciplines }) as Ability[];
    // The book's generation table: random mode rolls it for each power; the
    // powers it can't give are never offered (disciplines opened by `access`
    // aren't on it: with any, every candidate is chosen among evenly).
    const table = p.table ? this.c.tables.get(p.table) : undefined;
    if (p.table && !table) this.warn(`${key}: no table "${p.table}"`);
    const col = table ? this.column(table, p.column, key) : undefined;
    let rollTable = !!table && col !== false;
    if (rollTable) {
      const onTable = this.tablePowers(table!, col || undefined);
      const opened = new Set(this.accessGroups("power"));
      cands = cands.filter((x) => onTable.has(x.id) || (x.group !== undefined && opened.has(x.group)));
      if (opened.size) rollTable = false;
    }
    const chosen: Ability[] = [];
    let limit = n;
    for (let i = 1; i <= limit; i++) {
      const k = `${key}#${i}`;
      const left = cands.filter((x) => !chosen.includes(x) && !this.owned.power.has(x.id));
      if (!left.length && !this.forced.has(k)) {
        this.warn(`${key}: no powers left to generate (${i - 1} of ${limit})`);
        break;
      }
      let pw: Ability | undefined;
      // Roll the table; a result the effect doesn't allow is re-rolled.
      const rollIt = (): Ability | undefined => {
        const before = new Set(this.owned.power.keys());
        const only = new Set(left.map((x) => x.id));
        this.rollSlot(table!, col || undefined, k, { ...scope, parent: key, depth: scope.depth + 1, dupes: true, only, matchAvail: undefined }, src);
        const got = [...this.owned.power.keys()].find((id) => !before.has(id));
        return got ? this.c.powers.get(got) : undefined;
      };
      // (a record made in random mode keeps the table's dice: replayed in either mode)
      if (rollTable && !this.forced.has(k) && this.rec.choices[k] === undefined && (this.opts.mode === "random" || this.rec.dice[k] !== undefined)) {
        pw = rollIt();
        if (!pw) break;
      } else {
        // Freeform: any power the table can give, or the table itself (ROLL_OPTION).
        const options = left.map((x) => ({ id: x.id, label: x.name }));
        if (rollTable) options.unshift({ id: ROLL_OPTION, label: table!.name });
        const { ids, complete } = this.choose(k, { kind: "power", label: src.name, count: 1, options, source: src.id, parent: key });
        if (!complete) break;
        if (ids[0] === ROLL_OPTION) {
          // not kept as a choice: the table's dice are the decision
          delete this.rec.choices[k];
          this.usedChoices.delete(k);
          if (this.log[this.log.length - 1]?.key === k) this.log.pop();
          pw = rollIt();
          if (!pw) break;
        } else {
          pw = ids.length ? this.c.powers.get(ids[0]) : undefined;
          if (!pw) {
            if (ids.length) this.warn(`${k}: unknown power "${ids[0]}"`);
            continue;
          }
          chosen.push(pw);
          if (p.crossDisciplinePenalty && new Set(chosen.map((x) => x.group ?? "")).size > 1) limit = n - p.crossDisciplinePenalty;
          if (i <= limit) this.grant("power", pw.id, { ...this.origin(src, scope), key: k }, { ...scope, parent: k, depth: scope.depth + 1 });
          continue;
        }
      }
      // (rolled: already granted by the table's row)
      chosen.push(pw);
      if (p.crossDisciplinePenalty && new Set(chosen.map((x) => x.group ?? "")).size > 1) limit = n - p.crossDisciplinePenalty;
      if (i > limit) this.ungrant("power", pw.id);
    }
  }

  // The powers a table's rows give, through its nested rolls.
  tablePowers(t: Table, col?: string): Set<string> {
    const out = new Set<string>();
    const seen = new Set<string>();
    const walk = (table: Table, c: string | undefined, depth: number) => {
      const sig = `${table.id}|${c ?? ""}`;
      if (seen.has(sig) || depth > 6) return;
      seen.add(sig);
      for (const r of table.rows) {
        if (!inColumn(r, c)) continue;
        for (const x of r.effects) {
          const th = thingOf(x);
          if (th?.kind === "power") out.add(th.id);
          if ("roll" in x && typeof x.roll === "string") {
            const sub = this.c.tables.get(x.roll);
            if (sub) walk(sub, typeof x.column === "string" ? x.column : undefined, depth + 1);
          }
        }
      }
    };
    walk(t, col, 0);
    return out;
  }

  // --- the result ---------------------------------------------------------

  formula(f: StatFormula, stats: Record<Stat, number>): number {
    let v = stats[f.stat] * (f.times ?? 1);
    if (f.divide) v /= f.divide;
    return roundOff(v + (f.add ?? 0));
  }

  character(record: CharacterRecord): Character {
    const stats = {} as Record<Stat, StatLine>;
    const phase1 = {} as Record<Stat, number>;
    for (const s of STATS) phase1[s] = this.fold(s);
    for (const s of STATS) {
      let v = phase1[s];
      for (const m of this.mods[s]) {
        if (!m.formula) continue;
        m.add = this.formula(m.formula, phase1);
        v += m.add;
      }
      for (const cap of this.caps[s]) {
        if (cap.max !== undefined) v = Math.min(v, cap.max);
        if (cap.min !== undefined) v = Math.max(v, cap.min);
      }
      for (const m of this.mods[s]) if (m.multiply !== undefined) v = roundOff(v * m.multiply);
      stats[s] = { base: this.base[s], modified: v, final: v, overridden: false, mods: this.mods[s], caps: this.caps[s] };
    }
    const ch: Character = {
      name: record.name,
      archetype: { id: this.arch.id, name: this.arch.characters ?? this.arch.name },
      subtype: { id: this.sub.id, name: this.sub.name },
      options: this.options,
      stats,
      talents: [],
      exotics: [],
      mutations: [],
      powers: [],
      items: [],
      rolls: this.rolls,
      eachGame: this.eachGame,
      empty: this.empty,
      notes: this.notes,
      warnings: this.warnings,
      overridden: { stats: [], alignment: false, added: [], removed: [], choices: [...this.forcedUsed] },
      armour: {} as Character["armour"],
      armourPieces: this.armour,
      derived: {} as Character["derived"],
      attributes: [],
      weapons: this.weapons,
      wielded: this.wielded,
      taken: [],
      reloads: { add: 0, multiply: 1 },
      psyker: false,
      companions: this.companions,
      locations: this.locations,
      // the archetype's own and those this pass met (not a lookahead an earlier pass left)
      restrictions: this.activeRx()
        .filter((r) => this.seedRx.some((x) => x.sig === r.sig) || this.metRx.some((x) => x.sig === r.sig))
        .map(({ sig: _s, exempt: _e, ...r }) => r),
    };
    if (this.alignment) ch.alignment = this.alignment;
    // remove effects (Warp Disruptor), before overrides
    for (const r of this.removals) {
      const o = this.owned[r.kind].get(r.id);
      if (!o) continue;
      this.owned[r.kind].delete(r.id);
      ch.taken.push({ kind: r.kind, id: r.id, name: o.name, by: r.source });
    }
    for (const o of record.overrides) this.override(o, ch);
    for (const key of this.forced.keys()) {
      if (!this.forcedUsed.has(key)) this.warn(`override: no choice "${key}" on this character`);
    }
    for (const k of ["talent", "exotic", "mutation", "power", "item"] as const) {
      (ch[KIND_MAP[k]] as Owned[]) = [...this.owned[k].values()];
    }
    ch.psyker = this.isPsyker();
    const finals = Object.fromEntries(STATS.map((s) => [s, ch.stats[s].final])) as Record<Stat, number>;
    // items: availability for this character, profile for this wielder
    for (const s of STATS) this.cur[s] = finals[s];
    for (const it of ch.items) {
      const entry = this.c.items.get(it.id);
      if (!entry) continue;
      let a = this.availabilityFor(entry);
      if (a && it.alterations?.length) a = AVAILABILITIES[Math.min(AVAILABILITIES.indexOf(a) + it.alterations.length, AVAILABILITIES.length - 1)];
      if (a) it.availability = a;
      const pw = entry.profileWhen?.find((w) => this.test(w.when));
      if (pw) it.profile = { ...entry.profile, ...pw.profile };
    }
    // restrictions broken (by overrides, or fixed grants)
    for (const k of ["talent", "exotic", "mutation", "power", "item"] as const) {
      for (const o of ch[KIND_MAP[k]] as Owned[]) {
        const entry = this.c[KIND_MAP[k]].get(o.id) as Ability | Item | undefined;
        if (entry && !this.allowed(k, entry)) {
          o.restricted = true;
          this.warn(`${k} "${o.id}" breaks a restriction`);
        }
      }
    }
    // what things the character no longer has (removed, overridden away) added is dropped
    const kinds = ["talent", "exotic", "mutation", "power", "item"] as const;
    const live = (x: { source: string }) =>
      this.fixed.has(x) ||
      !kinds.some((k) => this.c[KIND_MAP[k]].has(x.source)) || kinds.some((k) => this.owned[k].has(x.source));
    ch.armourPieces = this.armour.filter(live);
    ch.weapons = this.weapons.filter(live);
    ch.wielded = this.wielded.filter(live);
    this.derivedMods = this.derivedMods.filter(live);
    this.attrs = this.attrs.filter(live);
    this.reloadMods = this.reloadMods.filter(live);
    // armour per location: the best piece worn, plus extra AV
    for (const l of LOCATIONS) {
      const here = ch.armourPieces.filter((p) => p.locations.includes(l));
      const pieces = here.filter((p) => p.av !== undefined);
      const best = pieces.reduce<ArmourPiece | undefined>((b, p) => (!b || p.av! > b.av! ? p : b), undefined);
      const extra = here.filter((p) => p.av === undefined && p.add !== undefined);
      const from = [...(best ? [best.source] : []), ...extra.map((p) => p.source)];
      const fields = here.flatMap((p) => (p.field ? [p.field] : []));
      for (const p of here) if (p.field && !from.includes(p.source)) from.push(p.source);
      ch.armour[l] = { av: (best?.av ?? 0) + extra.reduce((s, p) => s + p.add!, 0), fields, from };
    }
    // derived values from final stats
    for (const d of DERIVED) {
      const mods = this.derivedMods.filter((m) => m.derived === d);
      const shifted = { ...finals };
      for (const m of mods) for (const [s, v] of Object.entries(m.counts ?? {})) shifted[s as Stat] += v;
      const base = deriveStats(shifted)[d];
      let value: number | "No" = base;
      for (const m of mods) {
        if (m.set !== undefined) value = m.set;
        else if (m.add !== undefined && typeof value === "number") value += m.add;
      }
      ch.derived[d] = { base, value, mods: mods.map(({ derived: _d, ...m }) => m) };
    }
    // attributes
    const attrs = new Map<string, Attribute>();
    for (const a of this.attrs) {
      const v = typeof a.value === "object" ? this.formula(a.value, finals) : a.value;
      const have = attrs.get(a.name);
      if (a.op === "set" || !have) attrs.set(a.name, { name: a.name, value: a.op === "set" ? v : (have?.value ?? 0) + v, source: a.source });
      else have.value += v;
    }
    ch.attributes = [...attrs.values()];
    for (const r of this.reloadMods) {
      ch.reloads.add += r.add ?? 0;
      ch.reloads.multiply *= r.multiply ?? 1;
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

// Restrictions and access the archetype states outright (top-level effects
// of its sections): known before the walk, so no second pass is needed.
function seedLook(arch: Archetype): Look {
  const look: Look = { rx: [], access: [] };
  for (const s of arch.sections) {
    for (const e of s.effects) {
      const r = toRx(e, arch);
      if (r && !look.rx.some((x) => x.sig === r.sig)) look.rx.push(r);
      const a = toAccess(e, arch);
      if (a && !look.access.some((x) => x.sig === a.sig)) look.access.push(a);
    }
  }
  return look;
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
  // Some rules are met after the decisions they affect: conditions on the
  // alignment before it is chosen (gear in the Equipment row, alignment in
  // the last row), restrictions and access stated after the gear or pools
  // they limit (the Armour row after Equipment). When a pass meets any of
  // these late, it is run again knowing them, keeping the dice it rolled and
  // the choices it made (a choice they now refuse is made again).
  let work = cloneRecord(input);
  const seed = seedLook(arch);
  let look: Look = { rx: [...seed.rx], access: [...seed.access] };
  // a replay knows its alignment already: the stored (or forced) answer to
  // the archetype's alignment effect
  for (const sec of arch.sections) {
    for (const e of sec.effects) {
      if (!("alignment" in e) || !("id" in e)) continue;
      const key = `${arch.id}/${e.id}`;
      const forced = input.overrides.find((o): o is Extract<Override, { op: "choice" }> => o.op === "choice" && o.key === key);
      const a = (forced?.value ?? input.choices[key])?.[0] as Alignment | undefined;
      if (a && (forced || e.alignment.includes(a))) look.alignment ??= a;
    }
  }
  let pass!: Pass;
  const stale: string[] = [];
  for (let i = 0; i < 4; i++) {
    pass = new Pass(c, arch, sub, work, input, opts, rollDie, look);
    pass.seedRx = seed.rx;
    pass.run();
    for (const w of pass.stale) if (!stale.includes(w)) stale.push(w);
    const alignLate = pass.peekedAlignment && pass.alignment !== undefined && pass.alignment !== look.alignment;
    const rx = [...seed.rx];
    for (const r of pass.metRx) if (!rx.some((x) => x.sig === r.sig)) rx.push(r);
    const access = [...seed.access];
    for (const a of pass.metAccess) if (!access.some((x) => x.sig === a.sig)) access.push(a);
    const consLate = sigs(rx) !== sigs(look.rx) || sigs(access) !== sigs(look.access);
    if ((!alignLate && !consLate) || i === 3) break;
    look = { alignment: alignLate ? pass.alignment : look.alignment, rx, access };
    // The re-run keeps the dice and the choices made (a choice the new
    // restrictions refuse is made again, among what they allow), so a random
    // build's odds stay the book's.
    // A choice the record already held stays as it was: a pass that didn't
    // know a late access or restriction may have found it not allowed.
    const next = cloneRecord(input);
    next.dice = { ...work.dice };
    for (const [k, v] of Object.entries(work.choices)) next.choices[k] = [...(input.choices[k] ?? v)];
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
