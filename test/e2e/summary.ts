// Prints the findings in a results directory, grouped by check:
//   node test/e2e/summary.ts [results dir] [--full]
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ShardResult } from "./lib/report.ts";
import { ROOT } from "./lib/rules.ts";

const dir = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(ROOT, ".e2e/results"));
const full = process.argv.includes("--full");
const results = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ShardResult);

const byCheck = new Map<string, { shard: string; message: string; count: number; repro: unknown }[]>();
for (const r of results) {
  if (r.error) console.log(`ERROR ${r.shard}: ${r.error.split("\n").slice(0, full ? 12 : 3).join("\n  ")}`);
  for (const f of r.failures) byCheck.set(f.check, [...(byCheck.get(f.check) ?? []), { shard: r.shard, message: f.message, count: f.count, repro: f.repro }]);
}
const passed = results.filter((r) => r.status === "passed").length;
console.log(`${results.length} shards: ${passed} passed, ${results.length - passed} failed or errored\n`);
for (const [check, fs] of [...byCheck].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${check} (${fs.length})`);
  for (const f of fs) {
    console.log(`  - ${f.shard}: ${f.message.split("\n")[0].slice(0, full ? 2000 : 260)}${f.count > 1 ? ` (×${f.count})` : ""}`);
    if (full) console.log(`    repro: ${JSON.stringify(f.repro).slice(0, 1500)}`);
  }
}
