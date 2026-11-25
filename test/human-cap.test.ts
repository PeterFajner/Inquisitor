// p3 "Human characters' stats can't surpass 100" (owner and GM, November
// 2026): the roll and what creation adds (boons, tables) are capped; gear,
// exotic abilities and powers add past it; a mutation lifts the cap; an
// archetype with `human: false` has none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "../src/shared/engine/build.ts";
import { newRecord } from "../src/shared/engine/record.ts";
import { buildCompendium } from "../src/shared/rules/compendium.ts";
import { Entry, Pack } from "../src/shared/rules/schema.ts";

const src = { page: 1 };
const stats = { WS: 95, BS: 50, S: 50, T: 50, I: 50, Wp: 50, Sg: 50, Nv: 50, Ld: 50 };
const arch = (id: string, effects: unknown[], x: Record<string, unknown> = {}) => ({
  id, kind: "archetype", name: id, source: src, subtypes: [{ id: "fighter", name: "Fighter", stats }], sections: [{ name: "Equipment", effects }], ...x,
});
const c = buildCompendium([
  {
    pack: Pack.parse({ id: "t", name: "T" }),
    entries: [
      arch("boon", [{ stat: "WS", add: 10 }]),
      arch("cortex", [{ stat: "WS", add: 10 }, { item: "cortex" }]),
      arch("mutant", [{ stat: "WS", add: 10 }, { mutation: "scales" }]),
      arch("alien", [{ stat: "WS", add: 10 }], { human: false }),
      { id: "cortex", kind: "item", name: "Cortex", group: "Bionics & Implants", source: src, effects: [{ stat: "WS", add: 70 }] },
      { id: "scales", kind: "mutation", name: "Scales", source: src, text: "" },
    ].map((e) => Entry.parse(e)),
  },
]);
const ws = (a: string) => build(c, newRecord(["t"], a, "fighter"), { mode: "random", roll: () => 1 }).character.stats.WS;

test("human cap: creation's adds stop at 100, held there", () => {
  const l = ws("boon");
  assert.equal(l.final, 100);
  assert.equal(l.uncapped, 105);
});

test("human cap: gear adds past it, and nothing is held at 100", () => {
  const l = ws("cortex");
  assert.equal(l.final, 170);
  assert.equal(l.uncapped, undefined);
});

test("human cap: a mutation or human: false lifts it", () => {
  assert.equal(ws("mutant").final, 105);
  assert.equal(ws("alien").final, 105);
});
