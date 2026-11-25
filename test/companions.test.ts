// Companions (src/shared/engine/companions.ts: an Enginseer's Technical
// Servitor), the description line's options chosen by a rule (sheet-map.ts),
// and the builder's Occupation labels (src/client/builder/occupation.ts),
// against small made-up packs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { buildCompendium, checkCompendium, type Compendium } from "../src/shared/rules/compendium.ts";
import { Entry } from "../src/shared/rules/schema.ts";
import { build } from "../src/shared/engine/build.ts";
import { buildAll } from "../src/shared/engine/companions.ts";
import { newRecord, type CharacterRecord } from "../src/shared/engine/record.ts";
import { reroll } from "../src/shared/engine/reroll.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import { characterSheets, sheetParts, toSheetCharacter } from "../src/shared/sheet-map.ts";
import { renderSheetDocx } from "../src/client/export/docx.ts";
import * as ops from "../src/client/builder/ops.ts";
import { occupationPicks } from "../src/client/builder/occupation.ts";

const noRolls = () => {
  throw new Error("rolled a die the record should have had");
};
const stats = (ws: string) => ({ WS: ws, BS: "30+D10", S: 40, T: 40, I: 40, Wp: 40, Sg: 40, Nv: 40, Ld: 40 });
const item = (id: string, name: string) => ({ id, kind: "item", name, group: "Equipment", source: { page: 1 } });

function compendium(id: string, entries: unknown[]): Compendium {
  const c = buildCompendium([{ pack: { id, name: id }, entries: entries.map((e) => Entry.parse(e)) }]);
  assert.deepEqual(checkCompendium(c), []);
  return c;
}

// An Enginseer that "May be accompanied by a Technical Servitor" (p. 15), and the Servitors' type (p. 19).
const ENGINE = [
  item("techno-mat", "Techno-mat"),
  item("wrench", "Wrench"),
  item("drill", "Drill"),
  {
    id: "engineers", kind: "archetype", name: "Engineers", characters: "Engineer", source: { page: 15, text: "Equipment: May be accompanied by a Technical Servitor." },
    subtypes: [{ id: "engineer", name: "Engineer", stats: stats("40+D10") }],
    sections: [
      {
        name: "Equipment",
        effects: [
          { id: "technical-servitor", optional: [{ companion: { archetype: "bots", subtype: "bot", option: "technical" } }] },
          { item: "techno-mat" },
        ],
      },
      { name: "Alignment", effects: [{ id: "alignment", alignment: ["Puritan", "Radical"] }] },
    ],
  },
  {
    id: "bots", kind: "archetype", name: "Bots", characters: "Bot", source: { page: 19 },
    subtypes: [
      { id: "bot", name: "Bot", stats: stats("25+D10") },
      { id: "big-bot", name: "Big Bot", stats: stats("45+D10") },
    ],
    sections: [
      {
        name: "Bot Type",
        effects: [
          {
            id: "bot-type",
            optional: [
              {
                when: { subtype: ["big-bot"] },
                then: [{ id: "type-big", pick: 1, from: [{ id: "combat", name: "Combat", effects: [{ stat: "WS", add: 20 }] }, { id: "gun", name: "Gun" }] }],
                else: [
                  {
                    id: "type",
                    pick: 1,
                    from: [
                      { id: "technical", name: "Technical", text: "Technical (Can't be a Big Bot)" },
                      { id: "combat", name: "Combat", effects: [{ stat: "WS", add: 20 }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { name: "Equipment", effects: [{ id: "tool", pick: 1, from: [{ item: "wrench" }, { item: "drill" }] }] },
      { name: "Alignment", effects: [{ id: "alignment", alignment: ["Neutral"] }] },
    ],
  },
];
const E = compendium("eng", ENGINE);
const rec = (patch: Partial<CharacterRecord> = {}): CharacterRecord => ({ ...newRecord(["eng"], "engineers", "engineer"), ...patch });
const PRE = "engineers/technical-servitor>@companion>";
const withServitor = (seed = 1) => buildAll(E, rec({ choices: { "engineers/technical-servitor": ["yes"] } }), { mode: "random", roll: seededRoller(seed) });

test("companion: built as its archetype with its option, its dice and choices kept in the character's record under its key", () => {
  const b = withServitor();
  assert.equal(b.companions.length, 1);
  const m = b.companions[0];
  assert.equal(m.key, "engineers/technical-servitor>@companion");
  assert.equal(m.name, "Technical Bot", "the book's name: option and characters");
  const ch = m.result.character;
  assert.deepEqual([ch.archetype.id, ch.subtype.id, ch.name], ["bots", "bot", "Technical Bot"]);
  assert.deepEqual(ch.options.map((o) => o.id), ["technical"]);
  assert.equal(ch.stats.WS.base, 25 + b.record.dice[`${PRE}bots/@stats:WS`][0], "its own stat line, rolled");
  assert.ok(["wrench", "drill"].includes(ch.items[0]?.id));
  assert.deepEqual(b.record.choices[`${PRE}bots/tool`], [`item:${ch.items[0].id}`]);
  // The option's choices are the companion effect's: made every build, not stored.
  assert.equal(b.record.choices[`${PRE}bots/type`], undefined);
  assert.equal(b.record.choices[`${PRE}bots/bot-type`], undefined);
  assert.ok(!b.log.some((e) => e.key === `${PRE}bots/type` || e.key === `${PRE}bots/bot-type`));
  // The character itself is what build() makes of the record.
  assert.deepEqual(b.character, build(E, b.record, { mode: "random", roll: noRolls }).character);
});

test("companion: replaying the record rolls nothing and rebuilds both exactly", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const b = withServitor(seed);
    const again = buildAll(E, b.record, { mode: "random", roll: noRolls });
    assert.deepEqual(again.record, b.record);
    assert.deepEqual(again.companions.map((m) => m.result.character), b.companions.map((m) => m.result.character));
    assert.deepEqual(buildAll(E, b.record, { mode: "freeform", roll: noRolls }).pending, []);
  }
});

test("companion: its rolls sit under the decision that gave it; re-rolling that clears them, re-rolling one of them keeps the rest", () => {
  const b = withServitor(2);
  const i = b.log.findIndex((e) => e.key === "engineers/technical-servitor");
  assert.ok(b.log[i + 1].key.startsWith(PRE), "right after the optional");
  assert.equal(b.log[i + 1].parent, "engineers/technical-servitor");
  // Re-rolling one of its dice.
  const ws = `${PRE}bots/@stats:WS`;
  const r = ops.rerollDecision(E, b.record, ws, { roll: () => 7 });
  assert.deepEqual(r.dice[ws], [7]);
  assert.deepEqual(r.choices[`${PRE}bots/tool`], b.record.choices[`${PRE}bots/tool`]);
  assert.deepEqual(r.dice["engineers/@stats:WS"], b.record.dice["engineers/@stats:WS"]);
  // Declining the servitor drops all of it.
  const no = ops.choose(E, b.record, "engineers/technical-servitor", ["no"]);
  assert.ok(!Object.keys({ ...no.dice, ...no.choices }).some((k) => k.startsWith(PRE)));
  assert.deepEqual(ops.view(E, no).companions, []);
  assert.ok(!Object.keys(reroll(E, b.record, "engineers/technical-servitor").dice).some((k) => k.startsWith(PRE)));
});

test("companion: freeform leaves its choices open with the character's, under its key; choosing one keeps it", () => {
  const f = ops.view(E, rec({ choices: { "engineers/technical-servitor": ["yes"], "engineers/alignment": ["Puritan"] } }));
  const p = f.pending.find((x) => x.key === `${PRE}bots/tool`);
  assert.ok(p, "the companion's pick is open");
  assert.equal(p.parent, "engineers/technical-servitor");
  const r = ops.choose(E, f.record, p.key, ["item:drill"]);
  const v = ops.view(E, r);
  assert.deepEqual(v.companions[0].result.character.items.map((t) => t.id), ["drill"]);
  assert.ok(!v.pending.some((x) => x.key === p.key));
  // Filled at random, the rest is made under the same keys.
  const filled = ops.fillPending(E, r, { roll: seededRoller(3) });
  assert.deepEqual(ops.view(E, filled).pending, []);
});

test("companion: the optional is labelled by the book's name; the character's sheet names it under Other Equipment", () => {
  const open = build(E, rec(), { mode: "freeform", roll: () => 1 }).pending.find((x) => x.key === "engineers/technical-servitor");
  assert.equal(open?.options.find((o) => o.id === "yes")?.label, "Technical Bot");
  const b = withServitor();
  const { sheet, refs } = sheetParts(b.character, E);
  assert.deepEqual(sheet.other, ["Techno-mat", "Technical Bot"]);
  assert.equal(refs.other[1].fixed, true, "not removable by itself");
  const none = buildAll(E, rec({ choices: { "engineers/technical-servitor": ["no"] } }), { mode: "random", roll: seededRoller(1) });
  assert.deepEqual(toSheetCharacter(none.character, E).other, ["Techno-mat"]);
});

test("companion: its own GM sheet follows the character's, in the Word export too", async () => {
  const b = withServitor();
  const sheets = characterSheets({ ...b, character: { ...b.character, name: "Magos Vel" } }, E);
  assert.deepEqual(sheets.map((s) => s.name), ["Magos Vel", "Technical Bot"]);
  assert.equal(sheets[1].tagLine, "Bot, Technical, Neutral");
  assert.equal(sheets[1].starting.WS, String(b.companions[0].result.character.stats.WS.final));
  const template = readFileSync(new URL("../src/client/export/sheet-template.docx", import.meta.url));
  const docx = await renderSheetDocx(sheets, template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength));
  const xml = unzip(docx, "word/document.xml");
  assert.ok(xml.indexOf("Magos Vel") >= 0 && xml.indexOf("Technical Bot") > xml.indexOf("Magos Vel"));
  assert.ok(xml.includes("Bot, Technical, Neutral"));
});

/** One file of a zip (stored or deflated). */
function unzip(zip: Uint8Array, name: string): string {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  let at = dv.getUint32(eocd + 16, true);
  for (let n = dv.getUint16(eocd + 10, true); n > 0; n--) {
    const method = dv.getUint16(at + 10, true);
    const size = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extra = dv.getUint16(at + 30, true);
    const comment = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const fname = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    if (fname === name) {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = zip.subarray(start, start + size);
      return new TextDecoder().decode(method === 0 ? data : inflateRawSync(data));
    }
    at += 46 + nameLen + extra + comment;
  }
  throw new Error(`no ${name}`);
}

test("description line: options a rule chose (p. 83's Chaos discipline) after the archetype's own", () => {
  const c = compendium("chaos", [
    {
      id: "marines", kind: "archetype", name: "Marines", characters: "Marine", source: { page: 1 },
      subtypes: [{ id: "marine", name: "Space Marine", stats: stats("50") }],
      sections: [
        { name: "Options", effects: [{ id: "option", pick: 1, from: [{ id: "chaos-marine", name: "Chaos Marine" }] }] },
        { name: "Alignment", effects: [{ id: "alignment", alignment: ["Chaos"] }] },
      ],
    },
    {
      id: "chaos-powers", kind: "rule", name: "Generating Random Chaos Powers", source: { page: 83 }, text: "Choose a discipline.", apply: true,
      effects: [{ id: "discipline", pick: 1, from: [{ id: "undivided", name: "Chaos Undivided" }, { id: "nurgle", name: "Nurgle" }] }],
    },
  ]);
  const b = build(c, { ...newRecord(["chaos"], "marines", "marine"), choices: { "chaos-powers/discipline": ["undivided"], "marines/alignment": ["Chaos"] } }, { mode: "random", roll: seededRoller(1) });
  assert.equal(toSheetCharacter(b.character, c).tagLine, "Marine, Space Marine, Chaos Marine, Chaos Undivided, Chaos");
});

// Occupation: each pick labelled by its own book heading; "Role" only for the Inquisitor's Belief Faction; never two alike.
const OCC = compendium("occ", [
  {
    id: "inquisitor", kind: "archetype", name: "Inquisitors", characters: "Inquisitor", source: { page: 4 },
    subtypes: [{ id: "fighter", name: "Fighter", stats: stats("50") }],
    sections: [
      { name: "Alignment", effects: [{ id: "alignment", alignment: ["Puritan"] }] },
      { name: "Belief Faction", effects: [{ id: "puritan-faction", pick: 1, from: [{ id: "amalathian", name: "Amalathian" }, { id: "thorian", name: "Thorian" }] }] },
    ],
  },
  {
    id: "followers", kind: "archetype", name: "Followers", characters: "Follower", source: { page: 1 },
    subtypes: [{ id: "follower", name: "Follower", stats: stats("50") }],
    sections: [
      {
        name: "Rank",
        effects: [
          {
            id: "rank",
            pick: 1,
            from: [
              { id: "rank-5", name: "Rank 5", text: "No modification" },
              { id: "rank-6", name: "Rank 6", text: "Rare item or extra Bonus" },
            ],
          },
          {
            when: { option: ["rank-6"] },
            then: [{ id: "rank-6-choice", pick: 1, from: [{ id: "rare-item", name: "Rare item" }, { id: "extra-bonus", name: "extra Bonus" }] }],
          },
        ],
      },
      { name: "Backgrounds", effects: [{ id: "background", pick: 1, from: [{ id: "agitator", name: "Agitator" }, { id: "brawler", name: "Brawler" }] }] },
      { name: "Equipment", effects: [{ id: "kit", pick: 1, from: [{ id: "auspex", name: "Auspex" }, { id: "lamp", name: "Lamp" }] }] },
      { name: "Alignment", effects: [{ id: "alignment", alignment: ["Neutral"] }] },
    ],
  },
]);

test("occupation: each pick by its own heading; Role for the Belief Faction; a follow-up under a used heading by its option's book text", () => {
  const labels = (archetype: string, sub: string, choices: Record<string, string[]>) => {
    const r = { ...newRecord(["occ"], archetype, sub), choices };
    const v = ops.view(OCC, r);
    return occupationPicks(OCC, v.record, v).map((p) => p.label);
  };
  assert.deepEqual(labels("inquisitor", "fighter", { "inquisitor/alignment": ["Puritan"], "inquisitor/puritan-faction": ["thorian"] }), ["Role"]);
  const f = labels("followers", "follower", { "followers/rank": ["rank-6"], "followers/rank-6-choice": ["extra-bonus"], "followers/background": ["agitator"], "followers/kit": ["lamp"], "followers/alignment": ["Neutral"] });
  assert.deepEqual(f, ["Rank", "Rare item or extra Bonus", "Backgrounds", "Equipment"]);
  assert.equal(new Set(f).size, f.length);
});
