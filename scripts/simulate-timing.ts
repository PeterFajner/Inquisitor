// Times the full balance calculation: N simulated characters for every
// archetype and subtype of the packs in RULES_DIR. Prints one line per
// archetype/subtype (ms, ms per character) and the totals, writes nothing.
// `node scripts/simulate-timing.ts [--n=10000]` (or the compiled
// dist/scripts/simulate-timing.js on the server).
import { loadAllPacksIsolated } from "../src/lib/rules-files.ts";
import { buildCompendium, withoutHidden } from "../src/shared/rules/compendium.ts";
import { simulate } from "../src/shared/engine/balance.ts";

const a = process.argv.find((x) => x.startsWith("--n="));
const n = a ? Number(a.slice(4)) : 10_000;
const t0 = performance.now();
const c = buildCompendium(withoutHidden(loadAllPacksIsolated()));
console.log(`load ${Math.round(performance.now() - t0)} ms`);
const rows: [string, number][] = [];
let failed = 0;
for (const arch of [...c.archetypes.values()].sort((x, y) => x.id.localeCompare(y.id))) {
  for (const s of arch.subtypes) {
    const t = performance.now();
    try {
      simulate(c, arch.id, s.id, n, 1);
    } catch (e) {
      failed++;
      console.log(`${arch.id}/${s.id}: failed (${(e as Error).message.slice(0, 80)})`);
      continue;
    }
    const ms = performance.now() - t;
    rows.push([`${arch.id}/${s.id}`, ms]);
    console.log(`${arch.id}/${s.id}: ${Math.round(ms)} ms (${(ms / n).toFixed(3)} ms/character)`);
  }
}
const total = rows.reduce((x, [, ms]) => x + ms, 0);
const sorted = rows.map(([, ms]) => ms).sort((x, y) => x - y);
console.log(`\n${rows.length} archetype/subtypes × ${n}: total ${(total / 1000).toFixed(1)} s; median ${Math.round(sorted[sorted.length >> 1])} ms, max ${Math.round(sorted[sorted.length - 1])} ms (${rows.find(([, ms]) => ms === sorted[sorted.length - 1])?.[0]}); failed ${failed}; peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
