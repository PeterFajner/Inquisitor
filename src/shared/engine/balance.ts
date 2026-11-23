// Balance: a character's power score against simulated characters of the
// same archetype and subtype.
import type { Compendium } from "../rules/compendium.ts";
import { STATS } from "../rules/schema.ts";
import { build, type Character } from "./build.ts";
import { newRecord } from "./record.ts";
import { seededRoller } from "./rng.ts";

/** Sum of final stats + points of everything the character has (× qty for items). */
export function powerScore(ch: Character, c: Compendium): number {
  let s = 0;
  for (const st of STATS) s += ch.stats[st].final;
  const pts = (p: number | undefined) => p ?? 0;
  for (const t of ch.talents) s += pts(c.talents.get(t.id)?.points);
  for (const t of ch.exotics) s += pts(c.exotics.get(t.id)?.points);
  for (const t of ch.mutations) s += pts(c.mutations.get(t.id)?.points);
  for (const t of ch.powers) s += pts(c.powers.get(t.id)?.points);
  for (const t of ch.items) s += pts(c.items.get(t.id)?.points) * t.qty;
  return s;
}

export type Distribution = {
  archetype: string;
  subtype: string;
  n: number;
  seed: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
};

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** The power-score distribution of `n` random characters (seeded). */
export function simulate(c: Compendium, archetype: string, subtype: string, n: number, seed: number): Distribution {
  const roll = seededRoller(seed);
  const packs = c.packs.map((p) => p.id);
  const scores: number[] = [];
  for (let i = 0; i < n; i++) {
    const { character } = build(c, newRecord(packs, archetype, subtype), { mode: "random", roll });
    scores.push(powerScore(character, c));
  }
  return summarize(archetype, subtype, seed, scores);
}

export function summarize(archetype: string, subtype: string, seed: number, scores: number[]): Distribution {
  const n = scores.length;
  const sorted = [...scores].sort((a, b) => a - b);
  const mean = n ? scores.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    archetype,
    subtype,
    n,
    seed,
    mean: r(mean),
    median: r(quantile(sorted, 0.5)),
    sd: r(sd),
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    p10: r(quantile(sorted, 0.1)),
    p25: r(quantile(sorted, 0.25)),
    p75: r(quantile(sorted, 0.75)),
    p90: r(quantile(sorted, 0.9)),
  };
}

export type BalanceLabel = { word: "underpowered" | "balanced" | "overpowered"; sigma: number };

/** σ from the median; within ±1σ is balanced. */
export function label(score: number, dist: Pick<Distribution, "median" | "sd">): BalanceLabel {
  const raw = dist.sd > 0 ? (score - dist.median) / dist.sd : 0;
  const word = raw > 1 ? "overpowered" : raw < -1 ? "underpowered" : "balanced";
  return { word, sigma: Math.round(raw * 10) / 10 };
}
