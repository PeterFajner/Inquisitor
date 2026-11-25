// The engine bugs the end-to-end suite found (test/e2e, November 2026): a
// small pack made here for each mechanism, then the suite's own
// reproductions against the real rules (data/rules) when they are there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { build, type BuildResult, type PendingChoice, type RollFn } from "../src/shared/engine/build.ts";
import { newRecord, type CharacterRecord } from "../src/shared/engine/record.ts";
import { reroll } from "../src/shared/engine/reroll.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import { loadAllPacks } from "../src/lib/rules-files.ts";
import { buildCompendium, checkCompendium, withoutHidden, type Compendium } from "../src/shared/rules/compendium.ts";
import { Entry, Pack } from "../src/shared/rules/schema.ts";
import * as ops from "../src/client/builder/ops.ts";

const src = { page: 1 };
const stats = { WS: 50, BS: 50, S: 50, T: 50, I: 50, Wp: 50, Sg: 50, Nv: 50, Ld: 50 };
const item = (id: string, x: Record<string, unknown> = {}) => ({ id, kind: "item", name: id, group: "Gear", source: src, ...x });
const talent = (id: string, x: Record<string, unknown> = {}) => ({ id, kind: "talent", name: id, source: src, text: ".", ...x });
const power = (id: string, group: string) => ({ id, kind: "power", name: id, group, difficulty: 5, source: src, text: "." });
const row = (range: [number, number], label: string, effects: unknown[] = []) => ({ range, label, effects });
const archetype = (id: string, sections: { name: string; effects: unknown[] }[]) => ({
  id,
  kind: "archetype",
  name: id,
  source: src,
  subtypes: [{ id: "fighter", name: "Fighter", stats }],
  sections,
});
const mount = { id: "mount", pick: 1, pool: "item", filter: { owned: true, category: ["Basic weapon"] }, into: "self", required: true };
const disciplineRule = {
  id: "chaos-powers",
  kind: "rule",
  name: "Chaos Powers",
  source: src,
  text: ".",
  apply: { after: "Psychic Abilities" },
  effects: [{ when: { all: [{ alignment: ["Chaos"] }, { psyker: true }] }, then: [{ id: "discipline", optional: [{ access: { pool: "power", group: ["Undivided"] } }] }] }],
};

const entries = [
  // Bug 1: powers whose discipline only `access` opens, met after the powers
  archetype("daemon", [
    { name: "Alignment", effects: [{ id: "god", pick: 1, from: [{ id: "nurgle", name: "Nurgle" }] }, { id: "alignment", alignment: ["Chaos"] }] },
    { name: "Psychic Abilities", effects: [{ when: { option: ["nurgle"] }, then: [{ id: "powers", powers: { count: 2, table: "nurgle-powers" } }] }] },
  ]),
  archetype("marine", [
    { name: "Alignment", effects: [{ id: "alignment", alignment: ["Chaos"] }] },
    { name: "Psychic Abilities", effects: [] },
    { name: "Mutations", effects: [{ id: "wyrd", powers: { count: 1, disciplines: ["Nurgle"], table: "nurgle-powers", wyrd: true } }] },
  ]),
  disciplineRule,
  { id: "nurgle-powers", kind: "table", name: "Nurgle Powers", source: src, die: "D6", rows: [row([1, 3], "Rot", [{ power: "rot" }]), row([4, 6], "Plague", [{ power: "plague" }])] },
  power("rot", "Nurgle"),
  power("plague", "Nurgle"),
  power("quick", "Undivided"),
  power("blade", "Undivided"),
  // Bug 2 and 3: a mount-only weapon, Study Thy Weapon, gear rolled again
  archetype("trooper", [{ name: "Equipment", effects: [{ id: "gear", gear: { count: 2, availability: ["Common"] } }] }]),
  archetype("lone", [{ name: "Equipment", effects: [{ id: "gear", gear: { count: 1, availability: ["Common"] } }] }]),
  archetype("lector", [
    { name: "Type", effects: [{ talent: "study" }] },
    { name: "Equipment", effects: [{ id: "gear", gear: { count: 1, availability: ["Common"] } }] },
  ]),
  {
    id: "equipment-generator",
    kind: "table",
    name: "Equipment Generator",
    source: src,
    die: "D3",
    columns: ["fighter"],
    rows: [
      { ranges: { fighter: [1, 1] }, label: "Close combat weapon", effects: [] },
      { ranges: { fighter: [2, 2] }, label: "Basic weapon", effects: [] },
      { ranges: { fighter: [3, 3] }, label: "Miscellaneous", effects: [{ id: "misc", roll: "misc" }] },
    ],
  },
  { id: "weapon-availability", kind: "table", name: "Weapons Table", source: src, die: "D6", rows: [row([1, 6], "Common")] },
  { id: "misc", kind: "table", name: "Miscellaneous", source: src, die: "D6", rows: [row([1, 3], "Teef", [{ item: "teef" }]), row([4, 6], "Glowstick", [{ item: "glowstick" }])] },
  item("chainblade", { category: "Close combat weapon", availability: "Common", effects: [mount] }),
  item("lasgun", { category: "Basic weapon", availability: "Common" }),
  item("teef", { category: "Miscellaneous", availability: "Common", alien: true }),
  item("glowstick", { category: "Miscellaneous", availability: "Common" }),
  talent("study", { effects: [{ id: "weapon", pick: 1, pool: "item", filter: { owned: true, category: ["Basic weapon", "Close combat weapon"] }, into: "self" }] }),
  // Bug 3: options and entries that can't be had
  archetype("guard", [
    { name: "Equipment", effects: [{ id: "extra", pick: 1, from: [{ id: "grenades", name: "D3 extra grenades", effects: [{ id: "grenades-pick", pick: 1, pool: "item", filter: { owned: true, category: ["Grenade"] }, qty: "D3" }] }, { id: "medi", name: "Medi pack", effects: [{ item: "medi" }] }] }] },
  ]),
  archetype("grenadier", [{ name: "Equipment", effects: [{ item: "frag" }, { id: "extra", pick: 1, from: [{ id: "grenades", name: "D3 extra grenades", effects: [{ id: "grenades-pick", pick: 1, pool: "item", filter: { owned: true, category: ["Grenade"] }, qty: "D3" }] }, { id: "medi", name: "Medi pack", effects: [{ item: "medi" }] }] }] }]),
  archetype("tau", [
    { name: "Equipment", effects: [{ id: "relic", pick: 1, pool: "item", filter: { group: ["Relics"] } }, { id: "blade", pick: 1, pool: "item", filter: { group: ["Blades"] } }] },
    { name: "Psychic Abilities", effects: [{ restrict: { pool: "power", only: [] } }] },
  ]),
  item("frag", { category: "Grenade", availability: "Common" }),
  item("medi", { availability: "Common" }),
  item("rune-stone", { group: "Relics", effects: [{ power: "quick" }] }),
  item("archeotech", { group: "Relics", effects: [{ id: "power", pick: 1, pool: "power", into: "self" }] }),
  item("lamp", { group: "Relics" }),
  item("blade-mounted", { group: "Blades", effects: [mount] }),
  item("sword", { group: "Blades" }),
  // Bug 5: a gear effect's alien policy on a sub-table's fixed rows
  archetype("puritan", [{ name: "Equipment", effects: [{ id: "gear", gear: { count: 1, availability: ["Common"], alien: false } }] }]),
  // Bug 6: an open pick's random count
  archetype("host", [{ name: "Talents", effects: [{ id: "picks", pick: { max: 3 }, pool: "talent", filter: { group: ["Gifts"] } }] }]),
  ...["a", "b", "c", "d"].map((id) => talent(`gift-${id}`, { group: "Gifts" })),
  // Bug 8: each unit of an item decides; a second variant (again) offers what's left
  archetype("gunman", [{ name: "Equipment", effects: [{ item: "pistol" }, { item: "pistol" }, { exotic: "word" }, { exotic: "word", again: true }] }]),
  item("pistol", { effects: [{ id: "toxins", pick: 2, from: [{ id: "choke", name: "Choke" }, { id: "stun", name: "Stun" }, { id: "wither", name: "Wither" }] }] }),
  { id: "word", kind: "exotic", name: "Word", source: src, text: ".", effects: [{ id: "prayer", pick: 1, from: [{ id: "spite", name: "Spite" }, { id: "undoing", name: "Undoing" }] }] },
  // Bug 10: a condition on an option chosen in a later row
  archetype("cherub", [
    { name: "Equipment", effects: [{ when: { not: { option: ["seer"] } }, then: [{ id: "auspex", pick: 1, from: [{ item: "scanner" }, { item: "tracker" }] }] }] },
    { name: "Roles", effects: [{ id: "role", pick: 1, from: [{ id: "seer", name: "The Seer" }, { id: "harpy", name: "The Harpy" }] }] },
  ]),
  item("scanner"),
  item("tracker"),
  // Bug 12: a row a restriction met later refuses rolls on before it is known
  archetype("zealot", [
    { name: "Exotic Abilities", effects: [{ id: "gift", roll: "gifts" }] },
    { name: "Talents", effects: [{ talent: "faith" }] },
  ]),
  { id: "gifts", kind: "table", name: "Gifts", source: src, die: "D6", rows: [row([1, 3], "Wyrd", [{ talent: "wyrd" }, { id: "which", roll: "which" }]), row([4, 6], "Plain", [{ talent: "plain" }])] },
  { id: "which", kind: "table", name: "Which", source: src, die: "D6", rows: [row([1, 6], "Any")] },
  talent("wyrd"),
  talent("plain"),
  talent("faith", { effects: [{ restrict: { pool: "talent", except: ["wyrd"] } }] }),
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
const random = (archetype: string, roll: RollFn): BuildResult => build(c, rec(archetype), { mode: "random", roll });
/** The record replays exactly, rolling and asking nothing, in both modes. */
const replays = (cc: Compendium, b: BuildResult) => {
  for (const mode of ["freeform", "random"] as const) {
    const r = build(cc, b.record, { mode, roll: THROW, pick: () => assert.fail("asked") });
    assert.deepEqual(r.record, b.record, `${mode}: the same record`);
    assert.deepEqual(r.pending, [], `${mode}: nothing open`);
    assert.deepEqual(r.character.powers.map((p) => p.id), b.character.powers.map((p) => p.id), `${mode}: the same powers`);
    assert.deepEqual(r.character.items.map((i) => [i.id, i.qty, i.chosen?.map((x) => x.id)]), b.character.items.map((i) => [i.id, i.qty, i.chosen?.map((x) => x.id)]), `${mode}: the same items`);
  }
};
const freeform = (archetype: string) => build(c, rec(archetype), { mode: "freeform", roll: () => 1 });
const pendingOf = (archetype: string, key: string): PendingChoice | undefined => freeform(archetype).pending.find((p) => p.key === key);
const chosen = (archetype: string, key: string) => freeform(archetype).record.choices[key];

test("the pack is valid rules", () => {
  assert.deepEqual(checkCompendium(c), []);
});

test("bug 1: powers from a discipline opened after them (p83's Chaos disciplines) replay exactly", () => {
  let widened = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const b = random("daemon", seededRoller(seed));
    assert.equal(b.character.powers.length, 2);
    if (b.character.powers.some((p) => ["quick", "blade"].includes(p.id))) widened++;
    replays(c, b);
  }
  assert.ok(widened > 0, "some powers come from the discipline opened later");
});

test("bug 1: a Wyrd's power doesn't make a psyker, and access doesn't widen it", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const b = random("marine", seededRoller(seed));
    assert.equal(b.character.psyker, false);
    assert.ok(b.character.powers.every((p) => ["rot", "plague"].includes(p.id)), "from its own discipline");
    assert.ok(!b.log.some((l) => l.key.startsWith("chaos-powers/")), "not offered the Chaos disciplines");
    replays(c, b);
  }
});

test("bug 2: a pick among what the character owns, into something, is made once all its gear is made", () => {
  // slot 1: Close combat weapon (the Chainblade), slot 2: Basic weapon
  const b = random("trooper", faces(1, 2));
  assert.deepEqual(b.warnings, []);
  assert.deepEqual(b.character.items.find((i) => i.id === "chainblade")?.chosen?.map((x) => x.id), ["lasgun"]);
  assert.deepEqual(b.record.choices["chainblade/mount"], ["lasgun"]);
  replays(c, b);
  // Study Thy Weapon, met before the gear
  const l = random("lector", faces(2));
  assert.deepEqual(l.warnings, []);
  assert.deepEqual(l.character.talents.find((t) => t.id === "study")?.chosen?.map((x) => x.id), ["lasgun"]);
  replays(c, l);
});

test("bug 3: a gear result making a mount-only weapon with nothing to mount it on is rolled again", () => {
  const b = random("lone", faces(1, 1, 2));
  assert.deepEqual(b.warnings, []);
  assert.deepEqual(b.character.items.map((i) => i.id), ["lasgun"]);
  assert.ok(b.log.find((l) => l.key === "lone/gear#1")?.rerolled);
  assert.ok(b.record.dice["lone/gear#1~2"]);
  replays(c, b);
});

test("bug 3: options and entries whose own grants or picks can't be had aren't offered", () => {
  // "D3 extra grenades" means more of a grenade the character has (one
  // option left: made without asking)
  assert.deepEqual(chosen("guard", "guard/extra"), ["medi"]);
  assert.deepEqual(pendingOf("grenadier", "grenadier/extra")?.options.map((o) => o.id), ["grenades", "medi"]);
  for (let seed = 1; seed <= 20; seed++) assert.deepEqual(random("guard", seededRoller(seed)).warnings, []);
  // can never have psychic powers: no gear that gives one; a mount-only weapon with nothing to mount
  assert.deepEqual(chosen("tau", "tau/relic"), ["lamp"]);
  assert.deepEqual(chosen("tau", "tau/blade"), ["sword"]);
});

test("bug 5: a gear effect's alien policy holds for a sub-table's fixed rows", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const b = random("puritan", seededRoller(seed));
    assert.ok(!b.character.items.some((i) => i.id === "teef"), `seed ${seed}`);
  }
  const b = random("puritan", faces(3, 1, 1, 4)); // Miscellaneous, then Teef, then Glowstick
  assert.deepEqual(b.character.items.map((i) => i.id), ["glowstick"]);
  assert.ok(b.log.find((l) => l.key === "puritan/gear#1>equipment-generator/misc")?.rerolled);
});

test("bug 6: re-rolling a pick's random count makes the pick again for the new count", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const b = random("host", seededRoller(seed));
    const cleared = reroll(c, b.record, "host/picks:count");
    assert.equal(cleared.dice["host/picks:count"], undefined);
    assert.equal(cleared.choices["host/picks"], undefined, "the choice goes with its count");
    const again = build(c, cleared, { mode: "random", roll: seededRoller(1000 + seed) });
    const n = again.record.dice["host/picks:count"];
    assert.ok(n, "the count is rolled again");
    assert.equal(again.record.choices["host/picks"].length, n[0] - 1);
  }
});

test("bug 8: each unit of an item makes its own picks; a second variant (again) offers what's left", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const b = random("gunman", seededRoller(seed));
    assert.deepEqual(b.warnings, [], `seed ${seed}`);
    const pistol = b.character.items.find((i) => i.id === "pistol")!;
    assert.deepEqual(pistol.variants?.map((v) => v.length), [2, 2]);
    const word = b.character.exotics.find((e) => e.id === "word")!;
    assert.equal(new Set(word.variants?.flat()).size, 2, "the second prayer isn't the first");
  }
  // the second pistol may take what the first did
  assert.ok(
    Array.from({ length: 40 }, (_, i) => random("gunman", seededRoller(i + 1)).character.items.find((x) => x.id === "pistol")!.variants!).some(([a, b]) => a.some((x) => b.includes(x))),
  );
});

test("bug 10: a condition on an option chosen in a later row looks ahead", () => {
  let seers = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const b = random("cherub", seededRoller(seed));
    const seer = b.character.options.some((o) => o.id === "seer");
    seers += seer ? 1 : 0;
    assert.equal(b.record.choices["cherub/auspex"] === undefined, seer, `seed ${seed}`);
    assert.equal(b.character.items.length, seer ? 0 : 1);
    replays(c, b);
  }
  assert.ok(seers > 0 && seers < 40);
  // freeform: choosing the Seer takes the auspex choice away
  const open = build(c, rec("cherub", { choices: { "cherub/role": ["seer"] } }), { mode: "freeform", roll: THROW });
  assert.deepEqual(open.pending, []);
});

test("bug 12: rebuilding rolls nothing, even dice only an earlier pass used", () => {
  // Gifts 1 (Wyrd, then its own roll), refused once Faith's restriction is met: Gifts again, 4 (Plain)
  const b = random("zealot", faces(1, 1, 4));
  assert.deepEqual(b.character.talents.map((t) => t.id).sort(), ["faith", "plain"]);
  assert.equal(b.record.dice["gifts/which"], undefined);
  replays(c, b);
  // a record missing a die still rolls it
  const missing = { ...b.record, dice: { ...b.record.dice } };
  delete missing.dice["zealot/gift~2"];
  assert.throws(() => build(c, missing, { mode: "random", roll: THROW }), /rolled a die/);
});

// --- the suite's reproductions, against the real rules ------------------------------

const RULES = process.env.RULES_DIR || join(import.meta.dirname, "../data/rules");
const real = existsSync(join(RULES, "loyalist")) ? buildCompendium(withoutHidden(loadAllPacks(RULES))) : null;
const skip = !real && "no rules";
const R = real!;
const realRandom = (a: string, s: string, seed: number) => build(R, newRecord(R.packs.map((p) => p.id), a, s), { mode: "random", roll: seededRoller(seed) });

test("real rules, bug 1: Daemons and a Chaos Sage replay with their powers; a Gifted-of-Chaos Wyrd leaves nothing open", { skip }, () => {
  for (const [a, s, seed] of [["daemons", "daemonic", 1], ["daemons", "daemonic", 67], ["antagonist", "sage", 18]] as const) {
    const b = realRandom(a, s, seed);
    assert.ok(b.character.powers.length > 0);
    replays(R, b);
  }
  const rec0 = ops.create(R, "adeptus-astartes", "space-marine", "freeform", { roll: seededRoller(369) });
  const filled = ops.fillPending(R, rec0, { roll: seededRoller(2_000_369) });
  const r = build(R, filled, { mode: "freeform", roll: THROW });
  assert.deepEqual(r.pending, []);
});

test("real rules, bugs 2 and 3: mounts on later gear, no mount-only weapon alone, IG grenades, Legendary weapon", { skip }, () => {
  const abh61 = realRandom("alien-bounty-hunter", "experienced-hunter", 61);
  for (const it of abh61.character.items.filter((i) => ["chainblade", "bayonet"].includes(i.id))) assert.equal(it.chosen?.length, 1, it.id);
  const pirate = realRandom("eldar-pirates", "pirate-prince", 39);
  assert.ok(!pirate.warnings.some((w) => w.includes("mount")), pirate.warnings.join("; "));
  for (let seed = 1; seed <= 40; seed++) {
    const ig = realRandom("imperial-guard", "fighter", seed);
    assert.ok(!ig.warnings.some((w) => w.includes("grenades-pick")), `IG seed ${seed}`);
  }
  const abh126 = realRandom("alien-bounty-hunter", "dogged-tracker", 126);
  assert.ok(!abh126.warnings.some((w) => w.includes("legendary-weapon-pick")));
  const lector = realRandom("inquisitor-acolyte", "fighter", 264);
  assert.ok(!lector.warnings.some((w) => w.includes("study-thy-weapon")));
});

test("real rules, bug 5: no Xenos gear for the Ecclesiarchy from a sub-table's rows", { skip }, () => {
  for (let seed = 1; seed <= 60; seed++) {
    const b = realRandom("ecclesiarchy", "fighter", seed);
    assert.ok(!b.character.items.some((i) => R.items.get(i.id)?.alien), `seed ${seed}`);
  }
});

test("real rules, bug 6: re-rolling a Daemonhost's count of lesser powers", { skip }, () => {
  const b = realRandom("daemonhosts", "daemonhost", 2);
  const next = ops.rerollDecision(R, b.record, "daemonhosts/powers-lesser:count", { roll: seededRoller(99) });
  const n = next.dice["daemonhosts/powers-lesser:count"];
  assert.ok(n);
  assert.equal(next.choices["daemonhosts/powers-lesser"]?.length ?? 0, n[0] - 1);
});

test("real rules, bug 8: a second Executor Pistol gets its three toxins", { skip }, () => {
  const b = realRandom("rogue-trader", "marksman", 274);
  assert.deepEqual(b.warnings, []);
  for (const v of b.character.items.find((i) => i.id === "executor-pistol")?.variants ?? []) assert.equal(v.length, 3);
});

test("real rules, bugs 10 and 12: the Seer keeps no auspex; an Acolyte's record replays rolling nothing", { skip }, () => {
  const cherub = realRandom("cherubim", "cherubim", 8);
  assert.ok(cherub.character.options.some((o) => o.id === "the-seer"));
  assert.equal(cherub.record.choices["cherubim/auspex"], undefined);
  const b = realRandom("inquisitor-acolyte", "fighter", 25);
  const next = ops.rerollDecision(R, b.record, "inquisitor-acolyte/elucidator-talents", { roll: seededRoller(1_000_025) });
  const r = build(R, next, { mode: "random", roll: THROW });
  assert.deepEqual(r.record, next);
});
