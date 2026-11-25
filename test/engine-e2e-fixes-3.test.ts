// The engine bug the third end-to-end run found (test/e2e, November 2026):
// a random trade gave up a Chainblade the character no longer had (it had
// nothing to be mounted on, so its result was rolled again into a Revolver),
// and the Revolver went with it. Against the real rules (data/rules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { build, type RollFn } from "../src/shared/engine/build.ts";
import { newRecord } from "../src/shared/engine/record.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import { loadAllPacks } from "../src/lib/rules-files.ts";
import { buildCompendium, withoutHidden } from "../src/shared/rules/compendium.ts";
import * as ops from "../src/client/builder/ops.ts";

const RULES = process.env.RULES_DIR || join(import.meta.dirname, "../data/rules");
const real = existsSync(join(RULES, "loyalist")) ? buildCompendium(withoutHidden(loadAllPacks(RULES))) : null;
const skip = !real && "no rules";
const R = real!;
const THROW: RollFn = () => {
  throw new Error("rolled a die the record should have had");
};

// imperial-guard/fighter seed 3: gear#4 rolled a Chainblade, with no Basic
// weapon to mount it on, so it was rolled again (gear#4~3, a Revolver)
const traded = () => {
  const b = build(R, newRecord(R.packs.map((p) => p.id), "imperial-guard", "fighter"), { mode: "random", roll: seededRoller(3) });
  return ops.choose(R, b.record, "equipment/reroll#1", ["yes"], { roll: seededRoller(7_000_003) });
};
const gk = "equipment/reroll#1:give";

test("real rules: a random trade never gives up a Chainblade rolled again for having nothing to mount it on", { skip }, () => {
  const r1 = traded();
  const offered = ops.choiceOptions(R, r1, gk)!.options.map((o) => o.id);
  assert.ok(offered.includes("item:revolver") && !offered.includes("item:chainblade"), offered.join());
  let mounts = 0;
  for (let seed = 7_100_000; seed < 7_100_040; seed++) {
    const r2 = ops.fillPending(R, r1, { roll: seededRoller(seed) });
    const give = r2.choices[gk];
    assert.equal(give?.length, 2, `${seed}`);
    for (const id of give) assert.ok(offered.includes(id), `${seed}: ${id} given, not offered`);
    const after = build(R, r2, { mode: "freeform", roll: THROW });
    assert.deepEqual(after.pending, [], `${seed}`);
    assert.deepEqual(after.warnings, [], `${seed}`);
    // (also when what the trade rolled again is a Basic weapon: gear the
    // trades made doesn't count for gear made before them)
    if (after.character.items.some((i) => i.from.some((f) => f.key?.startsWith("equipment/reroll#1>")) && R.items.get(i.id)?.category === "Basic weapon")) mounts++;
    if (!give.includes("item:revolver")) {
      assert.ok(after.character.items.some((i) => i.id === "revolver"), `${seed}: the Revolver stays`);
      assert.ok(after.character.rolls.some((r) => r.key === "imperial-guard/gear#4~3" && r.label === "Pistol"), `${seed}: its roll stays`);
    }
    assert.ok(!after.character.items.some((i) => i.id === "chainblade"), `${seed}`);
    for (const mode of ["freeform", "random"] as const) {
      assert.deepEqual(build(R, r2, { mode, roll: THROW, pick: () => assert.fail("asked") }).record, r2, `${seed} ${mode}: replays`);
    }
  }
  assert.ok(mounts > 0, "a trade rolled a Basic weapon");
});

test("real rules: a stored give of a Chainblade the character no longer has isn't allowed (a warning; chosen again)", { skip }, () => {
  const r2 = ops.choose(R, traded(), gk, ["item:medi-pack", "item:chainblade"], { roll: seededRoller(5) });
  const after = build(R, r2, { mode: "freeform", roll: THROW });
  assert.ok(after.warnings.includes(`${gk}: stored choice [item:medi-pack, item:chainblade] isn't allowed now; chosen again`), after.warnings.join("\n"));
  assert.ok(after.character.items.some((i) => i.id === "revolver"));
  assert.ok(!after.character.items.some((i) => i.id === "chainblade"));
});
