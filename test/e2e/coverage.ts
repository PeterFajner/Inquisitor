// The coverage report: table rows, things and named options no shard's
// characters reached (random builds, re-rolls, fills, open picks, trades).
//   node test/e2e/coverage.ts [results dir] [--full]
// Rows reachable only through rare nested tables, and things only a choice
// can give (open picks, overrides), are expected here; anything else is a
// rule the suite never exercises.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { universe } from "./lib/coverage.ts";
import type { ShardResult } from "./lib/report.ts";
import { realCompendium, ROOT } from "./lib/rules.ts";

const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(ROOT, ".e2e/results"));
const full = process.argv.includes("--full");
const results = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ShardResult);
const reached = new Set(results.flatMap((r) => r.coverage ?? []));
const all = universe(realCompendium());
const missing = [...all].filter(([k]) => !reached.has(k));
const byKind = new Map<string, string[]>();
for (const [k, name] of missing) {
  const kind = k.split(":")[0];
  byKind.set(kind, [...(byKind.get(kind) ?? []), name]);
}
const engineShards = results.filter((r) => r.shard.startsWith("engine:")).length;
console.log(`coverage over ${results.length} shard results (${engineShards} engine): ${all.size - missing.length} of ${all.size} reached`);
for (const [kind, names] of [...byKind].sort()) {
  const total = [...all.keys()].filter((k) => k.startsWith(`${kind}:`)).length;
  console.log(`\n## never reached: ${kind} (${names.length} of ${total})`);
  for (const n of names.sort().slice(0, full ? Infinity : 40)) console.log(`  - ${n}`);
  if (!full && names.length > 40) console.log(`  … ${names.length - 40} more (--full)`);
}
