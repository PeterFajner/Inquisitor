// Warbands, sharing and export: the warband warnings
// (src/client/warband/warnings.ts), the sheet mapping's engine fields
// (armour, derived values, reloads, natural weapons; src/shared/sheet-map.ts)
// and a sample warband of four real characters as the GM's Word sheet
// (data/source/sample-warband.docx, from data/rules or SAMPLE_RULES_DIR).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { loadPack } from "../src/lib/rules-files.ts";
import { buildCompendium, type Compendium } from "../src/shared/rules/compendium.ts";
import type { Rule } from "../src/shared/rules/schema.ts";
import { build, type Character } from "../src/shared/engine/build.ts";
import { newRecord, type CharacterRecord } from "../src/shared/engine/record.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import { sheetParts, toSheetCharacter } from "../src/shared/sheet-map.ts";
import { SHEET_LOCATIONS } from "../src/shared/sheet.ts";
import { renderSheetDocx } from "../src/client/export/docx.ts";
import { sentences, warbandWarnings } from "../src/client/warband/warnings.ts";
import * as ops from "../src/client/builder/ops.ts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(import.meta.dirname, "fixtures");
const fixtures = (): Compendium =>
  buildCompendium(
    ["base", "extra"].map((id) => {
      const { pack } = loadPack(id, FIXTURES);
      return pack!;
    }),
  );

// The book's warband steps (page 3), as the rules hold them.
const STEPS_TEXT = `1. Create a number of characters required for a campaign being played (usually 3-4.) Keep the following restrictions in mind, which any can be overruled or altered by the Game Master:

• You don’t have to play as an Inquisitor and their retinue. Just any group of combatants who would band together in action.
• Generally, Warrior Bands should never have more than one Inquisitor.
• There are some character archetypes that are far more powerful than their peers and could drastically change the tone of your game. Consult your GM before including any of the following characters in your Warrior Band: Adeptus Astartes, Callidus Assassin, and Vindicare Assassin.

2. Characters have alignments within the context of the universe: Puritan, Neutral, and Radical. Puritan and Radical characters within the same warband are prone to infighting and turning on one another. Neutrals tolerate whatever they are mixed into within reason of that character’s world view.

3. Some characters add extra models to your warrior band (Such as Enginseers being allowed to take a Technical Servitor, etc.) This is allows you to exceed the regular amount of characters in your Warrior Band beyond the normal limit outlined for the campaign.`;

function withRules(c: Compendium, opts: { limit?: boolean } = {}): Compendium {
  const steps = {
    id: "steps-to-create-a-warrior-band",
    kind: "rule",
    name: "Steps To Create a Warrior Band",
    source: { page: 3, text: STEPS_TEXT },
    text: STEPS_TEXT,
    effects: opts.limit === false ? [] : [{ warband: { max: 1, archetype: ["inquisitor"] } }],
  } as unknown as Rule;
  const rules = new Map(c.rules);
  rules.set(steps.id, steps);
  const archetypes = new Map(c.archetypes);
  archetypes.set("inquisitor", { id: "inquisitor", kind: "archetype", name: "Inquisitors", source: { page: 4 }, subtypes: [], sections: [] } as never);
  archetypes.set("adeptus-astartes", { id: "adeptus-astartes", kind: "archetype", name: "Adeptus Astartes", gmApproval: true, source: { page: 6 }, subtypes: [], sections: [] } as never);
  return { ...c, rules, archetypes };
}

// Just what the warnings read of a built character.
const member = (id: string, archetype: string, more: Partial<Character> = {}) => ({
  id,
  character: { archetype: { id: archetype, name: archetype }, alignment: undefined, companions: [], notes: [], ...more } as unknown as Character,
});

test("warnings: sentences drop bullets and step numbers", () => {
  const s = sentences(STEPS_TEXT);
  assert.ok(s.includes("Generally, Warrior Bands should never have more than one Inquisitor."));
  assert.ok(s.includes("Puritan and Radical characters within the same warband are prone to infighting and turning on one another."));
  assert.ok(s.some((x) => x.startsWith("Some characters add extra models")));
});

test("warnings: the book's warband rules, each with its own sentence", () => {
  const c = withRules(fixtures());
  assert.deepEqual(warbandWarnings(c, []), []);
  assert.deepEqual(warbandWarnings(c, [member("a", "inquisitor"), member("b", "hero")]), []);

  const two = warbandWarnings(c, [member("a", "inquisitor"), member("b", "hero"), member("c", "inquisitor")]);
  assert.equal(two.length, 1);
  assert.equal(two[0].kind, "limit");
  assert.equal(two[0].text, "Generally, Warrior Bands should never have more than one Inquisitor.");
  assert.deepEqual(two[0].members, ["a", "c"]);
  assert.equal(two[0].source.page, 3);

  const gm = warbandWarnings(c, [member("m", "adeptus-astartes"), member("n", "adeptus-astartes")]);
  assert.equal(gm.length, 1);
  assert.equal(gm[0].kind, "gm");
  assert.ok(gm[0].text.startsWith("Consult your GM before including any of the following characters in your Warrior Band"));
  assert.deepEqual(gm[0].members, ["m", "n"]);

  const align = warbandWarnings(c, [
    member("p", "hero", { alignment: "Puritan" }),
    member("q", "hero", { alignment: "Neutral" }),
    member("r", "hero", { alignment: "Radical" }),
  ]);
  assert.deepEqual(
    align.map((w) => [w.kind, w.text, w.members]),
    [["alignment", "Puritan and Radical characters within the same warband are prone to infighting and turning on one another.", ["p", "r"]]],
  );
  assert.deepEqual(warbandWarnings(c, [member("p", "hero", { alignment: "Puritan" }), member("q", "hero", { alignment: "Neutral" })]), []);

  const models = warbandWarnings(c, [
    member("e", "hero", { companions: [{ archetype: "servitors", source: "enginseers", key: "enginseers/technical-servitor>@companion" }] }),
    member("d", "hero", {
      notes: [{ text: "Each game they have a 50% chance of having an Enforcer character join the Warrior Band for that game.", kind: "gameplay", source: "inquisitor-acolyte" }],
    }),
  ]);
  assert.deepEqual(
    models.map((w) => [w.kind, w.members]),
    [
      ["models", ["e"]],
      ["models", ["d"]],
    ],
  );
  assert.ok(models[0].text.startsWith("Some characters add extra models to your warrior band"));
  assert.equal(models[1].text, "Each game they have a 50% chance of having an Enforcer character join the Warrior Band for that game.");

  // No warband effect in the rules: no limit warning (the rule is data).
  assert.deepEqual(warbandWarnings(withRules(fixtures(), { limit: false }), [member("a", "inquisitor"), member("c", "inquisitor")]), []);
});

test("sheet-map: armour per location, derived values, reloads, natural weapons and attributes", () => {
  const C = fixtures();
  const r = ops.create(C, "hero", "fighter", "random", { name: "Vex", roll: seededRoller(3) });
  const { character } = build(C, r, { mode: "freeform", roll: seededRoller(1) });
  const ch: Character = {
    ...character,
    armour: {
      ...character.armour,
      Head: { av: 6, fields: [], from: ["closed-helmet"] },
      Chest: { av: 8, fields: ["D10"], from: ["carapace-armor", "displacer-field"] },
      "Left Leg": { av: 0, fields: [], from: [] },
    },
    derived: { ...character.derived, SS: { base: 9, value: "No", mods: [] }, BIV: { base: 5, value: 7, mods: [] } },
    weapons: [{ name: "Claws", profile: { Reach: "1", Damage: "D6+2" }, qty: 2, source: "hero" }],
    attributes: [{ name: "Warp Strength", value: 5, source: "hero" }],
    reloads: { add: 1, multiply: 2 },
  };
  const { sheet, refs } = sheetParts(ch, C);
  assert.equal(sheet.armour.Head, "6");
  assert.equal(sheet.armour.Chest, "8+D10");
  assert.equal(sheet.armour["L. Leg"], "");
  assert.equal(sheet.starting.SS, "No");
  assert.equal(sheet.starting.BIV, "7");
  const claws = sheet.melee.findIndex((m) => m.name === "Claws ×2");
  assert.ok(claws >= 0);
  assert.equal(sheet.melee[claws].dam, "D6+2");
  assert.equal(refs.melee[claws].fixed, true);
  assert.equal(sheet.gameNotes[0], "Warp Strength 5");
  for (const f of sheet.firearms) {
    const it = ch.items.find((i) => f.name.startsWith(i.name));
    if (it) assert.equal(f.reloads, String((it.reloads ?? 0) * 2 + 1));
  }
});

test("the template served at /static/ is the export's template", () => {
  assert.deepEqual(readFileSync(join(ROOT, "src/static/sheet-template.docx")), readFileSync(join(ROOT, "src/client/export/sheet-template.docx")));
});

// --- the sample warband -------------------------------------------------------

function unzipEntry(zip: Uint8Array, name: string): string {
  const buf = Buffer.from(zip);
  let eocd = buf.length - 22;
  while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    p += 46 + nameLen + extra;
  }
  throw new Error(`${name} not in zip`);
}
const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SAMPLE_RULES = process.env.SAMPLE_RULES_DIR ? join(ROOT, process.env.SAMPLE_RULES_DIR) : join(ROOT, "data/rules");

test("a sample warband of four real characters as the GM's Word sheet", { skip: !existsSync(join(SAMPLE_RULES, "loyalist")) && "no rules" }, async () => {
  const { pack } = loadPack("loyalist", SAMPLE_RULES);
  assert.ok(pack);
  const C = buildCompendium([pack]);
  // Four characters as the builder makes them (random; the Inquisitor takes the book's Power Armour option).
  const make = (archetype: string, subtype: string, name: string, seed: number, choices: Record<string, string[]> = {}): CharacterRecord => {
    const r = newRecord(C.packs.map((p) => p.id), archetype, subtype, name);
    r.choices = { ...choices };
    return build(C, r, { mode: "random", roll: seededRoller(seed) }).record;
  };
  const records = [
    make("inquisitor", "psyker", "Malachai Venn", 11, { "inquisitor/power-armor-choice": ["yes"], "inquisitor/power-armor-suit": ["power-armor"] }),
    make("adepta-sororitas", "battle-sister", "Sister Ottilie", 12),
    make("imperial-guard", "fighter", "Varro Kesh", 13),
    make("enginseers", "enginseers", "Ix-9", 14),
  ];
  const built = records.map((r) => build(C, r, { mode: "freeform", roll: seededRoller(99) }).character);
  const sheets = built.map((ch) => toSheetCharacter(ch, C));
  const template = readFileSync(join(ROOT, "src/client/export/sheet-template.docx"));
  const docx = await renderSheetDocx(sheets, template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength));
  if (existsSync(join(ROOT, "data/source"))) writeFileSync(join(ROOT, "data/source/sample-warband.docx"), docx);

  const xml = unzipEntry(docx, "word/document.xml");
  assert.ok(!xml.includes("{{"), "no command is left");
  // Every filled field is in the document.
  for (const s of sheets) {
    const has = (text: string, what: string) => assert.ok(xml.includes(xmlEscape(text)), `${s.name}: ${what} "${text}"`);
    has(s.name, "name");
    for (const part of s.tagLine.split(", ")) has(part, "tag line");
    for (const [k, v] of Object.entries(s.starting)) has(v, k);
    for (const l of SHEET_LOCATIONS) if (s.armour[l]) has(s.armour[l], `armour ${l}`);
    for (const f of s.firearms) for (const v of [f.name, f.damage, f.rng]) if (v) has(v, "firearm");
    for (const m of s.melee) for (const v of [m.name, m.dam]) if (v) has(v, "melee");
    for (const a of s.abilities) has(a.name, "ability");
    for (const o of s.other) has(o, "other");
  }
});
