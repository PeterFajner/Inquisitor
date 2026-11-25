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
  /** What the shard's characters reached (table rows, things, named options): for the coverage report (coverage.ts). */
  coverage?: string[];
};

export class Report {
  readonly shard: string;
  readonly started = new Date();
  passed: Record<string, number> = {};
  failures = new Map<string, Failure>();
  notes: string[] = [];
  error?: string;
  coverage = new Set<string>();

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

  private noted = new Map<string, number>();

  /** A note once (by its text); one with examples (", e.g. …") at most 5 times, then counted. */
  note(s: string): void {
    if (this.notes.includes(s)) return;
    const kind = s.split(", e.g.")[0];
    const n = (this.noted.get(kind) ?? 0) + 1;
    this.noted.set(kind, n);
    if (kind === s || n <= 5) this.notes.push(s);
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
      notes: [...this.notes, ...[...this.noted].filter(([, n]) => n > 5).map(([kind, n]) => `${kind}: ${n} times in all`)],
      ...(this.coverage.size ? { coverage: [...this.coverage].sort() } : {}),
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
