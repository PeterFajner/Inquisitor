// The engine bugs the second end-to-end run found (test/e2e, November 2026):
// gear trades (p. 38) on every result, trades offered only when they can be
// made, refused stored choices across passes, a second trade, what a traded
// item made, options drawing on one pool. A small pack for the mechanisms,
// then the run's own reproductions against the real rules (data/rules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { build, type BuildResult, type RollFn } from "../src/shared/engine/build.ts";
import { newRecord, type CharacterRecord } from "../src/shared/engine/record.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import { loadAllPacks } from "../src/lib/rules-files.ts";
import { buildCompendium, checkCompendium, withoutHidden, type Compendium } from "../src/shared/rules/compendium.ts";
import { Entry, Pack } from "../src/shared/rules/schema.ts";
import * as ops from "../src/client/builder/ops.ts";

const src = { page: 1 };
const stats = { WS: 50, BS: 50, S: 50, T: 50, I: 50, Wp: 50, Sg: 50, Nv: 50, Ld: 50 };
const item = (id: string, x: Record<string, unknown> = {}) => ({ id, kind: "item", name: id, group: "Gear", source: src, ...x });
const row = (range: [number, number], label: string, effects: unknown[] = []) => ({ range, label, effects });
const archetype = (id: string, sections: { name: string; effects: unknown[] }[]) => ({
  id,
  kind: "archetype",
  name: id,
  source: src,
  subtypes: [{ id: "fighter", name: "Fighter", stats }],
  sections,
});
const upgrade = { id: "upgrade", trade: { give: { downgrade: 1, count: 2 }, get: [{ id: "up", upgrade: 1 }], times: "any" } };
const reroll = { id: "reroll", trade: { give: { lose: "item", count: 2 }, get: [{ id: "again", gear: { count: 1 } }], times: "any" } };

const entries = [
  // p. 38: "Rare Armour … we can trade our Rare Armour in for the Conversion Field"
  archetype("trader", [{ name: "Equipment", effects: [{ id: "gear", gear: { count: 3, availability: ["Common", "Rare"] } }, upgrade, reroll] }]),
  archetype("single", [{ name: "Equipment", effects: [{ id: "gear", gear: { count: 1, availability: ["Common", "Rare"] } }, upgrade] }]),
  {
    id: "equipment-generator",
    kind: "table",
    name: "Equipment Generator",
    source: src,
    die: "D3",
    columns: ["fighter"],
    rows: [
      { ranges: { fighter: [1, 1] }, label: "Basic weapon", effects: [] },
      {
        ranges: { fighter: [2, 2] },
        label: "Armour",
        effects: [
          { when: { availability: ["Common"] }, then: [{ id: "common-armor", roll: "common-armor" }] },
          { when: { availability: ["Rare"] }, then: [{ id: "rare-armor", roll: "rare-armor" }] },
          { when: { availability: ["Exotic"] }, then: [{ id: "exotic-armor", roll: "exotic-armor" }] },
        ],
      },
      { ranges: { fighter: [3, 3] }, label: "Cyber creatures", effects: [] },
    ],
  },
  { id: "weapon-availability", kind: "table", name: "Weapons Table", source: src, die: "D6", rows: [row([1, 3], "Common"), row([4, 6], "Rare")] },
  { id: "common-armor", kind: "table", name: "Common Armour", source: src, die: "D6", rows: [row([1, 6], "Flak", [{ item: "flak" }])] },
  { id: "rare-armor", kind: "table", name: "Rare Armour", source: src, die: "D6", rows: [row([1, 6], "Mesh", [{ item: "mesh" }])] },
  {
    id: "exotic-armor",
    kind: "table",
    name: "Exotic Armour",
    source: src,
    die: "D6",
    rows: [row([1, 3], "Conversion Field", [{ item: "conversion-field" }]), row([4, 6], "Power Field", [{ item: "power-field" }])],
  },
  item("lasgun", { category: "Basic weapon", availability: "Common" }),
  item("hellgun", { category: "Basic weapon", availability: "Rare" }),
  item("flak", { category: "Armour", availability: "Common" }),
  item("mesh", { category: "Armour", availability: "Rare" }),
  item("conversion-field", { category: "Armour", availability: "Exotic" }),
  item("power-field", { category: "Armour", availability: "Exotic" }),
  // a creature whose own choice grants something (the Cherubim With Additions' Bio-Scanner)
  item("cherub", {
    category: "Cyber creatures",
    availability: "Common",
    effects: [{ id: "addition", pick: 1, from: [{ id: "scanner", name: "Scanner", effects: [{ item: "scanner" }] }, { id: "none", name: "None" }] }],
  }),
  item("scanner"),
].map((e) => Entry.parse(e));
const c = buildCompendium([{ pack: Pack.parse({ id: "t", name: "T" }), entries }]);
const rec = (archetype: string, patch: Partial<CharacterRecord> = {}): CharacterRecord => ({ ...newRecord(["t"], archetype, "fighter"), ...patch });
const THROW: RollFn = () => {
  throw new Error("rolled a die the record should have had");
};
/** The record replays exactly, rolling and asking nothing, in both modes, with no warnings. */
const replays = (cc: Compendium, r: CharacterRecord, warnings: string[] = []) => {
  for (const mode of ["freeform", "random"] as const) {
    const b = build(cc, r, { mode, roll: THROW, pick: () => assert.fail("asked") });
    assert.deepEqual(b.record, r, `${mode}: the same record`);
    assert.deepEqual(b.pending, [], `${mode}: nothing open`);
    assert.deepEqual(b.warnings, warnings, `${mode}: warnings`);
  }
};
const items = (b: BuildResult) => b.character.items.map((i) => `${i.id}×${i.qty}`).sort();

test("the pack is valid rules", () => {
  assert.deepEqual(checkCompendium(c), []);
});

// gear#1 Rare Basic weapon (Hellgun), gear#2 Rare Armour (Mesh), gear#3 Common Cyber creature (Cherub, with its Scanner)
const p38 = (): CharacterRecord => {
  const r = rec("trader", {
    dice: {
      "trader/gear:count": [],
      "trader/gear#1": [1],
      "trader/gear#1:avail": [5],
      "trader/gear#2": [2],
      "trader/gear#2:avail": [5],
      "trader/gear#2>equipment-generator/rare-armor": [1],
      "trader/gear#3": [3],
      "trader/gear#3:avail": [1],
    },
    choices: { "trader/gear#1:item": ["hellgun"], "trader/gear#3:item": ["cherub"], "cherub/addition": ["scanner"] },
  });
  return build(c, r, { mode: "random", roll: THROW }).record;
};

test("B1: the book's p. 38 example: Rare Armour traded up to a Conversion Field, two other results down a step", () => {
  const before = build(c, p38(), { mode: "random", roll: THROW });
  assert.deepEqual(items(before), ["cherub×1", "hellgun×1", "mesh×1", "scanner×1"]);
  // the Armour result can be raised (and the Basic weapon only back to Rare, given too: no Exotic Basic weapon;
  // no Rare Cyber creature); any two given (the Armour too: Rare, it isn't lost); then the Conversion Field is
  // chosen among the Exotic Armour table's rows
  const yes = build(c, ops.choose(c, before.record, "trader/upgrade#1", ["yes"], { roll: THROW }), { mode: "freeform", roll: THROW });
  assert.deepEqual(yes.pending.find((p) => p.key === "trader/upgrade#1>trader/up")?.options.map((o) => o.id), ["trader/gear#1", "trader/gear#2"]);
  const open = build(c, ops.choose(c, yes.record, "trader/upgrade#1>trader/up", ["trader/gear#2"], { roll: THROW }), { mode: "freeform", roll: THROW });
  const give = open.pending.find((p) => p.key === "trader/upgrade#1:give");
  assert.deepEqual(give?.options.map((o) => o.id), ["trader/gear#1", "trader/gear#2", "trader/gear#3"]);
  const withGive = build(c, ops.choose(c, open.record, "trader/upgrade#1:give", ["trader/gear#1", "trader/gear#3"], { roll: THROW }), { mode: "freeform", roll: THROW });
  const item = withGive.pending.find((p) => p.key === "trader/upgrade#1>trader/up>trader/gear#2:item");
  assert.deepEqual(item?.options.map((o) => o.label), ["Conversion Field", "Power Field"]);
  const next = ops.choose(c, before.record, "trader/upgrade#1", ["yes"], {
    roll: THROW,
    then: {
      "trader/upgrade#1>trader/up": ["trader/gear#2"],
      "trader/upgrade#1:give": ["trader/gear#1", "trader/gear#3"],
      "trader/upgrade#1:give>trader/gear#1:item": ["lasgun"],
      "trader/upgrade#1>trader/up>trader/gear#2:item": ["exotic-armor/Conversion Field"],
      "trader/upgrade#2": ["no"],
    },
  });
  const after = build(c, next, { mode: "freeform", roll: THROW });
  // the Hellgun down to a Lasgun, the Common Cherub lost (and its Scanner, and its option), the Mesh up to a Conversion Field
  assert.deepEqual(items(after), ["conversion-field×1", "lasgun×1"]);
  assert.deepEqual(after.character.options, []);
  const rolls = Object.fromEntries(after.character.rolls.filter((r) => r.table === "equipment-generator").map((r) => [r.key, [r.availability, !!r.lost]]));
  assert.deepEqual(rolls, { "trader/gear#1": ["Common", false], "trader/gear#2": ["Exotic", false], "trader/gear#3": ["Common", true] });
  assert.ok(!after.character.rolls.some((r) => r.table === "rare-armor"), "the Mesh's own roll goes with it");
  replays(c, after.record);
});

test("B1: a trade is offered only when it can be made; a stored yes that can't trades nothing", () => {
  const one = build(c, rec("single"), { mode: "freeform", roll: seededRoller(3) });
  assert.ok(!one.pending.some((p) => p.kind === "trade"), "one result: nothing to give two of");
  assert.equal(one.record.choices["single/upgrade#1"], undefined);
  const yes = { ...one.record, choices: { ...one.record.choices, "single/upgrade#1": ["yes"] } };
  const b = build(c, yes, { mode: "freeform", roll: THROW });
  assert.deepEqual(items(b), items(one));
  assert.deepEqual(b.record.choices["single/upgrade#1"], ["yes"]);
  assert.deepEqual(b.warnings, ["single/upgrade#1: can't be made now; nothing traded"]);
  // a stored "no" stays as it was
  const no = { ...one.record, choices: { ...one.record.choices, "single/upgrade#1": ["no"] } };
  assert.deepEqual(build(c, no, { mode: "freeform", roll: THROW }).record, no);
});

test("B4: an item given up takes what its own choices gave (the Cherub's Scanner, its option)", () => {
  const before = build(c, p38(), { mode: "random", roll: THROW });
  const next = ops.choose(c, before.record, "trader/reroll#1", ["yes"], { roll: seededRoller(4), then: { "trader/reroll#1:give": ["item:cherub", "item:mesh"] } });
  const after = build(c, ops.fillPending(c, next, { roll: seededRoller(5) }), { mode: "freeform", roll: THROW });
  assert.ok(!after.character.items.some((i) => ["cherub", "scanner"].includes(i.id)), items(after).join());
  assert.ok(!after.character.options.some((o) => o.source === "cherub"));
  replays(c, after.record);
});

const RULES = process.env.RULES_DIR || join(import.meta.dirname, "../data/rules");
const real = existsSync(join(RULES, "loyalist")) ? buildCompendium(withoutHidden(loadAllPacks(RULES))) : null;
const skip = !real && "no rules";
const R = real!;
const realRandom = (a: string, s: string, seed: number) => build(R, newRecord(R.packs.map((p) => p.id), a, s), { mode: "random", roll: seededRoller(seed) });
/** Take trade `key` ("yes") and fill what it opens at random, as the report's runs did. */
const takeTrade = (r: CharacterRecord, key: string, seed: number) =>
  ops.fillPending(R, ops.choose(R, r, key, ["yes"], { roll: seededRoller(7_000_000 + seed) }), { roll: seededRoller(7_100_000 + seed) });
const sub = (r: CharacterRecord, prefix: string) => Object.fromEntries(Object.entries(r.choices).filter(([k]) => k.startsWith(prefix)));

test("real rules, B1: the p. 38 example on an Imperial Guard Fighter's Rare Armour", { skip }, () => {
  const b = realRandom("imperial-guard", "fighter", 4);
  const results = b.character.rolls.filter((r) => r.table === "equipment-generator" && r.availability && !r.lost);
  const armour = results.find((r) => r.label === "Armour" && r.availability === "Rare");
  assert.ok(armour, "seed 4 has Rare Armour");
  const others = results.filter((r) => r !== armour && r.availability === "Common").map((r) => r.key);
  assert.ok(others.length >= 2);
  const k = "equipment/upgrade#1";
  const next = ops.choose(R, b.record, k, ["yes"], {
    then: { [`${k}>equipment/up`]: [armour.key], [`${k}:give`]: others.slice(0, 2), [`${k}>equipment/up>${armour.key}:item`]: ["exotic-armor/Conversion Field"] },
  });
  const after = build(R, next, { mode: "freeform", roll: THROW });
  assert.deepEqual(after.pending.filter((p) => p.key.startsWith(k)), []);
  assert.ok(after.character.items.some((i) => i.id === "conversion-field"));
  const was = b.character.items.filter((i) => i.from.some((f) => f.key?.startsWith(armour.key))).map((i) => i.id);
  for (const id of was) assert.ok(!after.character.items.some((i) => i.id === id), `${id} traded in`);
  assert.equal(after.character.rolls.find((r) => r.key === armour.key)?.availability, "Exotic");
  for (const key of others.slice(0, 2)) assert.equal(after.character.rolls.find((r) => r.key === key)?.lost, true);
  assert.deepEqual(build(R, after.record, { mode: "freeform", roll: THROW }).record, after.record);
});

test("real rules, B1: the run's trades give and get, every result can be traded", { skip }, () => {
  for (const [a, s, seed, k] of [
    ["antagonist", "sage", 1, "equipment/upgrade#1"],
    ["antagonist", "sage", 6, "equipment/upgrade#1"],
    ["antagonist", "scout", 3, "equipment/upgrade#1"],
    ["imperial-guard", "fighter", 4, "equipment/upgrade#1"],
  ] as const) {
    const b = realRandom(a, s, seed);
    const next = takeTrade(b.record, k, seed);
    const after = build(R, next, { mode: "freeform", roll: THROW });
    assert.deepEqual(after.warnings, [], `${a}/${s} ${seed}`);
    assert.deepEqual(after.pending, [], `${a}/${s} ${seed}`);
    assert.equal(next.choices[`${k}:give`]?.length, 2, `${a}/${s} ${seed}: two given`);
    const target = next.choices[`${k}>equipment/up`]?.[0];
    assert.ok(target && next.choices[`${k}>equipment/up>${target}:item`]?.length === 1, `${a}/${s} ${seed}: one raised`);
    assert.deepEqual(build(R, next, { mode: "random", roll: THROW }).record, next);
  }
  // Ecclesiarchy's Wards: never offered with nothing left to give
  for (let seed = 1; seed <= 30; seed++) {
    let r = realRandom("ecclesiarchy", "scout", seed).record;
    for (let n = 1; n <= 8 && r.choices[`ecclesiarchy/wards#${n}`]; n++) r = takeTrade(r, `ecclesiarchy/wards#${n}`, seed * 10 + n);
    const after = build(R, r, { mode: "freeform", roll: THROW });
    // (a downgrade to an availability with nothing of that type waits on the owner)
    const ws = after.warnings.filter((w) => w.includes("wards") && !w.includes(" to choose"));
    assert.deepEqual(ws, [], `ecclesiarchy scout ${seed}`);
    assert.deepEqual(after.pending, [], `ecclesiarchy scout ${seed}`);
  }
});

/** A rules update with random choices leaves nothing open, and a second update rolls and changes nothing. */
const updatesCleanly = (nc: Compendium, r: CharacterRecord, seed: number) => {
  const up = ops.updateRules(nc, r, "v2", true, seededRoller(8_500_000 + seed));
  const b = build(nc, up, { mode: "freeform", roll: THROW });
  assert.deepEqual(b.pending, []);
  assert.deepEqual(ops.updateRules(nc, up, "v2", true, THROW), up);
  return b;
};

test("real rules, B2: a Daemon whose god the rules removed gets one god and its powers", { skip }, () => {
  const b = realRandom("daemons", "daemonic", 8);
  assert.deepEqual(b.record.choices["daemons/god"], ["nurgle"]);
  const a = structuredClone(R.archetypes.get("daemons")!);
  for (const s of a.sections) for (const e of s.effects) if ("pick" in e && e.id === "god" && e.from) e.from = e.from.filter((o) => !("id" in o) || o.id !== "nurgle");
  const nc = { ...R, archetypes: new Map(R.archetypes).set("daemons", a) } as Compendium;
  const after = updatesCleanly(nc, b.record, 8);
  assert.ok(after.character.powers.length > 0);
});

test("real rules, B2: a generated item made Legendary is rolled again once, and stays", { skip }, () => {
  for (const [a, s, seed, id] of [
    ["bounty-hunters-and-gunslingers", "scout", 4, "chain-axe"],
  ] as const) {
    const b = realRandom(a, s, seed);
    assert.ok(b.character.items.some((i) => i.id === id));
    const e = structuredClone(R.items.get(id)!);
    e.availability = "Legendary";
    const nc = { ...R, items: new Map(R.items).set(id, e) } as Compendium;
    const after = updatesCleanly(nc, b.record, seed);
    assert.ok(!after.character.items.some((i) => i.id === id));
  }
});

test("real rules, B3: a trade taken a second time leaves the first, and the record replays", { skip }, () => {
  for (const [a, s, seed, base] of [
    ["inquisitor-acolyte", "scout", 4, "equipment/upgrade"],
    ["tech-priests", "fighter", 2, "equipment/reroll"],
    ["cultists-and-fanatics", "fighter", 3, "equipment/upgrade"],
    ["cultists-and-fanatics", "fighter", 3, "equipment/reroll"],
  ] as const) {
    const b = realRandom(a, s, seed);
    const one = takeTrade(b.record, `${base}#1`, seed);
    const first = sub(one, `${base}#1`);
    if (!one.choices[`${base}#2`]) continue; // (nothing left for a second)
    const two = takeTrade(one, `${base}#2`, seed + 500);
    assert.deepEqual(sub(two, `${base}#1`), first, `${a}/${s} ${seed}: trade #1 as it was`);
    for (const [k, v] of Object.entries(one.choices)) if (!k.startsWith(base)) assert.deepEqual(two.choices[k], v, `${a}/${s} ${seed}: ${k}`);
    const after = build(R, two, { mode: "freeform", roll: THROW });
    assert.deepEqual(after.pending, [], `${a}/${s} ${seed}`);
    assert.deepEqual(after.warnings, [], `${a}/${s} ${seed}`);
    assert.deepEqual(build(R, two, { mode: "random", roll: THROW }).record, two);
  }
});

test("real rules, B4: an item a trade gives up leaves none of its choices or what they gave", { skip }, () => {
  for (const [a, s, seed] of [
    ["antagonist", "sage", 4],
    ["imperial-guard", "marksman", 4],
  ] as const) {
    const b = realRandom(a, s, seed);
    const after = build(R, takeTrade(b.record, "equipment/upgrade#1", seed), { mode: "freeform", roll: THROW });
    const owned = new Set(after.character.items.map((i) => i.id));
    for (const o of after.character.options) if (R.items.has(o.source) && !R.archetypes.has(o.source)) assert.ok(owned.has(o.source), `${a}/${s} ${seed}: ${o.id} from ${o.source}`);
    for (const i of after.character.items) {
      for (const f of i.from) if (R.items.has(f.entry) && !f.section) assert.ok(owned.has(f.entry), `${a}/${s} ${seed}: ${i.id} from ${f.entry}`);
    }
  }
});

test("real rules, B6: a Crone World Seer with The Third Eye keeps every Psychic Power bonus", { skip }, () => {
  const b = realRandom("crone-world-eldar", "eldar", 186);
  const next = ops.rerollDecision(R, b.record, ["crone-world-eldar/rank-10-choice"], { roll: seededRoller(1_000_186) });
  const after = build(R, next, { mode: "freeform", roll: THROW });
  assert.deepEqual(after.warnings, []);
  assert.deepEqual(after.pending, []);
  const bonuses = after.character.options.filter((o) => o.id.startsWith("path-of-the-seer-psyker-psychic-power"));
  for (const o of bonuses) {
    const picks = Object.entries(next.choices).filter(([k]) => k.startsWith(`crone-world-eldar/${o.id}-`));
    assert.ok(picks.some(([, v]) => v.length === 1), `${o.id} holds a power`);
  }
  // random builds that take The Third Eye never lose one either
  for (let seed = 1; seed <= 150; seed++) {
    const r = realRandom("crone-world-eldar", "eldar", seed);
    assert.ok(!r.warnings.some((w) => w.includes("psychic-power")), `seed ${seed}: ${r.warnings.join("; ")}`);
  }
});

test("real rules, B8: a book-only Cherub builds and updates with every pack", { skip }, () => {
  const book = buildCompendium(withoutHidden(loadAllPacks(RULES)).filter((p) => p.pack.id === "loyalist"));
  const r = build(book, newRecord(["loyalist"], "cherubim", "cherubim"), { mode: "random", roll: seededRoller(1) }).record;
  const up = ops.updateRules(R, r, "x", true, seededRoller(9_100_001));
  assert.equal(up.subtype, "cherubim");
  assert.deepEqual(build(R, up, { mode: "freeform", roll: THROW }).pending, []);
});
