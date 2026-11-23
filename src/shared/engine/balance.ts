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
  /** Every simulated score, ascending (the label is a percentile rank among them). */
  scores: number[];
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
    scores: sorted.map(r),
  };
}

/** The share of rolls at either end that's labelled over- or underpowered. */
export const BALANCE_TAIL = 0.05;

export type BalanceLabel = {
  word: "underpowered" | "balanced" | "overpowered";
  /** The end of the distribution the character is nearer to, and the share (0–1) of random characters scoring at least (top) or at most (bottom) as much, the character counted among them. */
  end: "top" | "bottom";
  share: number;
};

// How many sorted scores are < x (lower) or <= x (upper).
const bound = (sorted: number[], x: number, upper: boolean): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (upper ? sorted[mid] <= x : sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Where a score falls among the simulated ones: in the top or bottom BALANCE_TAIL it's over- or underpowered. */
export function label(score: number, dist: Pick<Distribution, "scores">): BalanceLabel {
  const s = dist.scores;
  const n = s.length;
  // the character is one more random character: (others at least as good + itself) / (n + 1)
  const top = (n - bound(s, score, false) + 1) / (n + 1);
  const bottom = (bound(s, score, true) + 1) / (n + 1);
  const word = top <= BALANCE_TAIL ? "overpowered" : bottom <= BALANCE_TAIL ? "underpowered" : "balanced";
  return top <= bottom ? { word, end: "top", share: top } : { word, end: "bottom", share: bottom };
}

/** A share as the label prints it: one decimal under 10% ("1.5%"), whole numbers above ("40%"). */
export function percent(share: number): string {
  const p = share * 100;
  if (p < 10) return `${Math.max(0.1, Math.round(p * 10) / 10)}%`;
  return `${Math.min(100, Math.round(p))}%`;
}

/** "Inquisitor Fighters", "Chrono-gladiators": the plural of a name's last word. */
export function plural(name: string): string {
  return name.replace(/(\w+)$/, (w) =>
    /(s|x|z|ch|sh)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : /man$/i.test(w) ? `${w.slice(0, -3)}men` : `${w}s`,
  );
}

/** "This character is in the top 1.5% of randomly-rolled Inquisitor Fighters." (the approved form) */
export function labelText(l: BalanceLabel, who: string): string {
  return `This character is in the ${l.end} ${percent(l.share)} of randomly-rolled ${plural(who)}.`;
}
