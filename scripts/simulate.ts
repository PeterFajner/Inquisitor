// Recomputes the balance distributions: for every archetype and subtype of
// the rule packs in RULES_DIR (default data/rules), simulates N random
// characters and writes their power-score distribution to data/balance.json
// (or BALANCE_FILE). `npm run simulate [-- --n=10000 --seed=1 pack…]`.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { listPacks, loadPack, RULES_DIR } from "../src/lib/rules-files.ts";
import { buildCompendium, withoutHidden, type PackEntries } from "../src/shared/rules/compendium.ts";
import { simulate, type Distribution } from "../src/shared/engine/balance.ts";

const flag = (name: string, dflt: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split("=")[1]) : dflt;
};
const n = flag("n", 10000);
const seed = flag("seed", 1);
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const out = process.env.BALANCE_FILE || join(import.meta.dirname, "../data/balance.json");

const ids = args.length ? args : listPacks();
if (!ids.length) {
  console.error(`no packs in ${RULES_DIR}`);
  process.exit(1);
}
const loaded = new Map<string, PackEntries>();
for (const id of ids) {
  const { pack, problems } = loadPack(id);
  for (const p of problems) console.error(`${p.file}: ${p.message}`);
  if (pack) loaded.set(id, pack);
}
// stack packs so each comes after the packs it extends
const stack: PackEntries[] = [];
const visit = (id: string, seen: Set<string>) => {
  const p = loaded.get(id);
  if (!p || stack.includes(p) || seen.has(id)) return;
  seen.add(id);
  for (const dep of p.pack.extends ?? []) visit(dep, seen);
  stack.push(p);
};
for (const id of loaded.keys()) visit(id, new Set());
const c = buildCompendium(withoutHidden(stack)); // hidden entries are never simulated

const distributions: Record<string, Distribution> = {};
const failures: Record<string, string> = {};
const t0 = Date.now();
for (const a of [...c.archetypes.values()].sort((x, y) => x.id.localeCompare(y.id))) {
  for (const s of a.subtypes) {
    const key = `${a.id}/${s.id}`;
    try {
      distributions[key] = simulate(c, a.id, s.id, n, seed);
      const d = distributions[key];
      console.error(`${key}: median ${d.median}, sd ${d.sd}`);
    } catch (e) {
      failures[key] = (e as Error).message;
      console.error(`${key}: ${(e as Error).message}`);
    }
  }
}
writeFileSync(
  out,
  JSON.stringify(
    { generated: new Date().toISOString(), packs: stack.map((p) => p.pack.id), n, seed, distributions, failures },
    null,
    1,
  ) + "\n",
);
console.log(`${Object.keys(distributions).length} distributions in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
