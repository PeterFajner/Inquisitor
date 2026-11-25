// Rules changes against saved characters (engine:rules-update): for every
// archetype, random characters built under the real rules, then the rules
// changed two ways (a stat line's dice, a new pick added; the entries a
// character uses changed: engine/rules-entries.ts); diff() must say what changes and
// updateRules() must make a whole character: no open choices when made at
// random, the new decisions left open otherwise, a record that replays.
import * as ops from "../../../src/client/builder/ops.ts";
import { build, type RollFn } from "../../../src/shared/engine/build.ts";
import { diff } from "../../../src/shared/engine/diff.ts";
import { seededRoller } from "../../../src/shared/engine/rng.ts";
import type { Compendium } from "../../../src/shared/rules/compendium.ts";
import type { Archetype } from "../../../src/shared/rules/schema.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium } from "../lib/rules.ts";
import type { RunOptions } from "../shards.ts";
import { firstDiff, randomBuild } from "./archetype.ts";

const THROW: RollFn = () => {
  throw new Error("rolled a die the record should have had");
};

/** The compendium with one archetype replaced (a new map: the engine caches per map). */
const withArchetype = (c: Compendium, a: Archetype): Compendium => ({ ...c, archetypes: new Map(c.archetypes).set(a.id, a) });

type Change = { name: string; make(a: Archetype): Archetype | null; newKey?: string };
const CHANGES: Change[] = [
  {
    name: "a stat line's dice changed (D10 → D6)",
    make: (a) => {
      const x = structuredClone(a);
      let changed = false;
      for (const s of x.subtypes) for (const [k, v] of Object.entries(s.stats)) if (typeof v === "string" && v.includes("D10")) {
        (s.stats as Record<string, unknown>)[k] = v.replace(/D10/g, "D6");
        changed = true;
      }
      return changed ? x : null;
    },
  },
  {
    name: "a new pick added",
    newKey: "e2e-new-pick",
    make: (a) => {
      const x = structuredClone(a);
      const sec = x.sections[x.sections.length - 1];
      sec.effects = [...sec.effects, { id: "e2e-new-pick", pick: 1, from: [{ talent: "dodge" }, { talent: "catfall" }, { talent: "medic" }] } as never];
      return x;
    },
  },
];

export async function engineGlobal(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  const seeds = Math.min(o.fewSeeds, 20);
  for (const a of [...c.archetypes.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    for (const ch of CHANGES) {
      const changed = ch.make(a);
      if (!changed) continue;
      const nc = withArchetype(c, changed);
      for (const sub of a.subtypes) {
        for (let seed = 1; seed <= seeds; seed++) {
          const b = randomBuild(c, a.id, sub.id, seed);
          const rep: Repro = { archetype: a.id, subtype: sub.id, seed, record: b.record, steps: [`random build seededRoller(${seed})`, `rules: ${ch.name}`, "updateRules"] };
          const d = diff(c, nc, b.record);
          if (ch.newKey) {
            r.expect(d.changed && d.pending.length > 0, "diff names the new choice", JSON.stringify(d).slice(0, 300), rep, `${ch.name}`);
          } else if (Object.entries(b.record.dice).some(([k, f]) => k.includes("/@stats:") && f.some((x) => x > 6))) {
            // Faces past 6 no longer fit a D6: rolled again.
            r.expect(d.changed && d.needsRolling.length + d.stats.length > 0, "diff names what must be rolled again", JSON.stringify(d).slice(0, 300), rep, ch.name);
          }
          try {
            const up = ops.updateRules(nc, b.record, "e2e-v2", true, seededRoller(8_000_000 + seed));
            let nb;
            try {
              nb = build(nc, up, { mode: "freeform", roll: THROW });
              r.pass("updated record replays without rolling");
            } catch (e) {
              r.fail("updated record replays without rolling", String((e as Error).message), { ...rep, record: up }, `${a.id}: ${ch.name}`);
              continue;
            }
            r.expect(!nb.pending.length, "update made at random leaves no open choices", nb.pending.map((p) => p.key).join(", "), { ...rep, record: up }, `${a.id}: ${ch.name}`);
            if (ch.newKey) r.expect(!!up.choices[`${a.id}/${ch.newKey}`], "update makes the new choice", JSON.stringify(Object.keys(up.choices)), rep, a.id);
            // A new pick changes nothing already chosen.
            if (ch.newKey)
              for (const [k, v] of Object.entries(b.record.choices))
                if (JSON.stringify(up.choices[k]) !== JSON.stringify(v)) r.fail("update keeps the other choices", `${k}: ${JSON.stringify(v)} → ${JSON.stringify(up.choices[k])}`, rep, `${a.id}: ${k.replace(/#\d+|~\d+/g, "#N")}`);
            // Not made at random: the new choice is left open.
            if (ch.newKey) {
              const open = ops.updateRules(nc, b.record, "e2e-v2", false, seededRoller(9_000_000 + seed));
              const ob = ops.view(nc, open);
              r.expect(ob.pending.some((p) => p.key === `${a.id}/${ch.newKey}`), "update not at random leaves the new choice open", ob.pending.map((p) => p.key).join(", "), rep, a.id);
            }
            // Unchanged rules: the same character.
            const same = ops.updateRules(c, b.record, "e2e-v2", true, THROW);
            const sb = build(c, same, { mode: "freeform", roll: THROW });
            r.expect(!firstDiff(b.character, sb.character), "update to the same rules is the same character", firstDiff(b.character, sb.character), rep, a.id);
          } catch (e) {
            r.fail("update doesn't throw", String((e as Error).stack ?? e).slice(0, 600), rep, `${a.id}: ${ch.name}: ${(e as Error).message}`);
          }
        }
      }
    }
  }
}
