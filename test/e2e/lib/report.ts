// One shard's result: the checks that passed (counted by name) and the
// failures, each with a reproduction. Failures with the same check and
// signature are one finding (counted), so a bug hit by 300 seeds is one
// entry with its first reproduction. Written as JSON to the results
// directory (<dir>/<shard id with : and / as _>.json).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Repro = {
  archetype?: string;
  subtype?: string;
  seed?: number;
  key?: string;
  record?: unknown;
  steps?: string[];
  screenshot?: string;
  url?: string;
  [k: string]: unknown;
};

export type Failure = { check: string; message: string; signature: string; count: number; repro: Repro };

export type ShardResult = {
  shard: string;
  status: "passed" | "failed" | "error";
  startedAt: string;
  durationMs: number;
  passed: Record<string, number>;
  failures: Failure[];
  error?: string;
  notes: string[];
};

export class Report {
  readonly shard: string;
  readonly started = new Date();
  passed: Record<string, number> = {};
  failures = new Map<string, Failure>();
  notes: string[] = [];
  error?: string;

  constructor(shard: string) {
    this.shard = shard;
  }

  pass(check: string, n = 1): void {
    this.passed[check] = (this.passed[check] ?? 0) + n;
  }

  /** `signature` groups occurrences of one bug (default: the message). */
  fail(check: string, message: string, repro: Repro = {}, signature = message): void {
    const k = `${check}\0${signature}`;
    const f = this.failures.get(k);
    if (f) f.count++;
    else this.failures.set(k, { check, message, signature, count: 1, repro });
  }

  /** ok → pass, else fail. Returns ok. */
  expect(ok: boolean, check: string, message: string, repro: Repro = {}, signature?: string): boolean {
    if (ok) this.pass(check);
    else this.fail(check, message, repro, signature);
    return ok;
  }

  note(s: string): void {
    this.notes.push(s);
  }

  result(): ShardResult {
    const failures = [...this.failures.values()];
    return {
      shard: this.shard,
      status: this.error ? "error" : failures.length ? "failed" : "passed",
      startedAt: this.started.toISOString(),
      durationMs: Date.now() - this.started.getTime(),
      passed: this.passed,
      failures,
      ...(this.error ? { error: this.error } : {}),
      notes: this.notes,
    };
  }

  write(dir: string): string {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${fileName(this.shard)}.json`);
    writeFileSync(file, JSON.stringify(this.result(), null, 1) + "\n");
    return file;
  }
}

export const fileName = (shard: string): string => shard.replace(/[:/\\]/g, "_");
