// The book's random tables the generator rolls (the rules-fidelity review):
// gear rows that roll a table by the result's availability, items of the
// result's availability only, the column of a weapon carried, armour
// covering some locations, rows that can't land anywhere, powers rolled on
// their generation table, bionics limited to some rows, a grant's variant,
// duplicates that only gear gave. A small pack made here, checked by the
// schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build, ROLL_OPTION, type BuildResult } from "../src/shared/engine/build.ts";
import { newRecord, type CharacterRecord } from "../src/shared/engine/record.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import { buildCompendium, checkCompendium } from "../src/shared/rules/compendium.ts";
import { Entry, Pack } from "../src/shared/rules/schema.ts";
import { randomPick } from "../src/client/builder/ops.ts";

const src = { page: 1 };
const stats = { WS: 50, BS: 50, S: 50, T: 50, I: 50, Wp: 50, Sg: 50, Nv: 50, Ld: 50 };
const item = (id: string, x: Record<string, unknown> = {}) => ({ id, kind: "item", name: id, group: "Gear", source: src, ...x });
const row = (range: [number, number], label: string, effects: unknown[] = []) => ({ range, label, effects });
const entries = [
  {
    id: "gunner",
    kind: "archetype",
    name: "Gunners",
    source: src,
    subtypes: [{ id: "fighter", name: "Fighter", stats }],
    sections: [
      { name: "Equipment", effects: [{ id: "gear", gear: { count: 2, availability: ["Common", "Rare"] } }] },
      { name: "Psychic Abilities", effects: [{ id: "powers", powers: { count: 2, maxDifficulty: 10, table: "first-roll" } }] },
      { name: "Talents", effects: [{ talent: "aim" }] },
      { name: "Bionics", effects: [{ id: "limb", bionics: { count: 1, only: ["Limb"] } }] },
    ],
  },
  {
    id: "monk",
    kind: "archetype",
    name: "Monks",
    source: src,
    subtypes: [{ id: "fighter", name: "Fighter", stats }],
    sections: [
      { name: "Equipment", effects: [{ restrict: { pool: "item", except: ["Stimm"] } }, { id: "gear", gear: { count: 1, availability: ["Common"] } }] },
    ],
  },
  {
    id: "equipment-generator",
    kind: "table",
    name: "Equipment Generator",
    source: src,
    die: "D6",
    columns: ["fighter"],
    rows: [
      { ranges: { fighter: [1, 1] }, label: "Pistol", effects: [] },
      {
        ranges: { fighter: [2, 2] },
        label: "Armour",
        effects: [
          { when: { availability: ["Common"] }, then: [{ id: "common", roll: "common-armour" }] },
          { when: { availability: ["Rare"] }, then: [{ id: "rare", roll: "rare-armour" }] },
        ],
      },
      {
        ranges: { fighter: [3, 3] },
        label: "Special ammunition",
        effects: [{ id: "ammo", roll: "ammo", matchAvailability: true, column: { owned: { bolter: ["boltgun"] }, else: "other" } }],
      },
      { ranges: { fighter: [4, 4] }, label: "Combat stimms", effects: [{ item: "inhaler" }, { id: "dose", roll: "stimm" }] },
      { ranges: { fighter: [5, 6] }, label: "Grenade", effects: [] },
    ],
  },
  { id: "weapon-availability", kind: "table", name: "Weapons Table", source: src, die: "D6", rows: [row([1, 3], "Common"), row([4, 6], "Rare")] },
  {
    id: "common-armour",
    kind: "table",
    name: "Common Armour",
    source: src,
    die: "D6",
    rows: [row([1, 3], "Flak (All non-head locations)", [{ item: "flak", covers: { locations: "non-head" } }]), row([4, 6], "Flak (D6 locations)", [{ item: "flak", covers: { choose: "D6" } }])],
  },
  { id: "rare-armour", kind: "table", name: "Rare Armour", source: src, die: "D6", rows: [row([1, 6], "Carapace", [{ item: "carapace" }])] },
  {
    id: "ammo",
    kind: "table",
    name: "Ammunition",
    source: src,
    die: "D6",
    columns: ["bolter", "other"],
    rows: [
      { ranges: { bolter: [1, 3] }, label: "Shell", effects: [{ item: "shell" }] },
      { ranges: { bolter: [4, 6], other: [1, 6] }, label: "Dumdum", effects: [{ item: "dumdum" }] },
    ],
  },
  { id: "stimm", kind: "table", name: "Type Of Stimm", source: src, die: "D6", rows: [row([1, 6], "Rage", [{ item: "rage" }])] },
  {
    id: "first-roll",
    kind: "table",
    name: "Starting Powers",
    source: src,
    die: "D6",
    rows: [row([1, 3], "Fire", [{ id: "fire", roll: "second-roll", column: "fire" }]), row([4, 6], "Mind", [{ id: "mind", roll: "second-roll", column: "mind" }])],
  },
  {
    id: "second-roll",
    kind: "table",
    name: "Starting Powers",
    source: src,
    die: "D6",
    columns: ["fire", "mind"],
    rows: [
      { ranges: { fire: [1, 2] }, label: "Spark", effects: [{ power: "spark" }] },
      { ranges: { fire: [3, 6], mind: [3, 6] }, label: "Re-roll", effects: [] },
      { ranges: { mind: [1, 2] }, label: "Whisper", effects: [{ power: "whisper" }] },
    ],
  },
  { id: "bionics-table", kind: "table", name: "Bionics Table", source: src, die: "D6", rows: [row([1, 3], "Limb", [{ id: "limb", roll: "limbs" }]), row([4, 6], "Other implant", [{ item: "cortex" }])] },
  { id: "limbs", kind: "table", name: "Bionic Limbs", source: src, die: "D6", rows: [row([1, 6], "Left arm", [{ item: "limb", variant: "Left arm" }])] },
  { id: "quality", kind: "table", name: "Bionic Quality", source: src, die: "D6", rows: [row([1, 3], "Crude"), row([4, 6], "Average")] },
  item("boltgun", { category: "Pistol", availability: "Common" }),
  item("flak", { category: "Armour", availability: "Common", effects: [{ armour: { av: 3 } }] }),
  item("carapace", { category: "Armour", availability: "Rare", effects: [{ armour: { av: 6 } }] }),
  item("shell", { category: "Special ammunition", availability: "Rare" }),
  item("dumdum", { category: "Special ammunition", availability: "Rare" }),
  item("frag", { category: "Grenade", availability: "Common" }),
  item("inhaler", { category: "Dispenser" }),
  item("rage", { category: "Stimm", unrestricted: true }),
  item("limb", { category: "Bionic", effects: [{ id: "quality", roll: "quality" }] }),
  item("cortex", { category: "Other implant", effects: [{ talent: "aim" }] }),
  { id: "aim", kind: "talent", name: "Aim", source: src, text: "." },
  { id: "spark", kind: "power", name: "Spark", group: "Fire", difficulty: 8, source: src, text: "." },
  { id: "whisper", kind: "power", name: "Whisper", group: "Mind", difficulty: "Wp/2", source: src, text: "." },
  { id: "blaze", kind: "power", name: "Blaze", group: "Fire", difficulty: 9, source: src, text: "." },
].map((e) => Entry.parse(e));
const c = buildCompendium([{ pack: Pack.parse({ id: "t", name: "T" }), entries }]);
const rec = (archetype: string, patch: Partial<CharacterRecord> = {}): CharacterRecord => ({ ...newRecord(["t"], archetype, "fighter"), ...patch });
const ones = () => 1;
const run = (r: CharacterRecord, mode: "random" | "freeform" = "random", roll = ones): BuildResult => build(c, r, { mode, roll });

test("the fidelity pack is valid rules", () => {
  assert.deepEqual(checkCompendium(c), []);
});

test("gear: a row rolls the table of the result's availability; a grant's covers narrow its armour", () => {
  const b = run(rec("gunner", { dice: { "gunner/gear#1": [2], "gunner/gear#1:avail": [1], "gunner/gear#1>equipment-generator/common": [1], "gunner/gear#2": [2], "gunner/gear#2:avail": [4] } }));
  const ch = b.character;
  assert.deepEqual(ch.rolls.filter((r) => /armour/.test(r.table)).map((r) => r.label), ["Flak (All non-head locations)", "Carapace"]);
  const flak = ch.armourPieces.find((p) => p.source === "flak")!;
  assert.ok(!flak.locations.includes("Head") && flak.locations.length === 7, "all non-head locations");
  // "(D6 locations)": that many, chosen
  const d6 = run(rec("gunner", { dice: { "gunner/gear#1": [2], "gunner/gear#1:avail": [1], "gunner/gear#1>equipment-generator/common": [5], "gunner/gear#1>equipment-generator/common>flak/@locations:count": [2] } }));
  assert.equal(d6.character.armourPieces.find((p) => p.source === "flak")!.locations.length, 2);
});

test("gear: ammunition in the column of a weapon carried, of the result's availability; made after the other results", () => {
  const dice = { "gunner/gear#1": [3], "gunner/gear#1:avail": [4], "gunner/gear#2": [1], "gunner/gear#2:avail": [1] };
  const b = run(rec("gunner", { dice: { ...dice, "gunner/gear#1>equipment-generator/ammo": [1] }, choices: { "gunner/gear#2:item": ["boltgun"] } }));
  assert.ok(b.character.items.some((i) => i.id === "shell"), "the boltgun (slot 2) came first: bolter column");
  // no bolter: the other column (no Shell there)
  const none = run(rec("gunner", { dice: { ...dice, "gunner/gear#2": [5], "gunner/gear#1>equipment-generator/ammo": [1] } }));
  assert.ok(none.character.items.some((i) => i.id === "dumdum") && !none.character.items.some((i) => i.id === "shell"));
  // a Common result: no Common ammunition at all, so the slot is rolled again
  const common = run(rec("gunner", { dice: { ...dice, "gunner/gear#1:avail": [1], "gunner/gear#1~2": [5], "gunner/gear#1~2:avail": [1] } }));
  assert.ok(common.log.find((l) => l.key === "gunner/gear#1")!.rerolled);
  assert.equal(common.character.rolls.find((r) => r.key === "gunner/gear#1~2")!.label, "Grenade");
});

test("gear: a row whose roll can't land on anything allowed re-rolls the slot (no empty dispensers)", () => {
  const b = run(rec("monk", { dice: { "monk/gear#1": [4], "monk/gear#1:avail": [1], "monk/gear#1~2": [5], "monk/gear#1~2:avail": [1] } }));
  assert.ok(b.log.find((l) => l.key === "monk/gear#1")!.rerolled);
  assert.ok(!b.character.items.some((i) => i.id === "inhaler"));
  assert.deepEqual(b.warnings, []);
});

test("powers: rolled on the generation table; Re-roll rows and taken powers rolled again; freeform offers the table", () => {
  const dice = { "gunner/powers:count": [2] };
  const b = run(
    rec("gunner", {
      dice: {
        ...dice,
        "gunner/powers#1": [1], // Fire
        "gunner/powers#1>first-roll/fire": [4], // Re-roll
        "gunner/powers#1>first-roll/fire~2": [1], // Spark
        "gunner/powers#2": [2], // Fire again: only Spark there, taken: the first roll is made again
        "gunner/powers#2~2": [5], // Mind
        "gunner/powers#2~2>first-roll/mind": [1], // Whisper (Wp/2 counts as within 10)
      },
    }),
  );
  assert.deepEqual(b.character.powers.map((p) => p.id), ["spark", "whisper"]);
  assert.ok(b.log.find((l) => l.key === "gunner/powers#1>first-roll/fire")!.rerolled);
  assert.ok(b.log.find((l) => l.key === "gunner/powers#2")!.rerolled);
  assert.ok(!b.character.powers.some((p) => p.id === "blaze"), "not on the table");
  // the random build's record replays in freeform without asking
  assert.deepEqual(run(b.record, "freeform").pending.filter((p) => p.kind === "power"), []);
  // freeform: the powers the table can give, and the table itself
  const f = run(rec("gunner", { dice }), "freeform");
  const p = f.pending.find((x) => x.key === "gunner/powers#1")!;
  assert.deepEqual(p.options.map((o) => o.id), [ROLL_OPTION, "spark", "whisper"]);
  assert.equal(p.options[0].label, "Starting Powers");
  assert.deepEqual(randomPick(p), [ROLL_OPTION]);
  const rolled = build(c, rec("gunner", { dice }), { mode: "freeform", roll: seededRoller(3), pick: (q) => (q.kind === "power" ? [ROLL_OPTION] : undefined) });
  assert.equal(rolled.character.powers.length, 2);
  assert.equal(rolled.record.choices["gunner/powers#1"], undefined, "the table's dice are the decision");
});

test("bionics: only the named rows; a grant's variant and its own quality roll", () => {
  const b = run(rec("gunner", { dice: { "gunner/limb#1": [5], "gunner/limb#1~2": [1], "gunner/limb#1~2>bionics-table/limb>limb/quality": [5] } }));
  assert.ok(b.log.find((l) => l.key === "gunner/limb#1")!.rerolled, "Other implant isn't a limb");
  const limb = b.character.items.find((i) => i.id === "limb")!;
  assert.deepEqual(limb.variants, [["Left arm", "Average"]]);
});

test("duplicates: a talent only gear gave isn't one; the profile's own talents are", () => {
  const b = run(rec("gunner"));
  assert.ok(b.character.talents.some((t) => t.id === "aim"));
  const c2 = buildCompendium([
    {
      pack: Pack.parse({ id: "t", name: "T" }),
      entries: [
        ...entries.filter((e) => e.id !== "gunner"),
        Entry.parse({
          id: "gunner",
          kind: "archetype",
          name: "Gunners",
          source: src,
          subtypes: [{ id: "fighter", name: "Fighter", stats }],
          sections: [
            { name: "Equipment", effects: [{ item: "cortex" }] },
            { name: "Boons", effects: [{ id: "boon", roll: "talents", rerollDuplicates: true }] },
          ],
        }),
        Entry.parse({ id: "talents", kind: "table", name: "Talents", source: src, die: "D6", rows: [row([1, 6], "Aim", [{ talent: "aim" }])] }),
      ],
    },
  ]);
  const g = build(c2, rec("gunner"), { mode: "random", roll: ones });
  assert.ok(!g.log.find((l) => l.key === "gunner/boon")!.rerolled, "Aim came only from the cortex");
  assert.equal(g.character.talents.find((t) => t.id === "aim")!.from.length, 2);
});
