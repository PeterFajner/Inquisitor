// The builder's edits as pure functions on character records: each takes the
// head record and returns the next one (which becomes a new version). They
// run the engine so the returned record holds every decision the character
// uses: rebuilding it rolls nothing (docs/ENGINE.md).
//
// No mode is stored: a random character is one whose choices were all made
// at random. Re-rolling chooses again at random for the decisions it
// cleared; choosing explicitly leaves any new nested choice pending (pick it,
// or fill it at random).
import type { CharacterRecord as ApiRecord } from "../../shared/api.ts";
import { build, ROLL_OPTION, type BuildResult, type PendingChoice, type RollFn } from "../../shared/engine/build.ts";
import { diff, type CharacterDiff } from "../../shared/engine/diff.ts";
import { cloneRecord, newRecord, parseRecord, type CharacterRecord, type Override, type ThingKind } from "../../shared/engine/record.ts";
import { reroll } from "../../shared/engine/reroll.ts";
import { cryptoRoller } from "../../shared/engine/rng.ts";
import type { Compendium } from "../../shared/rules/compendium.ts";
import type { Alignment, Stat } from "../../shared/rules/schema.ts";

export type { CharacterRecord };

/** A stored record as the engine's, or null when it isn't one. */
export function engineRecord(raw: ApiRecord | unknown): CharacterRecord | null {
  const r = parseRecord(raw);
  return r.ok ? r.record : null;
}

/** For showing a record: nothing new is kept, so dice it lacks show at a middle face. */
const middle: RollFn = (sides) => Math.ceil(sides / 2);

export function view(c: Compendium, rec: CharacterRecord): BuildResult {
  const b = build(c, rec, { mode: "freeform", roll: middle });
  // What the archetype itself asks is labelled by its section ("Repentia",
  // "Equipment"), the book's heading, rather than the archetype's name.
  const arch = b.character.archetype.name;
  const relabel = <T extends { label: string; section?: string }>(x: T): T => (x.section && x.label === arch ? { ...x, label: x.section } : x);
  return { ...b, log: b.log.map(relabel), pending: b.pending.map(relabel) };
}

/** A uniformly random answer to a pending choice (keeping what's chosen); a power is rolled on the book's table when it has one. */
export function randomPick(p: PendingChoice, roll: RollFn = cryptoRoller()): string[] {
  if (p.kind === "power" && p.options.some((o) => o.id === ROLL_OPTION)) return [ROLL_OPTION];
  const out = [...p.chosen];
  const left = p.options.filter((o) => !out.includes(o.id));
  while (out.length < p.count && left.length) {
    const [o] = left.splice(roll(left.length) - 1, 1);
    out.push(o.id);
  }
  return out;
}

const stamp = (r: CharacterRecord, version?: string): CharacterRecord => {
  if (version) r.rulesVersion = version;
  return r;
};

/** A new character: random (the book's method) or freeform (choices left to the user). */
export function create(
  c: Compendium,
  archetype: string,
  subtype: string,
  mode: "random" | "freeform",
  opts: { name?: string; version?: string; roll?: RollFn } = {},
): CharacterRecord {
  const packs = c.packs.map((p) => p.id);
  const r = build(c, newRecord(packs, archetype, subtype, opts.name ?? ""), { mode, roll: opts.roll ?? cryptoRoller() }).record;
  return stamp(r, opts.version);
}

const pendingKeys = (c: Compendium, rec: CharacterRecord): Set<string> => new Set(view(c, rec).pending.map((p) => p.key));

/**
 * Rolls a decision again: clears it and everything that depends on it,
 * then rolls the dice and makes the cleared choices at random (choices that
 * were already left open stay open).
 */
export function rerollDecision(c: Compendium, rec: CharacterRecord, key: string, opts: { version?: string; roll?: RollFn } = {}): CharacterRecord {
  const roll = opts.roll ?? cryptoRoller();
  const open = pendingKeys(c, rec);
  const cleared = reroll(c, rec, key);
  const r = build(c, cleared, { mode: "freeform", roll, pick: (p) => (open.has(p.key) ? undefined : randomPick(p, roll)) }).record;
  return stamp(r, opts.version);
}

/** Makes (or changes) a choice; what depended on the old answer is cleared and made again (new choices stay open). */
export function choose(c: Compendium, rec: CharacterRecord, key: string, ids: string[], opts: { version?: string; roll?: RollFn } = {}): CharacterRecord {
  const cleared = reroll(c, rec, key);
  cleared.choices[key] = [...ids];
  const r = build(c, cleared, { mode: "freeform", roll: opts.roll ?? cryptoRoller() }).record;
  return stamp(r, opts.version);
}

/** Every open choice (or only `keys`) made at random, including ones that open on the way. */
export function fillPending(c: Compendium, rec: CharacterRecord, opts: { keys?: string[]; version?: string; roll?: RollFn } = {}): CharacterRecord {
  const roll = opts.roll ?? cryptoRoller();
  const only = opts.keys ? new Set(opts.keys) : null;
  const before = pendingKeys(c, rec);
  const r = build(c, rec, {
    mode: "freeform",
    roll,
    // Only the asked-for keys, plus choices that open because of them.
    pick: (p) => (!only || only.has(p.key) || !before.has(p.key) ? randomPick(p, roll) : undefined),
  }).record;
  return stamp(r, opts.version);
}

/** The options a made choice offers, for changing it (null when the key isn't a choice here). */
export function choiceOptions(c: Compendium, rec: CharacterRecord, key: string): PendingChoice | null {
  const cleared = reroll(c, rec, key);
  const p = view(c, cleared).pending.find((x) => x.key === key);
  if (!p) return null;
  return { ...p, chosen: rec.choices[key] ? [...rec.choices[key]] : [] };
}

const withOverrides = (rec: CharacterRecord, fn: (o: Override[]) => Override[], version?: string): CharacterRecord => {
  const r = cloneRecord(rec);
  r.overrides = fn(r.overrides);
  return stamp(r, version);
};

/** Sets a stat's final value; null (or the rules' own value) removes the override. */
export function setStat(c: Compendium, rec: CharacterRecord, stat: Stat, value: number | null, version?: string): CharacterRecord {
  const without = rec.overrides.filter((o) => !(o.op === "stat" && o.stat === stat));
  const ruled = view(c, { ...rec, overrides: without }).character.stats[stat].final;
  return withOverrides(rec, () => (value === null || value === ruled ? without : [...without, { op: "stat", stat, value }]), version);
}

/** Sets the alignment; null goes back to the rules' alignment. */
export function setAlignment(rec: CharacterRecord, value: Alignment | null, version?: string): CharacterRecord {
  return withOverrides(rec, (os) => [...os.filter((o) => o.op !== "alignment"), ...(value ? [{ op: "alignment", value } as Override] : [])], version);
}

/** Gives a talent, exotic ability, mutation, power or item (undoing a removal of it first). */
export function addThing(rec: CharacterRecord, kind: ThingKind, id: string, version?: string): CharacterRecord {
  return withOverrides(
    rec,
    (os) => {
      const i = os.findIndex((o) => o.op === "remove" && o.kind === kind && o.id === id);
      if (i >= 0) return os.filter((_, j) => j !== i);
      if (kind === "item") {
        const j = os.findIndex((o) => o.op === "add" && o.kind === kind && o.id === id);
        if (j >= 0) return os.map((o, k) => (k === j && o.op === "add" ? { ...o, qty: (o.qty ?? 1) + 1 } : o));
      }
      return [...os, { op: "add", kind, id }];
    },
    version,
  );
}

/** Takes one away: an override's addition is dropped, anything else is removed by an override. */
export function removeThing(rec: CharacterRecord, kind: ThingKind, id: string, version?: string): CharacterRecord {
  return withOverrides(
    rec,
    (os) => {
      const i = os.findIndex((o) => o.op === "add" && o.kind === kind && o.id === id);
      if (i >= 0) return os.filter((_, j) => j !== i);
      return [...os, { op: "remove", kind, id }];
    },
    version,
  );
}

export function rename(rec: CharacterRecord, name: string, version?: string): CharacterRecord {
  const r = cloneRecord(rec);
  r.name = name;
  return stamp(r, version);
}

/** What updating to newer rules changes (the old rules may be unknown here: then only what the new ones need). */
export function rulesDiff(oldC: Compendium | null, newC: Compendium, rec: CharacterRecord): CharacterDiff {
  return diff(oldC ?? newC, newC, rec);
}

/**
 * The record under newer rules: dice they need are rolled; choices they
 * need are made at random when `randomChoices` (a character with no open
 * choices, i.e. a random one), else left open.
 */
export function updateRules(newC: Compendium, rec: CharacterRecord, version: string, randomChoices: boolean, roll: RollFn = cryptoRoller()): CharacterRecord {
  const base = { ...cloneRecord(rec), packs: newC.packs.map((p) => p.id) };
  const r = build(newC, base, { mode: "freeform", roll, pick: randomChoices ? (p) => randomPick(p, roll) : undefined }).record;
  return stamp(r, version);
}
