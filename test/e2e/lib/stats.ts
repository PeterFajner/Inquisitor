// Comparing two samples of a number (a fresh random character's item count
// against a re-rolled one's). Seeds are fixed, so a result never flakes;
// the threshold is wide so a difference flagged is a real one.

export type Summary = { n: number; mean: number; sd: number; min: number; max: number };

export function summary(xs: number[]): Summary {
  const n = xs.length;
  if (!n) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, sd: Math.sqrt(v), min: Math.min(...xs), max: Math.max(...xs) };
}

/** Welch's z for the difference of the means (0 when both are constant and equal). */
export function welchZ(a: Summary, b: Summary): number {
  const se = Math.sqrt(a.sd ** 2 / a.n + b.sd ** 2 / b.n);
  const d = Math.abs(a.mean - b.mean);
  if (se === 0) return d === 0 ? 0 : Infinity;
  return d / se;
}

/**
 * Two samples differ: means apart by more than `z` standard errors and by
 * more than `floor` in absolute terms (a count off by a tenth isn't a bug).
 */
export function differ(a: number[], b: number[], opts: { z?: number; floor?: number } = {}): { differ: boolean; a: Summary; b: Summary; z: number } {
  const sa = summary(a);
  const sb = summary(b);
  const z = welchZ(sa, sb);
  const floor = opts.floor ?? 0.5;
  return { differ: z > (opts.z ?? 5) && Math.abs(sa.mean - sb.mean) > floor, a: sa, b: sb, z };
}

export const fmt = (s: Summary): string => `mean ${s.mean.toFixed(2)} sd ${s.sd.toFixed(2)} [${s.min}..${s.max}] n=${s.n}`;
