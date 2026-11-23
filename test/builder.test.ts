// The builder's pure parts: the sheet mapping (src/shared/sheet-map.ts) and
// the record edits (src/client/builder/ops.ts), against the fixture packs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadPack } from "../src/lib/rules-files.ts";
import { buildCompendium, type Compendium } from "../src/shared/rules/compendium.ts";
import type { Item } from "../src/shared/rules/schema.ts";
import { build } from "../src/shared/engine/build.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import { sheetItemKind, sheetParts, toSheetCharacter, firearmRow, meleeRow, abilityOf } from "../src/shared/sheet-map.ts";
import * as ops from "../src/client/builder/ops.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const C: Compendium = buildCompendium(
  ["base", "extra"].map((id) => {
    const { pack } = loadPack(id, FIXTURES);
    return pack!;
  }),
);
const noRolls = () => {
  throw new Error("rolled a die the record should have had");
};

const item = (x: Partial<Item> & { id: string; name: string }): Item => ({ kind: "item", group: "Ranged Weapons", source: { page: 1 }, ...x }) as Item;

test("sheet-map: items go by profile", () => {
  assert.equal(sheetItemKind(item({ id: "a", name: "A", profile: { Type: "Pistol", Rng: "J", Dam: "2D6" } })), "firearm");
  assert.equal(sheetItemKind(item({ id: "g", name: "G", profile: { Type: "Grenade", Range: "E", Dam: "2D6" } })), "firearm");
  assert.equal(sheetItemKind(item({ id: "m", name: "M", profile: { Reach: "2", Damage: "D10" } })), "melee");
  assert.equal(sheetItemKind(item({ id: "o", name: "O" })), "other");
  assert.equal(sheetItemKind(undefined), "other");
});

test("sheet-map: rows and abilities", () => {
  const bolt = item({
    id: "bolt-pistol",
    name: "Bolt Pistol",
    profile: { Type: "Pistol", Rng: "J", Mode: "Single\nSemi 2", Acc: "-", Dam: "2D10+4", Shots: "12", Rld: "2", Wt: "25" },
    text: "Loud",
  });
  assert.deepEqual(firearmRow(bolt, 2), {
    name: "Bolt Pistol ×2", type: "Pistol", rng: "J", mode: "Single / Semi 2", acc: "-", damage: "2D10+4",
    shots: "12", rld: "2", enc: "25", reloads: "", special: "Loud",
  });
  const frag = item({ id: "frag", name: "Frag", profile: { Type: "Grenade", Range: "E", Area: "3", Dam: "2D6", Weight: "5" } });
  assert.equal(firearmRow(frag).special, "Area: 3");
  assert.equal(firearmRow(frag).rng, "E");
  const sword = item({ id: "s", name: "Sword", profile: { Reach: "2", Damage: "D10+1", "Parry Penalty": "-10" } });
  assert.deepEqual(meleeRow(sword), { name: "Sword", rch: "2", dam: "D10+1", pp: "-10", special: "" });
  assert.deepEqual(abilityOf("Dodge", "Can dodge"), { name: "Dodge", effect: "Can dodge." });
  assert.deepEqual(abilityOf("Odd", "Range 10”; Damage (2D6.)"), { name: "Odd", effect: "Range 10”; Damage (2D6.)" });
  assert.deepEqual(abilityOf("Bare", undefined), { name: "Bare", effect: "" });
});

test("sheet-map: a built character fills the sheet", () => {
  const r = ops.create(C, "hero", "fighter", "random", { name: "Vex", roll: seededRoller(3) });
  const { character } = build(C, r, { mode: "freeform", roll: noRolls });
  const { sheet, refs } = sheetParts(character, C);
  assert.equal(sheet.name, "Vex");
  assert.ok(sheet.tagLine.startsWith(`${character.archetype.name}, Fighter`));
  if (character.alignment) assert.ok(sheet.tagLine.endsWith(character.alignment));
  assert.equal(sheet.starting.WS, String(character.stats.WS.final));
  assert.equal(sheet.starting.Kbk, String(Math.floor(character.stats.S.final / 10 + 0.5)));
  const abilities = character.talents.length + character.exotics.length + character.mutations.length + character.powers.length;
  assert.equal(sheet.abilities.length, abilities);
  assert.equal(refs.abilities.length, abilities);
  assert.equal(sheet.firearms.length + sheet.melee.length + sheet.other.length, character.items.length);
  assert.deepEqual(toSheetCharacter(character, C), sheet);
});

test("ops: random builds complete, freeform leaves choices open", () => {
  const r = ops.create(C, "hero", "fighter", "random", { version: "v1", roll: seededRoller(1) });
  assert.equal(r.rulesVersion, "v1");
  assert.equal(ops.view(C, r).pending.length, 0);
  // Rebuilding a stored record rolls nothing.
  build(C, r, { mode: "freeform", roll: noRolls });
  const f = ops.create(C, "hero", "fighter", "freeform", { roll: seededRoller(1) });
  const pending = ops.view(C, f).pending;
  assert.ok(pending.length > 0);
  const p = pending[0];
  const chosen = ops.choose(C, f, p.key, ops.randomPick(p, seededRoller(2)));
  assert.ok(!ops.view(C, chosen).pending.some((x) => x.key === p.key));
  const filled = ops.fillPending(C, f, { roll: seededRoller(4) });
  assert.equal(ops.view(C, filled).pending.length, 0);
  // Only some keys: the others stay open.
  const some = ops.fillPending(C, f, { keys: [p.key], roll: seededRoller(4) });
  const left = ops.view(C, some).pending.map((x) => x.key);
  assert.ok(!left.includes(p.key));
  for (const x of pending.slice(1)) if (!x.parent) assert.ok(left.includes(x.key), x.key);
});

test("ops: re-roll keeps everything else and leaves no open choice on a random character", () => {
  const r = ops.create(C, "hero", "fighter", "random", { roll: seededRoller(5) });
  const key = "hero/@stats:WS";
  const again = ops.rerollDecision(C, r, key, { roll: () => 1 });
  assert.deepEqual(again.dice[key], [1, 1]);
  assert.deepEqual(again.dice["hero/@stats:BS"], r.dice["hero/@stats:BS"]);
  const type = Object.keys(r.choices).find((k) => k === "hero/type")!;
  const re = ops.rerollDecision(C, r, type, { roll: seededRoller(9) });
  assert.equal(ops.view(C, re).pending.length, 0);
  const opts = ops.choiceOptions(C, r, type);
  assert.ok(opts && opts.options.length >= 2);
  assert.deepEqual(opts.chosen, r.choices[type]);
});

test("ops: overrides", () => {
  const r = ops.create(C, "hero", "fighter", "random", { roll: seededRoller(6) });
  const s = ops.setStat(C, r, "WS", 99);
  assert.equal(ops.view(C, s).character.stats.WS.final, 99);
  assert.ok(ops.view(C, s).character.stats.WS.overridden);
  assert.deepEqual(ops.setStat(C, s, "WS", null).overrides, []);
  // Setting the rules' own value is no override.
  assert.deepEqual(ops.setStat(C, r, "WS", ops.view(C, r).character.stats.WS.final).overrides, []);

  const added = ops.addThing(r, "talent", "dodge");
  assert.ok(ops.view(C, added).character.talents.some((t) => t.id === "dodge" && t.overridden));
  assert.deepEqual(ops.removeThing(added, "talent", "dodge").overrides, []);
  const owned = ops.view(C, r).character.talents[0];
  if (owned) {
    const gone = ops.removeThing(r, "talent", owned.id);
    assert.ok(!ops.view(C, gone).character.talents.some((t) => t.id === owned.id));
    assert.deepEqual(ops.addThing(gone, "talent", owned.id).overrides, []);
  }
  const two = ops.addThing(ops.addThing(r, "item", "laspistol"), "item", "laspistol");
  assert.deepEqual(two.overrides, [{ op: "add", kind: "item", id: "laspistol", qty: 2 }]);

  const a = ops.setAlignment(r, "Chaos");
  assert.equal(ops.view(C, a).character.alignment, "Chaos");
  assert.deepEqual(ops.setAlignment(a, null).overrides, []);
  assert.equal(ops.rename(r, "Ilse").name, "Ilse");
});

test("ops: rules update rolls what the new rules need", () => {
  const r = ops.create(C, "hero", "fighter", "random", { version: "old", roll: seededRoller(7) });
  const newer = structuredClone(C) as Compendium;
  const hero = newer.archetypes.get("hero")!;
  hero.subtypes = hero.subtypes.map((s) => (s.id === "fighter" ? { ...s, stats: { ...s.stats, WS: "70+3D10" } } : s));
  const d = ops.rulesDiff(C, newer, r);
  assert.ok(d.changed);
  assert.ok(d.needsRolling.some((n) => n.key === "hero/@stats:WS"));
  const u = ops.updateRules(newer, r, "new", true, () => 2);
  assert.equal(u.rulesVersion, "new");
  assert.deepEqual(u.dice["hero/@stats:WS"], [2, 2, 2]);
  assert.equal(ops.view(newer, u).pending.length, 0);
  build(newer, u, { mode: "freeform", roll: noRolls });
});

test("ops: engineRecord rejects what isn't a record", () => {
  assert.equal(ops.engineRecord({ v: 1 }), null);
  const r = ops.create(C, "hero", "fighter", "random", { roll: seededRoller(8) });
  assert.deepEqual(ops.engineRecord(JSON.parse(JSON.stringify(r))), r);
});

test("ops: re-rolling several decisions at once (the Stats card's Reroll) leaves the rest alone", () => {
  const r = ops.create(C, "hero", "fighter", "random", { roll: seededRoller(3) });
  const log = ops.view(C, r).log;
  const stats = log.filter((e) => e.type === "dice" && /\/@stats:/.test(e.key)).map((e) => e.key);
  assert.ok(stats.length > 1);
  const next = ops.rerollDecision(C, r, stats, { roll: seededRoller(11) });
  const others = Object.keys(r.dice).filter((k) => !stats.includes(k));
  for (const k of others) assert.deepEqual(next.dice[k], r.dice[k], k);
  assert.notDeepEqual(stats.map((k) => next.dice[k]), stats.map((k) => r.dice[k]));
  assert.doesNotThrow(() => build(C, next, { mode: "freeform", roll: noRolls }));
});

test("engine: a character's archetype is named as one character when the archetype says so", () => {
  const a = C.archetypes.get("hero")!;
  const named: Compendium = { ...C, archetypes: new Map([...C.archetypes, ["hero", { ...a, name: "Heroes", characters: "Hero" }]]) };
  const r = ops.create(named, "hero", "fighter", "random", { roll: seededRoller(3) });
  assert.equal(ops.view(named, r).character.archetype.name, "Hero");
});
