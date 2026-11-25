// The end-to-end suite (test/e2e/README.md):
//
//   npm run e2e -- --list-shards           every shard id, one per line
//   npm run e2e -- --shard engine:inquisitor [--shard …]
//   npm run e2e -- --shard 'engine:*'      a glob of shard ids
//   npm run e2e -- --all [--jobs 3]        every shard, a few at a time (child processes)
//
// Options: --results <dir> (default .e2e/results), --seeds N (random
// characters per subtype, default 300), --reroll-seeds N (150), --few N
// (seeds for the slower checks, 12), --ui-seeds N (seeded characters a UI
// shard opens per subtype, 4). Each shard writes <results>/<shard>.json;
// the exit code is 1 when any failed.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Report, fileName, type ShardResult } from "./lib/report.ts";
import { ROOT } from "./lib/rules.ts";
import { killAll } from "./lib/procs.ts";
import { shards } from "./shards.ts";

Error.stackTraceLimit = 60;
const { values: a } = parseArgs({
  options: {
    "list-shards": { type: "boolean" },
    shard: { type: "string", multiple: true },
    all: { type: "boolean" },
    jobs: { type: "string", default: "2" },
    results: { type: "string", default: join(ROOT, ".e2e/results") },
    seeds: { type: "string", default: "300" },
    "reroll-seeds": { type: "string", default: "150" },
    few: { type: "string", default: "12" },
    "ui-seeds": { type: "string", default: "4" },
  },
});

const all = shards();
if (a["list-shards"]) {
  for (const s of all) console.log(s.id);
  process.exit(0);
}

const glob = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
const wanted = a.all ? all : all.filter((s) => (a.shard ?? []).some((p) => glob(p).test(s.id)));
if (!wanted.length) {
  console.error("no shard: --list-shards lists them; --shard <id> runs one");
  process.exit(2);
}
const results = resolve(a.results!);
const opts = {
  results,
  seeds: Number(a.seeds),
  rerollSeeds: Number(a["reroll-seeds"]),
  fewSeeds: Number(a.few),
  uiSeeds: Number(a["ui-seeds"]),
};

let failed = false;
const line = (r: ShardResult) =>
  `${r.status === "passed" ? "PASS" : r.status === "failed" ? "FAIL" : "ERROR"} ${r.shard} (${(r.durationMs / 1000).toFixed(1)} s): ${Object.values(r.passed).reduce((x, y) => x + y, 0)} checks passed, ${r.failures.length} findings${r.error ? `; ${r.error.split("\n")[0]}` : ""}`;

if (wanted.length === 1 || !a.all) {
  // In this process, one after another.
  for (const s of wanted) {
    const r = new Report(s.id);
    try {
      await s.run(r, opts);
    } catch (e) {
      r.error = String((e as Error).stack ?? e);
    }
    const file = r.write(results);
    const res = r.result();
    console.log(line(res));
    for (const f of res.failures) console.log(`  - [${f.check}] ${f.message.split("\n")[0].slice(0, 300)}${f.count > 1 ? ` (×${f.count})` : ""}`);
    console.log(`  → ${file}`);
    if (res.status !== "passed") failed = true;
  }
} else {
  // --all: each shard in its own process, `jobs` at a time.
  const queue = [...wanted];
  const jobs = Math.max(1, Number(a.jobs));
  const runOne = (id: string) =>
    new Promise<void>((done) => {
      const args = [process.execPath, "--disable-warning=ExperimentalWarning", join(import.meta.dirname, "run.ts"), "--shard", id, "--results", results, "--seeds", a.seeds!, "--reroll-seeds", a["reroll-seeds"]!, "--few", a.few!, "--ui-seeds", a["ui-seeds"]!];
      const p = spawn(args[0], args.slice(1), { stdio: ["ignore", "ignore", "inherit"] });
      p.on("exit", () => {
        try {
          const res = JSON.parse(readFileSync(join(results, `${fileName(id)}.json`), "utf8")) as ShardResult;
          console.log(line(res));
          if (res.status !== "passed") failed = true;
        } catch {
          console.log(`ERROR ${id}: no result`);
          failed = true;
        }
        done();
      });
    });
  await Promise.all(Array.from({ length: jobs }, async () => {
    for (let id = queue.shift()?.id; id; id = queue.shift()?.id) await runOne(id);
  }));
}
await killAll();
process.exit(failed ? 1 : 0);
