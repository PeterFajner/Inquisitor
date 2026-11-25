// Open picks actually filled (engine:open-picks). A random character takes
// none of a "pick any" and 0..N of "up to N" (ENGINE.md), and Occupation
// only drives picks of one, so what a player takes there ("any Common gear
// of their choosing", "up to two Rare weapons") is never built otherwise.
// For each open pick a random character meets: one option, two, and the
// most allowed, then the whole list in threes (so every option is taken at
// least once, a Chainblade with no basic weapon among them), each followed
// by "choose at random" for what it opens: a whole character that keeps the
// choice, owns what was picked and replays.
import * as ops from "../../../src/client/builder/ops.ts";
import type { CharacterRecord } from "../../../src/shared/engine/record.ts";
import { seededRoller } from "../../../src/shared/engine/rng.ts";
import type { Report, Repro } from "../lib/report.ts";
import { archetype, archetypeIds, realCompendium } from "../lib/rules.ts";
import type { RunOptions } from "../shards.ts";
import { checkCharacter, gearPolicies, leafOf, norm, openPickBounds, ownedAll, randomBuild, replay } from "./archetype.ts";

export async function engineOpenPicks(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  const bounds = openPickBounds(c);
  for (const archId of archetypeIds()) {
    const arch = archetype(archId);
    const gear = gearPolicies(arch);
    for (const sub of arch.subtypes) {
      // The first seed that meets each open pick.
      const met = new Map<string, number>();
      for (let seed = 1; seed <= 20; seed++) {
        const b = randomBuild(c, archId, sub.id, seed);
        for (const k of Object.keys(b.record.choices)) if (bounds.has(leafOf(k)) && !met.has(k)) met.set(k, seed);
      }
      for (const [key, seed] of met) {
        const b = randomBuild(c, archId, sub.id, seed);
        const p = ops.choiceOptions(c, b.record, key);
        if (!p) continue;
        const ids = p.options.map((x) => x.id);
        const most = Math.min(p.count, ids.length);
        const sets: string[][] = [];
        if (ids.length) sets.push([ids[0]]);
        if (most >= 2) sets.push(ids.slice(1, 3).length === 2 ? ids.slice(1, 3) : ids.slice(0, 2));
        if (most >= 1) sets.push(ids.slice(0, most));
        // every option at least once, in threes (or fewer, when the most allowed is fewer)
        const step = Math.max(1, Math.min(3, most));
        for (let i = 0; i < ids.length; i += step) sets.push(ids.slice(i, i + step));
        let n = 0;
        for (const chosen of sets) {
          n++;
          const rep: Repro = { archetype: archId, subtype: sub.id, seed, key, record: b.record, steps: [`random build seededRoller(${seed})`, `choose(${JSON.stringify(key)}, ${JSON.stringify(chosen)})`, `fillPending() with seededRoller(${7_300_000 + n})`] };
          let next: CharacterRecord;
          try {
            next = ops.fillPending(c, ops.choose(c, b.record, key, chosen, { roll: seededRoller(7_200_000 + n) }), { roll: seededRoller(7_300_000 + n) });
          } catch (e) {
            r.fail("an open pick filled doesn't throw", String((e as Error).stack ?? e).slice(0, 800), rep, `${norm(key)}: ${(e as Error).message}`);
            continue;
          }
          const nb = replay(r, c, next, { ...rep, record: next }, "open pick filled");
          // (the bound on what a random character takes doesn't hold for a player's own choice)
          const mine = new Map(bounds);
          mine.delete(leafOf(key));
          checkCharacter(r, c, arch, nb, { ...rep, record: next }, "after an open pick filled", mine, gear);
          r.expect(JSON.stringify(next.choices[key]) === JSON.stringify(chosen), "an open pick keeps what was taken", `${key}: ${JSON.stringify(next.choices[key])}, took ${JSON.stringify(chosen)}`, { ...rep, record: next }, norm(key));
          // What was taken is owned (a grant or pool entry: "<kind>:<id>" or the entry id).
          for (const id of chosen) {
            const [kind, x] = id.includes(":") ? id.split(":") : [null, id];
            // (or put into one of its things: stimms into an injector)
            const owned =
              ownedAll(nb.character).some((t) => (t.id === x && (!kind || t.kind === kind)) || (t.chosen ?? []).some((ch) => ch.id === x)) || nb.character.options.some((op) => op.id === id);
            r.expect(owned, "what an open pick takes is the character's", `${key}: ${id} not on the character`, { ...rep, record: next }, `${norm(key)}: ${id}`);
          }
        }
      }
    }
  }
}
