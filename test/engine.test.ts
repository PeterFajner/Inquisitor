// The engine against the made-up fixture packs in test/fixtures (base, and
// extra which extends it). Run: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadPack } from "../src/lib/rules-files.ts";
import { buildCompendium, checkCompendium, type Compendium } from "../src/shared/rules/compendium.ts";
import type { Effect } from "../src/shared/rules/schema.ts";
import * as dice from "../src/shared/engine/dice.ts";
import { rollDie, seededRoller, splitmix32 } from "../src/shared/engine/rng.ts";
import { build, BuildError, difficultyWithin, invalidateCompendium as invalidate, rollSubtype, type BuildResult } from "../src/shared/engine/build.ts";
import { armourCell, toSheetCharacter as sheetCharacter } from "../src/shared/sheet-map.ts";
import { warbandWarnings } from "../src/shared/engine/warband.ts";
import { newRecord, parseRecord, type CharacterRecord } from "../src/shared/engine/record.ts";
import { clearDecisions, isUnder, reroll } from "../src/shared/engine/reroll.ts";
import { diff } from "../src/shared/engine/diff.ts";
import { label, powerScore, simulate } from "../src/shared/engine/balance.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");

function compendium(packs = ["base", "extra"]): Compendium {
  return buildCompendium(
    packs.map((id) => {
      const { pack, problems } = loadPack(id, FIXTURES);
      assert.deepEqual(problems, [], `fixture pack ${id}`);
      return pack!;
    }),
  );
}
const C = compendium();
const PACKS = ["base", "extra"];
const clone = (c: Compendium): Compendium => structuredClone(c);
const ones = () => 1;
const noRolls = () => {
  throw new Error("rolled a die the record should have had");
};
const rec = (archetype: string, subtype: string, patch: Partial<CharacterRecord> = {}): CharacterRecord => ({
  ...newRecord(PACKS, archetype, subtype),
  ...patch,
});
const random = (r: CharacterRecord, seed = 1) => build(C, r, { mode: "random", roll: seededRoller(seed) });
const finals = (b: BuildResult) => Object.fromEntries(Object.entries(b.character.stats).map(([k, v]) => [k, v.final]));
const ids = (list: { id: string }[]) => list.map((x) => x.id).sort();
const notes = (b: BuildResult) => b.character.notes.map((n) => n.text);

// ---------------------------------------------------------------------------

test("fixtures are valid rules", () => {
  assert.deepEqual(checkCompendium(C), []);
  assert.equal(C.talents.get("dodge")!.points, 10, "extra overrides base");
  assert.equal(C.origin.get("talent/dodge"), "extra");
});

test("dice: parse, totals, mean/min/max, average stat line", () => {
  const e = dice.parseDice("60+2D10");
  assert.equal(dice.faceCount(e), 2);
  assert.equal(dice.total(e, [3, 9]), 72);
  assert.deepEqual(dice.faceSides(dice.parseDice("D3+2D6-1")), [3, 6, 6]);
  assert.equal(dice.total(dice.parseDice("-D10"), [4]), -4);
  assert.equal(dice.total(dice.parseDice(-20), []), -20);
  assert.equal(dice.mean("60+2D10"), 71);
  assert.equal(dice.min("D3+3"), 4);
  assert.equal(dice.max("D3+3"), 6);
  assert.equal(dice.min("10-D6"), 4);
  assert.equal(dice.max("10-D6"), 9);
  assert.equal(dice.mean("D100"), 50.5);
  assert.ok(dice.isDice("2D6") && dice.isDice(5) && !dice.isDice("D") && !dice.isDice("2d6x"));
  assert.ok(!dice.validFaces(e, [11, 1]) && !dice.validFaces(e, [1]) && dice.validFaces(e, [10, 1]));
  assert.throws(() => dice.total(e, [0, 1]));
  assert.throws(() => dice.parseDice("6+"));
  assert.deepEqual(dice.averageStats({ WS: "60+2D10", Nv: "65+2D6", BS: 7 }), { WS: 71, BS: 7, Nv: 72 });
  const r = dice.roll("2D6+1", () => 6);
  assert.deepEqual(r, { faces: [6, 6], total: 13 });
});

test("rng: seeded, in range, unbiased enough", () => {
  const a = seededRoller(42);
  const b = seededRoller(42);
  const xs = Array.from({ length: 50 }, () => a(6));
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b(6)));
  const next = splitmix32(7);
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 60000; i++) counts[rollDie(next, 6)]++;
  assert.equal(counts[0], 0);
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(counts[f] - 10000) < 500, `face ${f}: ${counts[f]}`);
  assert.throws(() => rollDie(next, 0));
});

test("record: parse validates shape", () => {
  assert.ok(parseRecord(rec("hero", "fighter")).ok);
  const bad = parseRecord({ ...rec("hero", "fighter"), overrides: [{ op: "stat", stat: "XX", value: 1 }] });
  assert.ok(!bad.ok);
  assert.ok(!parseRecord({ v: 2 }).ok);
});

test("build throws on an unknown archetype or subtype", () => {
  assert.throws(() => random(rec("nobody", "fighter")), BuildError);
  assert.throws(() => random(rec("hero", "sage")), BuildError);
});

// ---------------------------------------------------------------------------
// Every face 1 and every random choice the first option: an exact character.

test("every effect type, all ones: exact stats, grants, rolls and notes", () => {
  const b = build(C, rec("hero", "fighter"), { mode: "random", roll: ones });
  const ch = b.character;
  assert.deepEqual(b.pending, []);
  // base 62/52/52/52/62/52/52/62/62; Brute S+10; I+D10; luck Wp,Sg +D6 each;
  // all +1; Nv set 50; four boons of +10 WS; WS/BS max average (71/61);
  // Ld min 90; Extra Arm S+D10.
  assert.deepEqual(finals(b), { WS: 71, BS: 53, S: 64, T: 53, I: 64, Wp: 54, Sg: 54, Nv: 50, Ld: 90 });
  assert.equal(ch.stats.WS.base, 62);
  assert.equal(ch.stats.WS.modified, 71);
  assert.deepEqual(ch.stats.WS.caps, [{ source: "hero", max: 71 }]);
  assert.deepEqual(ch.options.map((o) => [o.id, o.name, o.text]), [["brute", "Brute", "Big and strong."]]);
  assert.deepEqual(ids(ch.talents), ["ambidextrous", "awareness", "dodge", "hunter"]);
  assert.equal(ch.talents.find((t) => t.id === "hunter")!.from.length, 2, "pool pick + option");
  assert.deepEqual(ids(ch.exotics), ["fearsome", "spit-acid"]);
  assert.deepEqual(ids(ch.mutations), ["extra-arm"]);
  assert.deepEqual(ch.powers, []);
  assert.equal(ch.alignment, "Puritan");
  const items = Object.fromEntries(ch.items.map((i) => [i.id, i.qty]));
  assert.deepEqual(items, { laspistol: 1, "frag-grenade": 1, autopistol: 4 });
  assert.deepEqual(
    ch.rolls.filter((r) => r.table === "boons").map((r) => r.label),
    ["+10 WS", "+10 WS", "+10 WS", "+10 WS"],
  );
  assert.deepEqual(notes(b), ["Dodgy.", "Either.", "Must hate heretics."]);
  assert.deepEqual(
    ch.notes.map((n) => [n.kind, n.source, n.section]),
    [
      ["gm", "hero", "Talents"],
      ["gameplay", "hero", "Talents"],
      ["unfit", "hero", "Alignment"],
    ],
  );
  assert.equal(ch.notes[2].proposal, "a hatred effect");
  assert.deepEqual(b.warnings, []);
  // keys
  const keys = b.log.map((l) => l.key);
  for (const k of [
    "hero/@stats:WS",
    "hero/type",
    "hero/@I",
    "hero/luck:Wp",
    "hero/luck:Sg",
    "hero/boons:count",
    "hero/boons#1",
    "hero/boons#4",
    "hero/@frag-grenade",
    "hero/gear:count",
    "hero/gear#1",
    "hero/gear#1:avail",
    "hero/gear#1:item",
    "hero/gear#4:item",
    "hero/wyrd",
    "hero/extra-exotic",
    "hero/any-talents",
    "extra-arm/arm-strength",
    "hero/alignment",
  ]) {
    assert.ok(keys.includes(k), `log has ${k}`);
  }
  assert.ok(b.log.every((l) => !l.reused), "nothing came from the record");
  const typeLog = b.log.find((l) => l.key === "hero/type")!;
  assert.deepEqual(typeLog.result, ["Brute"]);
  assert.equal(typeLog.label, "Heroes");
  assert.deepEqual(b.log.find((l) => l.key === "hero/@stats:WS")!.faces, [1, 1]);
  assert.deepEqual(b.record.choices["hero/type"], ["brute"]);
  assert.deepEqual(b.record.dice["hero/@stats:WS"], [1, 1]);
});

test("determinism: the same record gives the same character, rolling nothing", () => {
  for (const [a, s] of [["hero", "fighter"], ["hero", "psyker"], ["cherub", "cherub"], ["ogre", "fighter"]]) {
    for (const seed of [1, 2, 3, 99]) {
      const first = random(rec(a, s), seed);
      const again = build(C, first.record, { mode: "random", roll: noRolls });
      assert.deepEqual(again.character, first.character, `${a}/${s} seed ${seed}`);
      assert.deepEqual(again.record, first.record);
      assert.ok(again.log.every((l) => l.reused));
      const free = build(C, first.record, { mode: "freeform", roll: noRolls });
      assert.deepEqual(free.character, first.character);
      assert.deepEqual(free.pending, []);
      assert.deepEqual(random(rec(a, s), seed).record, first.record, "same seed, same record");
    }
  }
});

test("stability: inserting unrelated effects keeps every other key and result", () => {
  for (const seed of [1, 5, 8, 13, 21]) {
    for (const sub of ["fighter", "psyker"]) {
      const before = random(rec("hero", sub), seed);
      const c2 = clone(C);
      const hero = c2.archetypes.get("hero")!;
      const extra: Effect[] = [
        { id: "new-chance", chance: 50, then: [{ prose: "New.", kind: "gameplay" }] },
        { id: "new-roll", stat: "T", add: "D6" },
      ];
      hero.sections.unshift({ name: "New", effects: extra });
      hero.sections.find((s) => s.name === "Talents")!.effects.unshift({ id: "new-pick", pick: 1, from: [{ prose: "A.", kind: "gm" }, { prose: "B.", kind: "gm" }] });
      c2.tables.get("boons")!.rows[0].effects.push({ id: "boon-extra", chance: 10, then: [] });
      const after = build(c2, before.record, { mode: "random", roll: seededRoller(seed + 1000) });
      for (const [k, v] of Object.entries(before.record.dice)) assert.deepEqual(after.record.dice[k], v, k);
      for (const [k, v] of Object.entries(before.record.choices)) assert.deepEqual(after.record.choices[k], v, k);
      const results = new Map(after.log.map((l) => [l.key, l.result]));
      for (const l of before.log) assert.deepEqual(results.get(l.key), l.result, l.key);
      assert.ok(after.record.dice["hero/new-chance"] && after.record.dice["hero/new-roll"]);
      const { T: _t, ...rest } = finals(after);
      const { T: _t0, ...rest0 } = finals(before);
      assert.deepEqual(rest, rest0);
      assert.deepEqual(after.character.talents, before.character.talents);
      assert.deepEqual(after.character.items, before.character.items);
      assert.deepEqual(after.character.powers, before.character.powers);
    }
  }
});

// ---------------------------------------------------------------------------
// Effect types one at a time, from records set by hand.

const base = build(C, rec("hero", "fighter"), { mode: "random", roll: ones }).record;
const withHero = (dice: Record<string, number[]>, choices: Record<string, string[]>, overrides: CharacterRecord["overrides"] = []) =>
  build(C, { ...base, dice: { ...base.dice, ...dice }, choices: { ...base.choices, ...choices }, overrides }, { mode: "random", roll: ones });

test("pick from named options, nested pick and chance", () => {
  const hi = withHero({ "hero/scholar-sg-roll": [30] }, { "hero/type": ["scholar"], "hero/scholar-stat": ["scholar-sg"] });
  assert.deepEqual(hi.character.options.map((o) => o.id), ["scholar", "scholar-sg"]);
  assert.equal(hi.character.stats.Sg.final, 54 + 15);
  assert.equal(hi.character.stats.BS.final, 43);
  assert.ok(!hi.character.talents.some((t) => t.id === "dodge" || t.id === "hunter") || hi.character.talents.find((t) => t.id === "hunter")!.from.every((f) => f.key));
  assert.ok(!notes(hi).includes("Dodgy."));
  const lo = withHero({ "hero/scholar-sg-roll": [51] }, { "hero/type": ["scholar"], "hero/scholar-stat": ["scholar-sg"] });
  assert.equal(lo.character.stats.Sg.final, 54 + 10);
  assert.ok(!("hero/scholar-sg-roll" in base.dice), "unused decisions aren't in the record");
  assert.ok(!("hero/scholar-sg-roll" in withHero({}, {}).record.dice));
  // the parent of a nested decision is the decision that chose its option
  assert.equal(hi.log.find((l) => l.key === "hero/scholar-stat")!.parent, "hero/type");
  assert.equal(hi.log.find((l) => l.key === "hero/scholar-sg-roll")!.parent, "hero/scholar-stat");
});

test("pick from effects (cherub): grants and stat options by derived ids", () => {
  const b = build(C, rec("cherub", "cherub", { choices: { "cherub/role": ["item:lasgun", "bonus"] } }), { mode: "random", roll: noRolls });
  assert.deepEqual(b.character.items.map((i) => [i.id, i.qty]), [["lasgun", 2]]);
  assert.equal(b.character.stats.Ld.final, 5);
  assert.equal(b.character.alignment, "Neutral", "a single alignment is chosen without a roll");
  const t = build(C, rec("cherub", "cherub", { choices: { "cherub/role": ["talent:dodge", "talent:awareness"] } }), { mode: "random", roll: noRolls });
  assert.deepEqual(ids(t.character.talents), ["awareness", "dodge"]);
});

test("caps: the human 100 applies to the roll, not to later bonuses", () => {
  const pack = {
    pack: { id: "cap", name: "cap" },
    entries: [
      {
        id: "brute", kind: "archetype", name: "Brute", source: { page: 1 },
        subtypes: [{ id: "b", name: "B", stats: { WS: "95+2D10", BS: 1, S: 1, T: 1, I: 1, Wp: 1, Sg: 1, Nv: 1, Ld: 1 } }],
        sections: [{ name: "Boons", effects: [{ stat: "WS", add: 10 }] }],
      },
    ],
  } as const;
  const c = buildCompendium([pack as never]);
  const b = build(c, { ...newRecord(["cap"], "brute", "b"), dice: { "brute/@stats:WS": [10, 10] } }, { mode: "random", roll: noRolls });
  assert.equal(b.character.stats.WS.base, 115, "the roll itself");
  assert.equal(b.character.stats.WS.final, 110, "rolled 115 → 100, then +10");
});

test("caps: human 100, non-human uncapped, max average", () => {
  const cherub = build(C, rec("cherub", "cherub"), { mode: "random", roll: ones });
  assert.equal(cherub.character.stats.WS.base, 120);
  assert.equal(cherub.character.stats.WS.final, 100);
  const ogre = build(C, rec("ogre", "fighter", { dice: { "ogre/@stats:WS": [10] } }), { mode: "random", roll: ones });
  assert.equal(ogre.character.stats.WS.final, 160);
  assert.equal(ogre.character.stats.S.final, 200);
  // four boons of +10 WS on 60+2D10 (all tens) is 121, capped at average 71
  const b = withHero({ "hero/@stats:WS": [10, 10] }, {});
  assert.equal(b.character.stats.WS.final, 71);
});

test("stat effects: dice add with and without id, each, all, set, min", () => {
  const b = withHero({ "hero/@I": [7], "hero/luck:Wp": [6], "hero/luck:Sg": [2], "hero/@stats:Nv": [6, 6] }, {});
  assert.equal(b.character.stats.I.final, 62 + 7 + 1);
  assert.equal(b.character.stats.Wp.final, 52 + 6 + 1);
  assert.equal(b.character.stats.Sg.final, 52 + 2 + 1);
  assert.equal(b.character.stats.Nv.final, 50, "set after base and +1");
  assert.equal(b.character.stats.Ld.final, 90, "min 90");
  assert.deepEqual(b.character.stats.I.mods[0], { add: 7, source: "hero", key: "hero/@I" });
});

test("grants: dice quantity and an ability's own effects", () => {
  const b = withHero({ "hero/@frag-grenade": [3], "extra-arm/arm-strength": [9] }, {});
  assert.equal(b.character.items.find((i) => i.id === "frag-grenade")!.qty, 3);
  assert.equal(b.character.stats.S.final, 52 + 10 + 1 + 9);
  assert.deepEqual(b.character.mutations[0].from, [{ entry: "hero", section: "Mutations" }]);
});

test("optional and chance", () => {
  const no = withHero({ "hero/wyrd": [6] }, { "hero/extra-exotic": ["no"] });
  assert.deepEqual(no.character.exotics, []);
  assert.ok(notes(no).includes("Not a Wyrd."));
  const yes = withHero({ "hero/wyrd": [5] }, { "hero/extra-exotic": ["yes"] });
  assert.deepEqual(ids(yes.character.exotics), ["fearsome", "spit-acid"]);
  assert.ok(!notes(yes).includes("Not a Wyrd."));
});

test("roll: times, $subtype column, duplicates re-rolled, roll again", () => {
  const b = withHero(
    {
      "hero/boons:count": [1], // D3+3 = 4
      "hero/boons#1": [35], // Dodge (fighter 31-50)
      "hero/boons#2": [40], // Dodge again: duplicate
      "hero/boons#2~2": [20], // +10 WS
      "hero/boons#3": [60], // Awareness: the profile's own talent (step A comes first): a duplicate
      "hero/boons#3~2": [20], // +10 WS
      "hero/boons#4": [98], // Roll again on Fighter table
      "hero/boons#4>boons/again": [75], // Hunter
      "hero/@stats:WS": [1, 1],
    },
    { "hero/type": ["scholar"], "hero/scholar-stat": ["scholar-ld"] },
  );
  const boons = b.character.rolls.filter((r) => r.table === "boons");
  assert.deepEqual(boons.map((r) => [r.key, r.label]), [
    ["hero/boons#1", "Dodge"],
    ["hero/boons#2~2", "+10 WS"],
    ["hero/boons#3~2", "+10 WS"],
    ["hero/boons#4", "Roll again on Fighter table"],
    ["hero/boons#4>boons/again", "Hunter"],
  ]);
  assert.ok(b.log.find((l) => l.key === "hero/boons#2")!.rerolled);
  assert.ok(b.log.find((l) => l.key === "hero/boons#3")!.rerolled, "a talent the profile grants later is a duplicate");
  assert.deepEqual(b.log.find((l) => l.key === "hero/boons#2")!.result, ["Dodge"]);
  assert.ok(ids(b.character.talents).includes("hunter"));
  const hunter = b.character.talents.find((t) => t.id === "hunter")!;
  assert.deepEqual(hunter.from[0], { entry: "boons", key: "hero/boons#4>boons/again", section: "Boons" });
  // psyker column: 61-85 is a psyker-talent pick (a pool pick inside a row)
  const p = random(rec("hero", "psyker", { dice: { "hero/boons:count": [1], "hero/boons#1": [70] } }), 4);
  assert.equal(p.character.rolls[0].label, "Psyker Talent");
  const pk = p.log.find((l) => l.key === "hero/boons#1>boons/psy-talent")!;
  assert.ok(["Mind Ward", "Sense"].includes(pk.result[0]));
  assert.equal(pk.parent, "hero/boons#1");
});

test("conditions: has, option, not, any/all, subtype, alignment (decided later)", () => {
  const rad = withHero({}, { "hero/alignment": ["Radical"] });
  assert.ok(ids(rad.character.talents).includes("leader"), "alignment row comes after the when");
  assert.equal(rad.character.alignment, "Radical");
  const pur = withHero({}, { "hero/alignment": ["Puritan"] });
  assert.ok(!ids(pur.character.talents).includes("leader"));
  assert.ok(notes(pur).includes("Dodgy."), "has dodge from Brute");
  assert.ok(notes(pur).includes("Either."), "all: hero fighter");
  assert.ok(!ids(pur.character.talents).includes("ambidextrous") || pur.character.talents.find((t) => t.id === "ambidextrous")!.from.every((f) => f.key === "hero/any-talents"));
  const psy = random(rec("hero", "psyker"), 3);
  assert.ok(notes(psy).includes("Either."), "any: psyker");
  assert.ok(psy.character.powers.some((x) => x.id === "bolt"), "subtype psyker");
});

test("gear: generator, availability (with roll-on), rerolls, alien, exclude", () => {
  const gear = (dice: Record<string, number[]>, alignment = "Puritan") =>
    withHero({ "hero/gear:count": [1], ...dice }, { "hero/alignment": [alignment] });
  // slot 1: Pistol, 6 then 6 → Legendary: not allowed, re-rolled; then Basic weapon, Rare
  const b = gear({
    "hero/gear#1": [10],
    "hero/gear#1:avail": [6],
    "hero/gear#1:avail>weapon-availability/legendary": [6],
    "hero/gear#1~2": [45],
    "hero/gear#1~2:avail": [4],
    // slot 2: Heavy weapon, Common: no such gear, re-rolled; Heavy Rare: heavy-flamer excluded
    "hero/gear#2": [75],
    "hero/gear#2:avail": [1],
    "hero/gear#2~2": [75],
    "hero/gear#2~2:avail": [5],
  });
  const log = new Map(b.log.map((l) => [l.key, l]));
  assert.deepEqual(log.get("hero/gear#1:avail>weapon-availability/legendary")!.result, ["Legendary"]);
  assert.ok(log.get("hero/gear#1")!.rerolled);
  assert.equal(log.get("hero/gear#1~2:item")!.label, "Rare Basic weapon");
  assert.deepEqual(log.get("hero/gear#1~2:item")!.result, ["Hellgun"], "no alien gear for a Puritan");
  assert.ok(log.get("hero/gear#2")!.rerolled);
  assert.deepEqual(log.get("hero/gear#2~2:item")!.result, ["Heavy Bolter"]);
  // Radical may have alien gear: the Rare Basic weapon candidates grow
  const free = build(
    C,
    { ...b.record, choices: { ...b.record.choices, "hero/alignment": ["Radical"] }, dice: { ...b.record.dice } },
    { mode: "freeform", roll: ones },
  );
  delete free.record.choices["hero/gear#1~2:item"];
  const again = build(C, free.record, { mode: "freeform", roll: noRolls });
  const p = again.pending.find((x) => x.key === "hero/gear#1~2:item")!;
  assert.deepEqual(p.options.map((o) => o.id), ["hellgun", "shuriken-catapult"]);
  assert.equal(p.kind, "gear-item");
  // alien gear stored for a Radical replays without complaint
  const alien = build(C, { ...free.record, choices: { ...free.record.choices, "hero/gear#1~2:item": ["shuriken-catapult"] } }, { mode: "random", roll: noRolls });
  assert.ok(alien.character.items.some((i) => i.id === "shuriken-catapult"));
  assert.deepEqual(alien.warnings, []);
  // a generator row's effects apply (Grenade note)
  const g = gear({ "hero/gear#1": [90], "hero/gear#1:avail": [1] });
  assert.ok(notes(g).includes("Grenade note."));
});

test("gear: rows that roll on a sub-table; categories with no items", () => {
  const b = random(
    rec("hero", "psyker", {
      dice: {
        "hero/gear:count": [1],
        "hero/gear#1": [85],
        "hero/gear#1:avail": [2], // Common: allowed; the row's own roll makes the gear
        "hero/gear#1>equipment-generator/bionic": [5],
        "hero/gear#1>equipment-generator/bionic>bionics/@bionic-eye": [2],
        "hero/gear#2": [95],
        "hero/gear#2:avail": [4],
      },
    }),
  );
  const eye = b.character.items.find((i) => i.id === "bionic-eye")!;
  assert.equal(eye.qty, 2);
  assert.deepEqual(eye.from[0], { entry: "bionics", key: "hero/gear#1>equipment-generator/bionic", section: "Equipment" });
  assert.ok(!b.log.some((l) => l.key === "hero/gear#1:item"));
  const cyber = b.character.rolls.find((r) => r.key === "hero/gear#2")!;
  assert.deepEqual(cyber, { key: "hero/gear#2", table: "equipment-generator", label: "Cyber creatures", availability: "Rare" });
  assert.ok(b.warnings.some((w) => w.includes("Cyber creatures")));
});

test("gear: downgrade; Common downgraded is lost", () => {
  const b = build(
    C,
    rec("ogre", "fighter", {
      dice: {
        "ogre/gear#1": [10],
        "ogre/gear#1:avail": [1], // Common → lost
        "ogre/gear#2": [10],
        "ogre/gear#2:avail": [4], // Rare → Common: not allowed, re-rolled
        "ogre/gear#2~2": [10],
        "ogre/gear#2~2:avail": [6],
        "ogre/gear#2~2:avail>weapon-availability/legendary": [1], // Exotic → Rare
        "ogre/gear#3": [10],
        "ogre/gear#3:avail": [6],
        "ogre/gear#3:avail>weapon-availability/legendary": [6], // Legendary → Exotic: not allowed
        "ogre/gear#3~2": [45],
        "ogre/gear#3~2:avail": [6],
        "ogre/gear#3~2:avail>weapon-availability/legendary": [2], // Exotic → Rare basic
      },
    }),
    { mode: "random", roll: ones },
  );
  const items = b.character.items.map((i) => i.id).sort();
  assert.deepEqual(items, ["hellgun", "plasma-pistol"]);
  assert.ok(!b.log.some((l) => l.key === "ogre/gear#1:item"), "lost");
  assert.ok(b.character.rolls.some((r) => r.key === "ogre/gear#1"));
});

test("gear: missing tables degrade with a warning", () => {
  const c2 = clone(C);
  c2.tables.delete("weapon-availability");
  const b = build(c2, rec("hero", "fighter"), { mode: "random", roll: ones });
  assert.ok(b.warnings.some((w) => w.includes("weapon-availability")));
  assert.equal(b.character.items.find((i) => i.id === "autopistol")?.qty, 4, "any allowed availability");
  c2.tables.delete("equipment-generator");
  const n = build(c2, rec("hero", "fighter"), { mode: "random", roll: ones });
  assert.ok(n.warnings.some((w) => w.includes("equipment-generator")));
  assert.deepEqual(n.character.items.map((i) => i.id).sort(), ["frag-grenade", "laspistol"]);
});

test("powers: max difficulty, distinct, cross-discipline penalty", () => {
  // count D6 = 3; picks within Telekinesis: 3 powers
  const same = random(
    rec("hero", "psyker", { dice: { "hero/powers:count": [3] }, choices: { "hero/powers#1": ["push"], "hero/powers#2": ["lift"], "hero/powers#3": ["mind-scan"] } }),
  );
  // the third crosses disciplines: D6-1 → only 2
  assert.deepEqual(ids(same.character.powers), ["bolt", "lift", "push"]);
  const pend = build(C, rec("hero", "psyker", { dice: { "hero/powers:count": [6] } }), { mode: "freeform", roll: ones });
  const p = pend.pending.find((x) => x.key === "hero/powers#1")!;
  assert.deepEqual(p.options.map((o) => o.id), ["hellfire", "lift", "mind-scan", "push"], "no dominate (15), no bolt (owned)");
  for (let seed = 0; seed < 30; seed++) {
    const r = random(rec("hero", "psyker"), seed);
    const pw = r.character.powers.filter((x) => x.id !== "bolt");
    assert.equal(new Set(pw.map((x) => x.id)).size, pw.length);
    const disciplines = new Set(pw.map((x) => C.powers.get(x.id)!.group));
    const n = r.log.find((l) => l.key === "hero/powers:count")!.total!;
    assert.ok(pw.length <= (disciplines.size > 1 ? n - 1 : n));
  }
});

test("pool picks exclude what the character has and respect filters", () => {
  for (let seed = 0; seed < 20; seed++) {
    const r = random(rec("hero", "fighter"), seed);
    const picked = r.record.choices["hero/any-talents"];
    assert.equal(picked.length, 2);
    for (const id of picked) assert.equal(C.talents.get(id)!.group, "General");
  }
});

// ---------------------------------------------------------------------------

test("overrides: stat, add, remove, alignment, forced choice; flagged", () => {
  const b = withHero({}, {}, [
    { op: "stat", stat: "WS", value: 99 },
    { op: "add", kind: "talent", id: "leader" },
    { op: "add", kind: "item", id: "laspistol", qty: 2 },
    { op: "remove", kind: "exotic", id: "spit-acid" },
    { op: "alignment", value: "Chaos" },
    { op: "choice", key: "hero/any-talents", value: ["mind-ward", "sense"] },
    { op: "choice", key: "hero/nowhere", value: ["x"] },
  ]);
  const ch = b.character;
  assert.equal(ch.stats.WS.modified, 71);
  assert.equal(ch.stats.WS.final, 99);
  assert.ok(ch.stats.WS.overridden);
  assert.deepEqual(ch.overridden.stats, ["WS"]);
  assert.ok(ch.talents.find((t) => t.id === "leader")!.overridden);
  assert.equal(ch.items.find((i) => i.id === "laspistol")!.qty, 3);
  assert.ok(!ch.exotics.some((e) => e.id === "spit-acid"));
  assert.deepEqual(ch.overridden.removed, [{ kind: "exotic", id: "spit-acid" }]);
  assert.equal(ch.alignment, "Chaos");
  assert.ok(ch.overridden.alignment);
  assert.ok(ids(ch.talents).includes("mind-ward") && ids(ch.talents).includes("sense"), "forced outside the filter");
  assert.deepEqual(ch.overridden.choices, ["hero/any-talents"]);
  assert.ok(b.log.find((l) => l.key === "hero/any-talents")!.forced);
  assert.ok(b.warnings.some((w) => w.includes("hero/nowhere")));
});

test("reroll clears a decision and what hangs off it", () => {
  const r = withHero({ "hero/scholar-sg-roll": [30] }, { "hero/type": ["scholar"], "hero/scholar-stat": ["scholar-sg"] }).record;
  assert.ok(r.dice["hero/scholar-sg-roll"]);
  const cleared = reroll(C, r, "hero/type");
  assert.ok(!("hero/type" in cleared.choices));
  assert.ok(!("hero/scholar-stat" in cleared.choices));
  assert.ok(!("hero/scholar-sg-roll" in cleared.dice));
  assert.deepEqual(cleared.dice["hero/@stats:WS"], r.dice["hero/@stats:WS"]);
  const boons = reroll(C, r, "hero/boons");
  assert.ok(!Object.keys(boons.dice).some((k) => k.startsWith("hero/boons")));
  const one = reroll(C, r, "hero/boons#2");
  assert.ok(!("hero/boons#2" in one.dice) && "hero/boons#1" in one.dice);
  const gear = reroll(C, r, "hero/gear#1");
  assert.ok(!("hero/gear#1:avail" in gear.dice) && !("hero/gear#1:item" in gear.choices));
  assert.ok(isUnder("a/b#1>t/x", "a/b#1") && isUnder("a/b:count", "a/b") && !isUnder("a/b#10", "a/b#1") && !isUnder("a/bc", "a/b"));
  assert.deepEqual(Object.keys(clearDecisions(r, ["hero/luck"]).dice).filter((k) => k.startsWith("hero/luck")), []);
  // the next build rolls them again (only them)
  const rebuilt = build(C, one, { mode: "random", roll: () => 7 });
  const fresh = rebuilt.log.filter((l) => !l.reused).map((l) => l.key);
  assert.ok(fresh.length > 0 && fresh.every((k) => isUnder(k, "hero/boons#2")), fresh.join(" "));
});

test("freeform: dice rolled, choices pending; pick() fills them", () => {
  const b = build(C, rec("hero", "fighter"), { mode: "freeform", roll: ones });
  const keys = b.pending.map((p) => p.key);
  for (const k of ["hero/type", "hero/any-talents", "hero/extra-exotic", "hero/alignment"]) assert.ok(keys.includes(k), k);
  assert.ok(b.record.dice["hero/@stats:WS"], "dice always rolled");
  assert.ok(!("hero/type" in b.record.choices));
  const type = b.pending.find((p) => p.key === "hero/type")!;
  assert.deepEqual(type.options, [{ id: "brute", label: "Brute" }, { id: "scholar", label: "Scholar" }]);
  assert.equal(type.count, 1);
  assert.equal(b.character.options.length, 0);
  // the user picks Scholar; its nested pick becomes pending
  const next = build(C, { ...b.record, choices: { ...b.record.choices, "hero/type": ["scholar"] } }, { mode: "freeform", roll: ones });
  assert.ok(next.pending.some((p) => p.key === "hero/scholar-stat" && p.parent === "hero/type"));
  // pick() answers choices in either mode
  const auto = build(C, rec("hero", "fighter"), {
    mode: "freeform",
    roll: ones,
    pick: (p) => (p.key === "hero/type" ? ["scholar"] : p.options.slice(0, p.count).map((o) => o.id)),
  });
  assert.deepEqual(auto.pending, []);
  assert.deepEqual(auto.record.choices["hero/type"], ["scholar"]);
  // an invalid stored choice is chosen again (random) with a warning
  const bad = withHero({}, { "hero/type": ["nope"] });
  assert.deepEqual(bad.record.choices["hero/type"], ["brute"]);
  assert.ok(bad.warnings.some((w) => w.includes("hero/type")));
});

test("stored dice that no longer fit are rolled again with a warning", () => {
  const b = withHero({ "hero/@stats:WS": [11, 1] }, {});
  assert.deepEqual(b.record.dice["hero/@stats:WS"], [1, 1]);
  assert.ok(b.warnings.some((w) => w.includes("hero/@stats:WS")));
});

test("diff: what the new rules change for a character", () => {
  const r = withHero({}, { "hero/alignment": ["Puritan"] }).record;
  const same = diff(C, C, r);
  assert.equal(same.changed, false);
  const c2 = clone(C);
  const hero = c2.archetypes.get("hero")!;
  hero.subtypes[0].stats.T = "60+2D10";
  const talents = hero.sections.find((s) => s.name === "Talents")!;
  talents.effects.push({ talent: "leader" }, { id: "luck2", chance: 50, then: [{ exotic: "fearsome" }] });
  hero.sections.find((s) => s.name === "Mutations")!.effects = [];
  hero.sections.find((s) => s.name === "Alignment")!.effects.unshift({ id: "faith", pick: 1, from: [{ id: "zealot", name: "Zealot" }, { id: "doubter", name: "Doubter" }] });
  const d = diff(C, c2, r);
  assert.ok(d.changed);
  assert.deepEqual(d.stats.find((s) => s.stat === "T"), { stat: "T", from: 53, to: 63 });
  assert.ok(d.stats.some((s) => s.stat === "S"), "no Extra Arm: S changes");
  assert.deepEqual(d.gained.map((g) => g.id), ["leader"]);
  assert.deepEqual(d.lost.map((g) => g.id), ["extra-arm"]);
  assert.deepEqual(d.needsRolling.map((n) => n.key), ["hero/luck2"]);
  assert.deepEqual(d.pending.map((p) => p.key), ["hero/faith"]);
  assert.deepEqual(d.dropped, ["extra-arm/arm-strength"]);
});

test("balance: power score, simulation, labels", () => {
  const b = withHero({}, {});
  const ch = b.character;
  const stats = Object.values(ch.stats).reduce((s, x) => s + x.final, 0);
  // dodge 10 (extra pack), spit-acid 5, extra-arm 3, frag-grenade 1 × 1
  assert.equal(powerScore(ch, C), stats + 10 + 5 + 3 + 1);
  const d1 = simulate(C, "hero", "fighter", 300, 7);
  const d2 = simulate(C, "hero", "fighter", 300, 7);
  assert.deepEqual(d1, d2);
  assert.equal(d1.n, 300);
  assert.ok(d1.sd > 0 && d1.min <= d1.median && d1.median <= d1.max && d1.p10 <= d1.p90);
  assert.deepEqual(label(d1.median, d1), { word: "balanced", sigma: 0 });
  assert.equal(label(d1.median + d1.sd, d1).word, "balanced");
  assert.equal(label(d1.median + d1.sd * 1.01, d1).word, "overpowered");
  assert.deepEqual(label(d1.median - 2.5 * d1.sd, d1), { word: "underpowered", sigma: -2.5 });
  assert.deepEqual(label(10, { median: 10, sd: 0 }), { word: "balanced", sigma: 0 });
});

// ---------------------------------------------------------------------------
// The extended vocabulary (docs/RULES-FORMAT.md), against the "vocab" pack.

const V = compendium(["base", "vocab"]);
const VP = ["base", "vocab"];
const vrec = (archetype: string, subtype: string, patch: Partial<CharacterRecord> = {}): CharacterRecord => ({
  ...newRecord(VP, archetype, subtype),
  ...patch,
});
const vbuild = (r: CharacterRecord, roll: (sides: number) => number = ones, mode: "random" | "freeform" = "random") =>
  build(V, r, { mode, roll });
const at = <T,>(xs: T[], f: (x: T) => boolean) => {
  const x = xs.find(f);
  assert.ok(x, "found");
  return x!;
};

test("vocab fixtures are valid rules", () => {
  assert.deepEqual(checkCompendium(V), []);
});

test("names: filters and restrictions match exactly; a name that matches nothing is reported", () => {
  const c = clone(V);
  const trader = c.archetypes.get("trader")!;
  const eq = trader.sections.find((s) => s.name === "Equipment")!.effects as Record<string, any>[];
  const anyArmour = eq.find((e) => e.id === "any-armour")!;
  const gear = eq.find((e) => e.id === "gear")!;
  // the exact group: Armour's Common pieces
  const pool = (cc: Compendium) =>
    at(build(cc, vrec("trader", "fighter"), { mode: "freeform", roll: ones }).pending, (x) => x.key === "trader/any-armour").options.map((o) => o.id);
  assert.deepEqual(pool(c), ["flak-armour", "light-shield"]);
  // a misspelling (or another spelling) matches nothing, and the check says so
  anyArmour.filter = { availability: ["Common"], group: ["Armor"] };
  gear.gear = { ...gear.gear, require: [["Grenades"]], exclude: ["armour"] };
  trader.sections[0].effects.push({ restrict: { pool: "item", category: ["Close Combat Weapons"], except: ["chaos"] } });
  const problems = checkCompendium(c);
  for (const m of [
    'filter group "Armor" matches no item group',
    `gear require "Grenades" matches no row of "equipment-generator"`,
    'gear exclude "armour" matches no item',
    'restrict category "Close Combat Weapons" matches no item category',
    'restrict except "chaos" matches no item',
  ]) {
    assert.ok(problems.some((p) => p.startsWith("archetype/trader") && p.endsWith(m)), m);
  }
  invalidate(c);
  const f = build(c, vrec("trader", "fighter"), { mode: "freeform", roll: ones });
  assert.ok(!f.pending.some((x) => x.key === "trader/any-armour" && x.options.length));
  // names are ids, groups, categories and the special "alien" exactly as the entries spell them
  anyArmour.filter = { group: ["Armour"], exclude: ["light-shield", "Armour"] };
  assert.ok(!checkCompendium(c).some((p) => p.includes("any-armour")));
  anyArmour.filter = { category: ["Armour"], exclude: ["flak-armour", "alien"] };
  assert.ok(pool(c).length > 0 && !pool(c).includes("flak-armour") && !pool(c).includes("light-shield"));
});

test("dice: a multiplied term (D6x10)", () => {
  const e = dice.parseDice("D6x10");
  assert.equal(dice.total(e, [3]), 30);
  assert.equal(dice.mean("D6x10"), 35);
  assert.equal(dice.min("D6x10"), 10);
  assert.equal(dice.max("D6x10+5"), 65);
  assert.ok(dice.isDice("2D6x10-D3"));
});

test("rules with apply: Creating A Character's boons roll for generator subtypes only", () => {
  const f = vbuild(vrec("tester", "fighter", { dice: { "creating/boons:count": [3] } }), seededRoller(4));
  const boons = f.character.rolls.filter((r) => r.table === "boons" && /^creating\/boons#\d+(~\d+)?$/.test(r.key));
  assert.equal(boons.length, 6, "D3+3 = 6");
  assert.equal(f.log.find((l) => l.key === "creating/boons:count")!.label, "Boons");
  // after the Talents row: Awareness (a profile talent) is a duplicate, re-rolled
  const dup = vbuild(vrec("tester", "fighter", { dice: { "creating/boons:count": [1], "creating/boons#1": [40], "creating/boons#1~2": [1] } }));
  assert.ok(dup.log.find((l) => l.key === "creating/boons#1")!.rerolled);
  assert.equal(dup.character.rolls.find((r) => r.key === "creating/boons#1~2")!.label, "+10 WS");
  // a Servitor rolls none
  const s = vbuild(vrec("tester", "servitor"));
  assert.ok(!s.character.rolls.some((r) => r.table === "boons"));
  assert.ok(!Object.keys(s.record.dice).some((k) => k.startsWith("creating/")));
  // stat boosts are cumulative: three +5 S
  const st = vbuild(vrec("tester", "fighter", { dice: { "creating/boons:count": [1], "creating/boons#1": [80], "creating/boons#2": [90], "creating/boons#3": [100], "creating/boons#4": [75] } }));
  assert.equal(st.character.stats.S.modified, 70 + 20);
});

test("boons: duplicates re-rolled in rolls nested under the boons roll; roll again or an expansion talent", () => {
  // fearsome first, then the exotic table gives it again: re-rolled to Spit Acid
  const b = vbuild(
    vrec("tester", "fighter", {
      dice: {
        "creating/boons:count": [1],
        "creating/boons#1": [60],
        "creating/boons#1>boons/exotic": [1],
        "creating/boons#2": [60],
        "creating/boons#2>boons/exotic": [2],
        "creating/boons#2>boons/exotic~2": [5],
        "creating/boons#3": [1],
        "creating/boons#4": [1],
      },
    }),
  );
  assert.ok(b.log.find((l) => l.key === "creating/boons#2>boons/exotic")!.rerolled);
  assert.deepEqual(ids(b.character.exotics).filter((x) => x === "fearsome" || x === "spit-acid"), ["fearsome", "spit-acid"]);
  // psyker: "Roll again on Fighter table" offers the roll or an expansion talent (not one it has)
  const r = vrec("trader", "psyker", { dice: { "creating/boons:count": [1], "creating/boons#1": [80] } });
  const p = build(V, r, { mode: "freeform", roll: ones });
  const again = at(p.pending, (x) => x.key === "creating/boons#1>boons/again-fighter");
  assert.deepEqual(again.options.map((o) => o.id), ["roll-again-fighter", "expansion-talent-fighter"]);
  const exp = build(V, { ...p.record, choices: { ...p.record.choices, "creating/boons#1>boons/again-fighter": ["expansion-talent-fighter"] } }, { mode: "freeform", roll: ones });
  const talents = at(exp.pending, (x) => x.key === "creating/boons#1>boons/expansion-talent-fighter");
  assert.ok(talents.options.every((o) => o.id !== "talent:awareness"));
  assert.deepEqual(talents.options.map((o) => o.id), ["talent:hunter", "talent:leader", "talent:quick-draw"]);
});

test("armour: best piece per location, extra AV on top, force fields, chosen locations, as", () => {
  const b = vbuild(vrec("tester", "servitor", { dice: { "hide/av": [2] }, choices: { "light-shield/cover": ["Left Arm", "Head"] } }));
  const a = b.character.armour;
  // flak 3 everywhere, breastplate 5 on chest/abdomen, shield 2 (less), hide +3
  assert.deepEqual([a.Head.av, a.Chest.av, a.Abdomen.av, a["Left Leg"].av], [6, 8, 8, 6]);
  assert.deepEqual(a.Chest.from, ["breastplate", "hide", "refractor"]);
  assert.deepEqual(a.Head.fields, ["D10"]);
  assert.deepEqual(at(b.character.items, (i) => i.id === "light-shield").variants, [["Head", "Left Arm"]]);
  const p = at(b.character.armourPieces, (x) => x.source === "light-shield");
  assert.deepEqual(p.locations, ["Head", "Left Arm"]);
  assert.equal(at(b.character.armourPieces, (x) => x.source === "hide").add, 3);
  // as: Daemonic Armour counts as Power Armour with +3
  const d = vbuild(vrec("tester", "servitor", { overrides: [{ op: "add", kind: "item", id: "daemonic-armour" }] }));
  assert.ok(!d.character.armourPieces.some((x) => x.source === "daemonic-armour"), "an override doesn't run the item's effects");
  const c2 = clone(V);
  c2.archetypes.get("tester")!.sections[0].effects.push({ item: "daemonic-armour" });
  invalidate(c2);
  const dd = build(c2, vrec("tester", "servitor", { dice: { "hide/av": [2] } }), { mode: "random", roll: ones });
  assert.equal(dd.character.armour.Head.av, 13 + 3);
  // an armour item taken away by an override takes its armour with it
  const gone = vbuild(vrec("tester", "servitor", { dice: { "hide/av": [2] }, overrides: [{ op: "remove", kind: "item", id: "breastplate" }] }));
  assert.equal(gone.character.armour.Chest.av, 6);
});

test("restrict: late restrictions rerun the build; pools, gear and table rows skip what's refused", () => {
  for (let seed = 0; seed < 25; seed++) {
    const b = vbuild(vrec("restricted", "fighter"), seededRoller(seed));
    const items = ids(b.character.items);
    assert.ok(!items.includes("breastplate") && !items.includes("power-armour"), `seed ${seed}: armour over AV 3`);
    assert.ok(!items.includes("bolter"), "bolt weapons other than the maul");
    assert.ok(!b.character.talents.some((t) => t.id !== "natural-psyker" && C.talents.get(t.id)?.group === "Psyker Talents"), "exclusive");
    if (b.character.alignment === "Puritan") assert.ok(!items.includes("daemonic-armour"));
    const again = build(V, b.record, { mode: "random", roll: noRolls });
    assert.deepEqual(again.character, b.character, `seed ${seed} replays`);
  }
  const p = build(V, vrec("restricted", "fighter", { choices: { "restricted/alignment": ["Puritan"] } }), { mode: "freeform", roll: ones });
  assert.deepEqual(at(p.pending, (x) => x.key === "restricted/armour").options.map((o) => o.id), ["flak-armour", "light-shield"]);
  assert.deepEqual(at(p.pending, (x) => x.key === "restricted/weapon").options.map((o) => o.id), ["holy-blade", "maul"]);
  assert.deepEqual(at(p.pending, (x) => x.key === "restricted/any-pistol").options.map((o) => o.id), ["autopistol", "digital-weapons", "needle-pistol", "needler", "plasma-pistol"]);
  assert.ok(!p.pending.some((x) => x.key === "restricted/psy"), "nothing left to pick");
  // the armour table re-rolls Power Armour
  const t = vbuild(vrec("restricted", "fighter", { dice: { "restricted/armour-roll": [5], "restricted/armour-roll~2": [1] } }));
  assert.ok(t.log.find((l) => l.key === "restricted/armour-roll")!.rerolled);
  assert.ok(t.character.rolls.some((r) => r.table === "armour-types" && r.label === "Flak Armour"));
  assert.equal(t.character.restrictions.length, 4);
  // an override breaking a restriction is flagged
  const o = vbuild(vrec("restricted", "fighter", { overrides: [{ op: "add", kind: "item", id: "power-armour" }] }));
  assert.ok(at(o.character.items, (i) => i.id === "power-armour").restricted);
  assert.ok(o.warnings.some((w) => w.includes("power-armour")));
});

test("availabilityWhen and requires", () => {
  const pr = build(V, vrec("priest", "fighter"), { mode: "freeform", roll: ones });
  const la = build(V, vrec("layman", "fighter"), { mode: "freeform", roll: ones });
  const opts = (b: BuildResult, k: string) => at(b.pending, (x) => x.key === k).options.map((o) => o.id);
  assert.deepEqual(opts(pr, "priest/blade"), ["holy-blade", "maul", "relic-hammer"]);
  assert.deepEqual(la.record.choices["layman/blade"], ["maul"], "the only Rare melee weapon a layman can have");
  const own = vbuild(vrec("priest", "fighter", { choices: { "priest/blade": ["holy-blade"] } }));
  assert.equal(own.character.items[0].availability, "Rare");
});

test("derived values, attributes, stat formulas and multiplies", () => {
  const b = vbuild(vrec("tester", "servitor"));
  const d = b.character.derived;
  // T 50: BIV 5 +1 (Scales); SS counts T as 70: 14
  assert.deepEqual([d.BIV.base, d.BIV.value, d.SS.value, d.Cnc.value, d.Kbk.value, d.Spd.value], [5, 6, 14, 25, 7, 4]);
  const t = vbuild(vrec("trader", "fighter", { dice: { "curse/bulk": [3] } }));
  const td = t.character.derived;
  assert.deepEqual([td.Spd.value, td.BIV.value, td.SS.value, td.Cnc.value], [3, 7, "No", "No"]);
  assert.equal(t.character.stats.T.final, 80, "D6x10");
  // Bigga Is Betta: Ld + [S/10] with S worked out first
  const s = t.character.stats.S.final;
  assert.equal(t.character.stats.Ld.final, 50 + Math.floor(s / 10 + 0.5));
  assert.deepEqual(t.character.attributes, [
    { name: "Warp Strength", value: -50, source: "trader" },
    { name: "Encumbrance Limit", value: s + 50, source: "trader" },
  ]);
  // Power Armour: S × 1.2 at the end (after the human cap)
  const c2 = clone(V);
  c2.archetypes.get("tester")!.sections[0].effects.push({ item: "power-armour" });
  invalidate(c2);
  const pa = build(c2, vrec("tester", "servitor", { overrides: [] }), { mode: "random", roll: ones });
  assert.equal(pa.character.stats.S.modified, 84);
  assert.deepEqual(pa.character.stats.S.mods.at(-1), { multiply: 1.2, source: "power-armour" });
  assert.equal(pa.character.derived.Kbk.value, 8);
  // an overridden stat feeds the derived values
  const ov = vbuild(vrec("tester", "servitor", { overrides: [{ op: "stat", stat: "T", value: 80 }] }));
  assert.equal(ov.character.derived.BIV.value, 9);
});

test("item behaviour: wielded, remove, profileWhen, alterations, reloads", () => {
  const b = vbuild(vrec("tester", "servitor"));
  const ch = b.character;
  assert.deepEqual(ch.wielded, [{ source: "axe-of-rage", name: "Axe of Rage", effects: ["Hunter", "-20 Wp"] }]);
  assert.ok(!ids(ch.talents).includes("hunter") && ch.stats.Wp.final === 50, "not applied");
  // S 70 < 75: the maul's damage drops
  assert.equal(at(ch.items, (i) => i.id === "maul").profile!.Damage, "D10");
  const strong = vbuild(vrec("tester", "servitor", { overrides: [{ op: "stat", stat: "S", value: 80 }] }));
  assert.equal(at(strong.character.items, (i) => i.id === "maul").profile, undefined);
  assert.equal(at(ch.items, (i) => i.id === "laspistol").availability, "Rare", "Master-crafted: a step up");
  const bolter = at(ch.items, (i) => i.id === "bolter");
  assert.ok(bolter.implanted && bolter.reloads === 4);
  assert.deepEqual(ch.reloads, { add: 2, multiply: 1 });
  const t = vbuild(vrec("trader", "fighter"));
  assert.deepEqual(t.character.taken, [{ kind: "talent", id: "awareness", name: "Awareness", by: "disruptor" }]);
  assert.ok(!ids(t.character.talents).includes("awareness"));
});

test("grants: set answers the entry's own decisions; again runs them once more; picks into an item", () => {
  const b = vbuild(vrec("tester", "servitor"));
  const organs = at(b.character.items, (i) => i.id === "organs");
  assert.equal(organs.qty, 2);
  assert.deepEqual(organs.variants, [["Advanced", "Heart"], ["Advanced", "Lungs"]]);
  assert.ok(!Object.keys(b.record.dice).some((k) => k.startsWith("organs/")), "the organ isn't rolled");
  // Word of the Emperor twice: the second prayer is another one
  const wote = at(b.character.exotics, (e) => e.id === "prayer");
  assert.deepEqual(wote.variants, [["Curse Of Undoing"], ["Litany Of Spite"]]);
  const p = build(V, vrec("tester", "servitor", { choices: { "prayer/prayer": ["stunning-sermon"] } }), { mode: "freeform", roll: ones });
  assert.deepEqual(at(p.pending, (x) => x.key === "prayer/prayer*2").options.map((o) => o.id), ["curse-of-undoing", "litany-of-spite"]);
  // into: the needler's toxin and Study Thy Weapon's weapon go onto them
  const needler = at(b.character.items, (i) => i.id === "needler");
  assert.deepEqual(needler.chosen, [{ key: "needler/toxin", kind: "item", id: "venom-a", name: "Venom A" }]);
  assert.ok(!ids(b.character.items).includes("venom-a"));
  const study = at(b.character.talents, (t) => t.id === "study");
  assert.deepEqual(study.chosen!.map((x) => x.id), ["axe-of-rage"]);
  const sp = build(V, vrec("tester", "servitor"), { mode: "freeform", roll: ones });
  assert.deepEqual(at(sp.pending, (x) => x.key === "study/weapon").options.map((o) => o.id), ["axe-of-rage", "bolter", "maul", "needler"]);
});

test("picks: filters (category, tag, exclude, owned), qty, implanted, open counts", () => {
  const b = vbuild(vrec("trader", "fighter", { choices: { "trader/implant": ["needler"] } }));
  const n = at(b.character.items, (i) => i.id === "needler");
  assert.ok(n.implanted);
  assert.equal(n.qty, 2);
  // pick: { max: 2 } → random takes D3-1; any → none in random mode
  const r = vbuild(vrec("trader", "fighter", { dice: { "trader/up-to-two:count": [3] } }));
  assert.equal(r.record.choices["trader/up-to-two"].length, 2);
  assert.deepEqual(r.record.choices["trader/any-armour"], []);
  const f = build(V, vrec("trader", "fighter"), { mode: "freeform", roll: ones });
  const any = at(f.pending, (x) => x.key === "trader/any-armour");
  assert.equal(any.min, 0);
  assert.deepEqual(any.options.map((o) => o.id), ["flak-armour", "light-shield"]);
  assert.equal(any.count, 2);
  const upto = at(f.pending, (x) => x.key === "trader/up-to-two");
  assert.deepEqual([upto.min, upto.count], [0, 2]);
  // any number fits, and replays
  const chosen = build(V, { ...f.record, choices: { ...f.record.choices, "trader/any-armour": ["flak-armour", "light-shield"], "trader/up-to-two": [] } }, { mode: "freeform", roll: ones });
  assert.ok(!chosen.pending.some((x) => x.key === "trader/any-armour" || x.key === "trader/up-to-two"));
  assert.ok(ids(chosen.character.items).includes("light-shield"));
});

test("roll mechanics: chance on a die, roll qty, rerollUnless, row qty by availability, gear require, downgrade only", () => {
  const b = vbuild(
    vrec("trader", "fighter", {
      dice: {
        "trader/lucky": [6],
        "trader/stimm:qty": [7],
        "trader/stimm": [2], // Crash: Injector only → re-rolled
        "trader/stimm~2": [5],
        "trader/gear#1": [1], // Armour
        "trader/gear#1:avail": [1],
        "trader/gear#2": [41], // Pistol
        "trader/gear#2:avail": [1],
        "trader/gear#3": [45], // Pistol: the last slot must be a Grenade → re-rolled
        "trader/gear#3~2": [80],
        "trader/gear#3~2:avail": [1],
        "trader/gear#3~2:qty": [3],
        "trader/downgraded#1": [41], // Pistol, Rare → Common
        "trader/downgraded#1:avail": [4],
        "trader/downgraded#2": [1], // Armour, Rare: not downgraded
        "trader/downgraded#2:avail": [4],
      },
      choices: { "trader/gear#3~2:item": ["frag-grenade"], "trader/implant": ["laspistol"] },
    }),
  );
  const ch = b.character;
  assert.ok(ids(ch.items).includes("needler"), "a 6 on the D6");
  assert.ok(b.log.find((l) => l.key === "trader/stimm")!.rerolled);
  assert.equal(at(ch.items, (i) => i.id === "barrage").qty, 7);
  assert.ok(b.log.find((l) => l.key === "trader/gear#3")!.rerolled);
  assert.equal(at(ch.items, (i) => i.id === "frag-grenade").qty, 3, "D3 of a Common grenade");
  const dg = ch.rolls.filter((r) => r.key.startsWith("trader/downgraded"));
  assert.deepEqual(dg.map((r) => r.availability), ["Common", "Rare"]);
});

test("trade: downgrade gear for a pick, lose things, upgrade; random mode never trades", () => {
  const dice0 = {
    "trader/gear#1": [1], "trader/gear#1:avail": [4], // Rare Armour
    "trader/gear#2": [41], "trader/gear#2:avail": [1], // Common Pistol
    "trader/gear#3": [80], "trader/gear#3:avail": [4], // Rare Grenade
    "trader/downgraded#1": [41], "trader/downgraded#1:avail": [1], // Common Pistol, downgraded: lost
    "trader/downgraded#2": [41], "trader/downgraded#2:avail": [1],
  };
  const none = vbuild(vrec("trader", "fighter", { dice: dice0 }));
  for (const k of ["trader/rare-weapon#1", "trader/better#1", "trader/swap#1"]) assert.deepEqual(none.record.choices[k], ["no"]);
  const t = vbuild(
    vrec("trader", "fighter", {
      dice: dice0,
      choices: {
        "trader/gear#1:item": ["breastplate"],
        "trader/rare-weapon#1": ["yes"],
        "trader/rare-weapon#1:give": ["trader/gear#1"], // Rare Armour → Common
        "trader/rare-weapon#1:give>trader/gear#1:item": ["flak-armour"],
        "trader/rare-weapon#1>trader/weapon": ["maul"],
        "trader/better#1": ["yes"],
        "trader/better#1:give": ["trader/gear#2", "trader/gear#3"], // Common Pistol lost; Rare Grenade → Common
        "trader/better#1:give>trader/gear#3:item": ["frag-grenade"],
        "trader/better#1>trader/up": ["trader/gear#1"], // Common Armour → Rare again
        "trader/better#1>trader/up>trader/gear#1:item": ["breastplate"],
        "trader/swap#1": ["yes"],
        "trader/swap#1:give": ["item:frag-grenade"],
        "trader/swap#2": ["no"],
      },
    }),
  );
  const ch = t.character;
  assert.ok(ids(ch.items).includes("maul") && ids(ch.items).includes("breastplate") && ids(ch.items).includes("refractor"));
  assert.ok(!ids(ch.items).includes("flak-armour"), "downgraded, then upgraded again");
  assert.ok(!ids(ch.items).includes("frag-grenade"), "given up for the Refractor Field");
  const r = (k: string) => at(ch.rolls, (x) => x.key === k);
  assert.ok(r("trader/gear#2").lost);
  assert.equal(r("trader/gear#1").availability, "Rare");
  assert.equal(r("trader/gear#3").availability, "Common");
  // the trade is pending in freeform mode, with what it gives
  const f = build(V, vrec("trader", "fighter", { dice: dice0 }), { mode: "freeform", roll: ones });
  const tr = at(f.pending, (x) => x.key === "trader/swap#1");
  assert.equal(tr.kind, "trade");
  assert.deepEqual(tr.options, [{ id: "yes", label: "Refractor Field" }, { id: "no", label: "" }]);
  // replays exactly
  assert.deepEqual(build(V, t.record, { mode: "random", roll: noRolls }).character, ch);
});

test("bionics: quality and upgrade chance; gear-generated bionics each roll their own", () => {
  const b = vbuild(
    vrec("trader", "fighter", {
      dice: {
        "trader/bionics#1:upgrade": [50], "trader/bionics#1": [5], "trader/bionics#1>organs/organ": [3],
        "trader/bionics#2:upgrade": [51], "trader/bionics#2": [1],
      },
    }),
  );
  const organs = at(b.character.items, (i) => i.id === "organs");
  assert.deepEqual(organs.variants, [["Average", "Heart"]]);
  assert.deepEqual(at(b.character.items, (i) => i.id === "bionic-arm").variants, [["Crude"]]);
  const quality = b.log.find((l) => l.key === "trader/bionics#1>organs/quality")!;
  assert.deepEqual(quality.result, ["Average"]);
  // generated bionics: the quality of the rolled availability (Rare → Average)
  const g = vbuild(vrec("trader", "psyker", { dice: { "trader/gear#1": [70], "trader/gear#1:avail": [4], "trader/gear#1>equipment-generator/bionic": [5], "trader/gear#1>equipment-generator/bionic>organs/organ": [1] } }));
  assert.deepEqual(at(g.character.items, (i) => i.id === "organs").variants![0], ["Average", "Lungs"]);
  // otherwise a quality "you can generate": this gear offers only Common and Rare
  const c2 = clone(V);
  c2.archetypes.get("tester")!.sections[0].effects.push({ id: "gear", gear: { count: 1, availability: ["Common", "Rare"] } }, { item: "organs" });
  invalidate(c2);
  const q = build(c2, vrec("tester", "servitor", { dice: { "tester/gear#1": [1], "tester/gear#1:avail": [1] } }), { mode: "freeform", roll: ones });
  assert.deepEqual(at(q.pending, (x) => x.key === "organs/quality*3").options.map((o) => o.id), ["crude", "average"]);
});

test("powers: formula difficulties count as within maxDifficulty; access; psyker; companions; locations", () => {
  const f = build(V, vrec("trader", "fighter", { choices: { "trader/up-to-two": [] } }), { mode: "freeform", roll: ones });
  assert.deepEqual(at(f.pending, (x) => x.key === "trader/powers#1").options.map((o) => o.id), ["choke", "mind-scan"]);
  assert.deepEqual(at(f.pending, (x) => x.key === "archeotech/power").options.map((o) => o.id), ["bolt", "choke", "hellfire", "lift", "mind-scan", "push"]);
  assert.deepEqual(f.record.choices["trader/marine"], ["marine-might"], "Strong opens Marine Talents");
  const g = build(V, vrec("trader", "fighter"), { mode: "freeform", roll: ones });
  assert.ok(at(g.pending, (x) => x.key === "trader/up-to-two").options.some((o) => o.id === "marine-might"), "in every talent pool");
  const b = vbuild(vrec("trader", "fighter", { choices: { "curse/hand": ["Right Arm"] } }));
  assert.ok(b.character.psyker);
  assert.deepEqual(b.character.companions, [{ archetype: "tester", subtype: "servitor", source: "trader" }]);
  assert.deepEqual(b.character.locations, [{ source: "curse", location: "Right Arm" }, { source: "curse", location: "Arm" }]);
  assert.deepEqual(at(b.character.mutations, (m) => m.id === "curse").variants, [["Right Arm"]]);
  assert.ok(!vbuild(vrec("tester", "servitor")).character.psyker);
  assert.ok(difficultyWithin("TT/2", 10) && difficultyWithin("8", 10) && !difficultyWithin("12", 10) && !difficultyWithin(undefined, 10));
});

test("subtypeDie: a rolled subtype; warband rules", () => {
  const arch = V.archetypes.get("bounty")!;
  const r = rollSubtype(arch, () => 5);
  assert.equal(r.subtype!.id, "tracker");
  assert.deepEqual([r.key, r.faces], ["bounty/@subtype", [5]]);
  const ok = vbuild(vrec("bounty", "tracker", { dice: { [r.key]: r.faces } }), noRolls);
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual(ok.record.dice[r.key], [5]);
  const bad = vbuild(vrec("bounty", "rookie", { dice: { [r.key]: r.faces } }), noRolls);
  assert.ok(bad.warnings.some((w) => w.includes("bounty/@subtype")));
  assert.deepEqual(warbandWarnings(V, [{ archetype: "tester" }, { archetype: "trader" }]), []);
  assert.deepEqual(warbandWarnings(V, [{ archetype: "tester" }, { archetype: "tester" }]), [
    { source: "warband-rules", max: 1, archetype: ["tester"], count: 2 },
  ]);
});

test("rolled condition: a rule after Equipment sees the armour table", () => {
  const b = vbuild(vrec("restricted", "fighter"));
  assert.ok(notes(b).includes("Rolled armour."));
  assert.ok(!notes(vbuild(vrec("tester", "servitor"))).includes("Rolled armour."));
});

test("the GM sheet: armour row, firearms, melee, other equipment, starting row", () => {
  const b = vbuild(vrec("tester", "servitor", { name: "Ix", dice: { "hide/av": [2] }, choices: { "light-shield/cover": ["Left Arm", "Head"] } }));
  const s = sheetCharacter(b.character, V);
  assert.equal(s.name, "Ix");
  assert.equal(s.tagLine, "Testers, Servitor, Puritan");
  assert.deepEqual(s.armour, { Head: "6+D10", Chest: "8+D10", Abdmn: "8+D10", Groin: "6+D10", "L. Arm": "6+D10", "R. Arm": "6+D10", "L. Leg": "6+D10", "R. Leg": "6+D10" });
  assert.deepEqual(s.starting, { WS: "50", BS: "50", S: "70", T: "50", I: "50", Wp: "50", Sg: "50", Nv: "50", Ld: "50", Kbk: "7", BIV: "6", SS: "14", Cnc: "25", Spd: "4" });
  assert.deepEqual(s.firearms.map((f) => f.name), ["Needler (Venom A)", "Bolter"]);
  assert.deepEqual(s.firearms[0], {
    name: "Needler (Venom A)", type: "Pistol", rng: "C", mode: "Single / Semi 2", acc: "-", damage: "D3", shots: "6", rld: "1", enc: "5", reloads: "2", special: "Carries a toxin.",
  });
  assert.equal(s.firearms[1].reloads, "6");
  assert.deepEqual(s.melee, [
    { name: "Power Maul", rch: "2", dam: "D10", pp: "-10", special: "" },
    { name: "Axe of Rage", rch: "3", dam: "2D10", pp: "-20", special: "Hunter; -20 Wp" },
    { name: "Barbed Tail", rch: "4", dam: "D6+3", pp: "", special: "" },
  ]);
  assert.deepEqual(s.other, ["Flak Armour", "Breastplate", "Light Shield (Head, Left Arm)", "Refractor Field", "Bionic Organs (Advanced, Heart; Advanced, Lungs) ×2", "Laspistol"]);
  assert.deepEqual(at(s.abilities, (a) => a.name.startsWith("Word of the Emperor")), {
    name: "Word of the Emperor (Curse Of Undoing; Litany Of Spite)",
    effect: "Choose one of the following prayers.",
  });
  assert.equal(armourCell({ av: 0, fields: [], from: [] }), "");
});

test("vocab: determinism across archetypes", () => {
  for (const [a, s] of [["tester", "fighter"], ["tester", "psyker"], ["restricted", "fighter"], ["trader", "fighter"], ["trader", "psyker"], ["priest", "fighter"]]) {
    for (const seed of [1, 2, 3]) {
      const first = vbuild(vrec(a, s), seededRoller(seed));
      const again = build(V, first.record, { mode: "random", roll: noRolls });
      assert.deepEqual(again.character, first.character, `${a}/${s} seed ${seed}`);
      assert.deepEqual(again.record, first.record);
    }
  }
});

test("armour from an archetype stays when an item has the same id", () => {
  const c2 = clone(V);
  const layman = structuredClone(c2.archetypes.get("layman")!);
  layman.id = "breastplate";
  layman.sections[0].effects = [{ armour: { av: 4, locations: "Head" } }];
  c2.archetypes.set("breastplate", layman);
  invalidate(c2);
  const b = build(c2, newRecord(VP, "breastplate", "fighter"), { mode: "random", roll: ones });
  assert.equal(b.character.armour.Head.av, 4);
});

test("a restriction met inside an option keeps the build's odds and replays exactly", () => {
  const c2 = clone(V);
  const arch = structuredClone(c2.archetypes.get("layman")!);
  arch.id = "roles";
  arch.sections = [
    { name: "Equipment", effects: [{ id: "blade", pick: 1, pool: "item", filter: { group: ["Melee Weapons"] } }] },
    {
      name: "Role",
      effects: [
        {
          id: "role",
          pick: 1,
          from: [
            { id: "zealot", name: "Zealot", effects: [{ restrict: { pool: "item", group: ["Melee Weapons"], only: ["maul"] } }] },
            { id: "other", name: "Other", effects: [] },
          ],
        },
      ],
    },
  ];
  c2.archetypes.set("roles", arch);
  invalidate(c2);
  let zealots = 0;
  const N = 200;
  for (let seed = 0; seed < N; seed++) {
    const b = build(c2, newRecord(VP, "roles", "fighter"), { mode: "random", roll: seededRoller(seed) });
    const zealot = b.character.options.some((o) => o.id === "zealot");
    if (zealot) zealots++;
    assert.equal(b.character.restrictions.length > 0, zealot, `seed ${seed}: restrictions only from the final pass`);
    if (zealot) assert.deepEqual(ids(b.character.items), ["maul"]);
    const again = build(c2, b.record, { mode: "random", roll: noRolls });
    assert.deepEqual(again.character, b.character, `seed ${seed}`);
  }
  assert.ok(zealots > N * 0.4 && zealots < N * 0.6, `Zealot ${zealots} of ${N}`);
});

test("packs: a pack stacks after the packs it extends, whatever the given order", () => {
  const talent = (name: string) => ({ id: "t", kind: "talent", name, source: { page: 1 } }) as never;
  const c = buildCompendium([
    { pack: { id: "article", name: "Article", extends: ["book"] }, entries: [talent("Article's")] },
    { pack: { id: "book", name: "Book" }, entries: [talent("Book's")] },
  ]);
  assert.deepEqual(c.packs.map((p) => p.id), ["book", "article"]);
  assert.equal(c.talents.get("t")?.name, "Article's");
  assert.equal(c.origin.get("talent/t"), "article");
});
