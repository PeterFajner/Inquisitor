// The owner's rulings of November 2026 on the cases the end-to-end runs left
// pending: a small pack made here for each, then the cases themselves against
// the real rules (data/rules) when they are there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { build, type RollFn } from "../src/shared/engine/build.ts";
import { newRecord, type CharacterRecord } from "../src/shared/engine/record.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import { loadAllPacks } from "../src/lib/rules-files.ts";
import { buildCompendium, withoutHidden } from "../src/shared/rules/compendium.ts";
import { Entry, Pack } from "../src/shared/rules/schema.ts";
import * as ops from "../src/client/builder/ops.ts";

const src = { page: 1 };
const stats = { WS: 50, BS: 50, S: 50, T: 50, I: 50, Wp: 50, Sg: 50, Nv: 50, Ld: 50 };
const talent = (id: string, x: Record<string, unknown> = {}) => ({ id, kind: "talent", name: id, source: src, text: ".", ...x });
const mutation = (id: string, effects: unknown[]) => ({ id, kind: "mutation", name: id, source: src, text: ".", effects });
const power = (id: string, group: string) => ({ id, kind: "power", name: id, group, difficulty: 5, source: src, text: "." });
const item = (id: string, x: Record<string, unknown> = {}) => ({ id, kind: "item", name: id, group: "Gear", source: src, ...x });
const row = (range: [number, number], label: string, effects: unknown[] = []) => ({ range, label, effects });
const archetype = (id: string, sections: { name: string; effects: unknown[] }[], x: Record<string, unknown> = {}) => ({
  id,
  kind: "archetype",
  name: id,
  source: src,
  subtypes: [{ id: "fighter", name: "Fighter", stats }],
  sections,
  ...x,
});

const entries = [
  // 1. "can only take powers from …" against a power granted outright
  archetype("sage", [
    { name: "Psychic Abilities", effects: [{ power: "empathy" }, { id: "powers", pick: 1, pool: "power" }] },
    { name: "Talents", effects: [{ talent: "puppet" }] },
  ]),
  archetype("navigator", [
    { name: "Psychic Abilities", effects: [{ power: "empathy" }] },
    { name: "Exotic Abilities", effects: [{ talent: "third-eye" }] },
  ]),
  talent("puppet", { effects: [{ restrict: { pool: "power", only: ["Telepathy"], taken: true } }] }),
  talent("third-eye", { effects: [{ restrict: { pool: "power", only: ["whisper"] } }] }),
  power("empathy", "Telekinesis"),
  power("blast", "Telekinesis"),
  power("whisper", "Telepathy"),
  // 2 and 3. Study Thy Weapon and an MIU with nothing to pick: the roll is rolled again
  archetype("roller", [{ name: "Talents", effects: [{ id: "gift", roll: "gifts" }] }]),
  archetype("lector", [{ name: "Talents", effects: [{ talent: "study" }] }]),
  {
    id: "gifts",
    kind: "table",
    name: "Gifts",
    source: src,
    die: "D6",
    rows: [row([1, 2], "Study", [{ talent: "study" }]), row([3, 4], "MIU", [{ item: "miu" }]), row([5, 6], "Tough", [{ talent: "tough" }])],
  },
  talent("study", { effects: [{ id: "weapon", pick: 1, pool: "item", filter: { owned: true, category: ["Basic weapon"] }, into: "self", required: true }] }),
  talent("tough"),
  item("miu", { effects: [{ id: "equipment", pick: 1, pool: "item", filter: { owned: true, exclude: ["miu"] }, into: "self", required: true }] }),
  // 3. an MIU picked before the gear it links (the Enginseer's implant before the Archeotech Wargear)
  archetype("enginseer", [
    { name: "Equipment", effects: [{ id: "implant", pick: 1, pool: "item", filter: { group: ["Implants"] } }] },
    { name: "Wargear", effects: [{ item: "wargear" }] },
  ]),
  archetype("lone-enginseer", [{ name: "Equipment", effects: [{ id: "implant", pick: 1, pool: "item", filter: { group: ["Implants"] } }] }]),
  item("link-unit", { group: "Implants", effects: [{ id: "equipment", pick: 1, pool: "item", filter: { owned: true, exclude: ["link-unit"] }, into: "self", required: true }] }),
  item("plate", { group: "Implants" }),
  item("wargear"),
  // 4. a set wins over adds, whatever order they came in
  archetype("mutant", [{ name: "Mutations", effects: [{ id: "first", pick: 1, from: [{ mutation: "curse" }, { mutation: "scales" }] }, { id: "second", pick: 1, from: [{ mutation: "curse" }, { mutation: "scales" }] }] }], { human: false }),
  mutation("curse", [{ stat: "S", set: 62 }, { derived: ["Spd", "BIV"], set: [3, 7] }]),
  mutation("scales", [{ stat: "S", add: 10 }, { derived: "BIV", add: 1 }]),
].map((e) => Entry.parse(e));
const c = buildCompendium([{ pack: Pack.parse({ id: "t", name: "T" }), entries }]);
const rec = (archetype: string, patch: Partial<CharacterRecord> = {}): CharacterRecord => ({ ...newRecord(["t"], archetype, "fighter"), ...patch });
const THROW: RollFn = () => {
  throw new Error("rolled a die the record should have had");
};
/** Rolls the given faces in order, then 1s. */
const faces = (...fs: number[]): RollFn => {
  const q = [...fs];
  return () => q.shift() ?? 1;
};

test("a `taken` restriction refuses later powers but leaves (and doesn't flag) one granted outright", () => {
  const b = build(c, rec("sage"), { mode: "random", roll: seededRoller(1) });
  assert.deepEqual(b.warnings, []);
  assert.deepEqual(b.character.powers.map((p) => [p.id, !!p.restricted]), [["empathy", false], ["whisper", false]]);
  // what is chosen later is held to it: an override is flagged
  const o = build(c, { ...b.record, overrides: [{ op: "add", kind: "power", id: "blast" }] }, { mode: "freeform", roll: THROW });
  assert.equal(o.character.powers.find((p) => p.id === "blast")?.restricted, true);
  assert.ok(o.warnings.includes('power "blast" breaks a restriction'), o.warnings.join("\n"));
  assert.ok(!o.character.powers.find((p) => p.id === "empathy")?.restricted);
});

test("a restriction without `taken` still flags a power granted outright", () => {
  const b = build(c, rec("navigator"), { mode: "random", roll: seededRoller(1) });
  assert.equal(b.character.powers.find((p) => p.id === "empathy")?.restricted, true);
  assert.ok(b.warnings.includes('power "empathy" breaks a restriction'));
});

test("Study Thy Weapon with no weapon: the roll that gave it is rolled again", () => {
  const b = build(c, rec("roller"), { mode: "random", roll: faces(1, 6) });
  assert.deepEqual(b.warnings, []);
  assert.deepEqual(b.character.talents.map((t) => t.id), ["tough"]);
  assert.ok(b.log.some((l) => l.key === "roller/gift" && l.rerolled), JSON.stringify(b.log));
  assert.ok(b.log.some((l) => l.key === "roller/gift~2"));
  assert.deepEqual(build(c, b.record, { mode: "random", roll: THROW }).record, b.record);
});

test("Study Thy Weapon granted outright with no weapon keeps its empty pick", () => {
  const b = build(c, rec("lector"), { mode: "random", roll: seededRoller(1) });
  assert.deepEqual(b.character.talents.map((t) => t.id), ["study"]);
  assert.deepEqual(b.warnings, ["study/weapon: only 0 to choose from, 1 wanted"]);
});

test("an MIU with nothing to link: the roll that gave it is rolled again", () => {
  const b = build(c, rec("roller"), { mode: "random", roll: faces(3, 6) });
  assert.deepEqual(b.warnings, []);
  assert.deepEqual(b.character.items, []);
  assert.deepEqual(b.character.talents.map((t) => t.id), ["tough"]);
  assert.deepEqual(build(c, b.record, { mode: "random", roll: THROW }).record, b.record);
});

test("an MIU picked before the gear it links is offered, and links it; with nothing to link, it isn't", () => {
  const kept = build(c, rec("enginseer", { choices: { "enginseer/implant": ["link-unit"] } }), { mode: "freeform", roll: THROW, pick: () => assert.fail("asked") });
  assert.deepEqual(kept.warnings, []);
  assert.deepEqual(kept.character.items.find((i) => i.id === "link-unit")?.chosen?.map((x) => x.id), ["wargear"]);
  assert.deepEqual(kept.record.choices["enginseer/implant"], ["link-unit"]);
  // a random build chooses it (among what the finished character allows), as often as the plate
  let links = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const b = build(c, rec("enginseer"), { mode: "random", roll: seededRoller(seed) });
    assert.deepEqual(b.warnings, [], `${seed}`);
    if (b.character.items.some((i) => i.id === "link-unit")) links++;
    assert.deepEqual(build(c, b.record, { mode: "random", roll: THROW }).record, b.record, `${seed}`);
  }
  assert.ok(links > 70 && links < 130, `${links}`);
  // nothing to link at all: not allowed (a stored one is chosen again)
  const lone = build(c, rec("lone-enginseer", { choices: { "lone-enginseer/implant": ["link-unit"] } }), { mode: "random", roll: seededRoller(1) });
  assert.deepEqual(lone.character.items.map((i) => i.id), ["plate"]);
  assert.deepEqual(lone.warnings, ["lone-enginseer/implant: stored choice [link-unit] isn't allowed now; chosen again"]);
});

test("a set wins over adds whatever order they came in: stats and derived values", () => {
  for (const order of [["mutation:curse", "mutation:scales"], ["mutation:scales", "mutation:curse"]]) {
    const b = build(c, rec("mutant", { choices: { "mutant/first": [order[0]], "mutant/second": [order[1]] } }), { mode: "freeform", roll: THROW });
    assert.deepEqual(b.warnings, [], order.join());
    assert.equal(b.character.stats.S.final, 62, order.join());
    assert.equal(b.character.derived.BIV.value, 7, order.join());
    assert.equal(b.character.derived.Spd.value, 3, order.join());
  }
});

// --- the real rules ------------------------------------------------------------

const RULES = process.env.RULES_DIR || join(import.meta.dirname, "../data/rules");
const real = existsSync(join(RULES, "loyalist")) ? buildCompendium(withoutHidden(loadAllPacks(RULES))) : null;
const skip = !real && "no rules";
const R = real!;
const random = (archetype: string, subtype: string, seed: number) => build(R, newRecord(R.packs.map((p) => p.id), archetype, subtype), { mode: "random", roll: seededRoller(seed) });

test("real rules: Puppetmaster leaves a Tech-Priest Sage's Machine Empathy alone (p. 34)", { skip }, () => {
  const b = random("tech-priests", "sage", 139);
  assert.ok(b.character.talents.some((t) => t.id === "puppetmaster"));
  const me = b.character.powers.find((p) => p.id === "machine-empathy");
  assert.ok(me && !me.restricted);
  assert.deepEqual(b.warnings, []);
});

test("real rules: Study Thy Weapon from a boon with no weapon is rolled again; an Acolyte Lector always generates a weapon for theirs", { skip }, () => {
  const b = random("cultists-and-fanatics", "psyker", 125);
  assert.deepEqual(b.warnings, []);
  assert.ok(b.log.some((l) => l.key === "creating-a-character/boons#1" && l.rerolled));
  const stw = b.character.talents.find((t) => t.id === "study-thy-weapon");
  assert.ok(!stw || stw.chosen?.length);
  const lector = random("inquisitor-acolyte", "sage", 11);
  assert.ok(lector.character.options.some((o) => o.id === "lector"));
  assert.deepEqual(lector.warnings, []);
  assert.ok(lector.character.talents.find((t) => t.id === "study-thy-weapon")?.chosen?.length);
});

test("real rules: a Rare Cyber creature downgraded is lost (there are no Common ones)", { skip }, () => {
  const b = random("inquisitor-acolyte", "sage", 1);
  const k = "equipment/upgrade#1";
  const r = ops.choose(R, ops.choose(R, b.record, k, ["yes"], { roll: seededRoller(1) }), `${k}>equipment/up`, ["inquisitor-acolyte/gear#4~3"], {
    roll: seededRoller(2),
    then: { [`${k}:give`]: ["inquisitor-acolyte/gear#2", "inquisitor-acolyte/gear#8"] },
  });
  const after = build(R, r, { mode: "freeform", roll: THROW });
  const cyber = after.character.rolls.find((x) => x.key === "inquisitor-acolyte/gear#2");
  assert.equal(cyber?.lost, true);
  assert.equal(cyber?.availability, "Rare");
  assert.ok(!after.character.empty.some((e) => e.key.includes("gear#2")));
  assert.ok(!after.warnings.some((w) => /no Common Cyber creatures to choose/.test(w)), after.warnings.join("\n"));
  const before = b.character.items.filter((i) => i.from.some((f) => f.key?.startsWith("inquisitor-acolyte/gear#2")));
  for (const it of before) assert.ok(!after.character.items.some((i) => i.id === it.id && i.from.some((f) => f.key?.startsWith("inquisitor-acolyte/gear#2"))), it.id);
});

test("real rules: a mount-only weapon picked before the gear a later pick makes for it replays (crone-world-ork seed 63)", { skip }, () => {
  const b = random("crone-world-ork", "ork", 63);
  assert.deepEqual(b.record.choices["crone-world-ork/rank-8-rare-item"], ["exterminator"]);
  assert.deepEqual(b.warnings, []);
  for (const mode of ["freeform", "random"] as const) {
    const again = build(R, b.record, { mode, roll: THROW, pick: () => assert.fail("asked") });
    assert.deepEqual(again.record, b.record, mode);
    assert.deepEqual(again.warnings, [], mode);
  }
});
