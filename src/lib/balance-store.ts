// The balance distributions, computed on the server: for every archetype and
// subtype, BALANCE_N simulated characters (src/shared/engine/balance.ts),
// worked out once per rules content and shared by everyone.
//
// The simulation runs in a child process (scripts/balance-warm.ts) at the
// lowest CPU priority, so the server itself stays small and responsive. After
// any rules change (checked every WATCH_MS) the child warms up every
// archetype/subtype; one a browser asks for first goes to the front of its
// queue. Results are kept in memory and in data/balance/<key>.json.
//
// The key is a hash of the rules' content without canvas positions, so
// dragging cards around doesn't throw the distributions away.
import { fork, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { setPriority } from "node:os";
import { dirname, join } from "node:path";
import type { Distribution } from "../shared/engine/balance.ts";
import { BALANCE_N, BALANCE_SEED, balanceKey, type FromChild, type ToChild } from "./balance-key.ts";
import { RULES_DIR } from "./rules-files.ts";
import { rulesPayload } from "./rules-store.ts";

const WATCH_MS = 30_000;
/** Kept result files (older rules are of no use). */
const KEEP = 4;
export const BALANCE_DIR = process.env.BALANCE_DIR || join(dirname(RULES_DIR), "balance");

type Results = { key: string; n: number; seed: number; distributions: Record<string, Distribution> };

let results: Results | null = null;
let keyOf: { version: string; key: string } | null = null;
let child: { proc: ChildProcess; key: string } | null = null;
let timer: NodeJS.Timeout | null = null;

function currentKey(): { version: string; key: string } {
  const p = rulesPayload();
  if (keyOf?.version !== p.version) keyOf = { version: p.version, key: balanceKey(p.packs) };
  return keyOf;
}

const fileOf = (key: string) => join(BALANCE_DIR, `${key}.json`);

function resultsFor(key: string): Results {
  if (results?.key === key) return results;
  try {
    const r = JSON.parse(readFileSync(fileOf(key), "utf8")) as Results;
    if (r.key === key) return (results = r);
  } catch {}
  return (results = { key, n: BALANCE_N, seed: BALANCE_SEED, distributions: {} });
}

function save(r: Results): void {
  try {
    mkdirSync(BALANCE_DIR, { recursive: true });
    const tmp = `${fileOf(r.key)}.tmp`;
    writeFileSync(tmp, JSON.stringify(r));
    renameSync(tmp, fileOf(r.key));
    const old = readdirSync(BALANCE_DIR)
      .filter((f) => f.endsWith(".json") && f !== `${r.key}.json`)
      .map((f) => join(BALANCE_DIR, f));
    old.sort((a, b) => mtime(b) - mtime(a));
    for (const f of old.slice(KEEP - 1)) rmSync(f, { force: true });
  } catch (e) {
    console.error(`balance: can't save: ${(e as Error).message}`);
  }
}
const mtime = (f: string) => {
  try {
    return statSync(f).mtimeMs;
  } catch {
    return 0;
  }
};

/** Every archetype/subtype of the current rules. */
function pairs(): string[] {
  const out: string[] = [];
  for (const { entries } of rulesPayload().packs)
    for (const e of entries) if (e.kind === "archetype") for (const s of e.subtypes) out.push(`${e.id}/${s.id}`);
  return [...new Set(out)];
}

const childScript = (): string => {
  // dist/src/lib/balance-store.js -> dist/scripts/balance-warm.js; src/lib/… -> scripts/balance-warm.ts
  const ext = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return join(import.meta.dirname, "../../scripts", `balance-warm.${ext}`);
};

function start(key: string): void {
  stop();
  const proc = fork(childScript(), [key], {
    execArgv: ["--disable-warning=ExperimentalWarning", "--max-old-space-size=96"],
    env: { ...process.env, RULES_DIR },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  try {
    if (proc.pid) setPriority(proc.pid, 19);
  } catch {}
  child = { proc, key };
  proc.on("message", (m: FromChild) => {
    if (m.key !== currentKey().key) return stop(); // the rules changed under it: the watch restarts it
    const r = resultsFor(m.key);
    if (m.pair && m.dist) {
      r.distributions[m.pair] = m.dist;
      save(r);
    } else if (m.pair && m.error) console.error(`balance: ${m.pair}: ${m.error}`);
  });
  proc.on("exit", () => {
    if (child?.proc === proc) child = null;
  });
}

function stop(): void {
  if (child) {
    child.proc.kill();
    child = null;
  }
}

/** Starts (or restarts) the warm-up when the current rules aren't all worked out. */
function check(): void {
  try {
    const { key } = currentKey();
    if (child?.key === key) return;
    const have = resultsFor(key).distributions;
    if (pairs().every((p) => have[p])) return stop();
    start(key);
  } catch (e) {
    console.error(`balance: ${(e as Error).message}`);
  }
}

/** Watch the rules and keep the distributions warm (the server calls this when run directly, not under tests; BALANCE_WARM=0 turns it off). */
export function startBalance(): void {
  if (process.env.BALANCE_WARM === "0" || timer) return;
  check();
  timer = setInterval(check, WATCH_MS);
  timer.unref();
  process.on("exit", stop);
}

/** The distribution for an archetype/subtype of the current rules (version), or "pending" while it's being worked out. */
export function balanceFor(version: string, archetype: string, subtype: string): Distribution | "pending" | "stale" | "unknown" {
  const cur = currentKey();
  if (version !== cur.version) return "stale";
  const pair = `${archetype}/${subtype}`;
  if (!pairs().includes(pair)) return "unknown";
  const d = resultsFor(cur.key).distributions[pair];
  if (d) return d;
  if (!timer) return "pending"; // no warm-up in this process (tests)
  if (child?.key !== cur.key) start(cur.key);
  child?.proc.send({ want: pair } satisfies ToChild);
  return "pending";
}
