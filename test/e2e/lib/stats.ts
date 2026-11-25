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

// --- counts of categories (option ids, table rows) ---------------------------

/** ln Γ(x) (Lanczos). */
function lnGamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}

/** The regularized upper incomplete gamma Q(a, x) (Numerical Recipes gammq). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const lg = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    for (let ap = a, i = 0; i < 1000; i++) {
      del *= x / ++ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lg);
  }
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lg) * h;
}

/** P(χ² ≥ x) with `df` degrees of freedom. */
export const chiSquareP = (x: number, df: number): number => (df <= 0 ? 1 : gammaQ(df / 2, x / 2));

export type ChiResult = { chi2: number; df: number; p: number; v: number; n: number };

/**
 * Two samples of a category (option ids chosen, rows rolled) come from the
 * same distribution: Pearson's χ² test of homogeneity on the 2×k table,
 * with Cramér's V as the effect size.
 */
export function chiHomogeneity(a: string[], b: string[]): ChiResult {
  const count = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  // Categories seen fewer than 10 times in all are one (χ² needs expected counts of about 5 a cell).
  const both = count([...a, ...b]);
  const lump = (x: string) => ((both.get(x) ?? 0) < 10 ? "\0rare" : x);
  const ca = count(a.map(lump));
  const cb = count(b.map(lump));
  const cats = [...new Set([...ca.keys(), ...cb.keys()])];
  const n = a.length + b.length;
  let chi2 = 0;
  for (const k of cats) {
    const col = (ca.get(k) ?? 0) + (cb.get(k) ?? 0);
    for (const [row, m] of [[a.length, ca], [b.length, cb]] as const) {
      const e = (row * col) / n;
      if (e > 0) chi2 += ((m.get(k) ?? 0) - e) ** 2 / e;
    }
  }
  const df = cats.length - 1;
  return { chi2, df, p: chiSquareP(chi2, df), v: n && df ? Math.sqrt(chi2 / n) : 0, n };
}

/** One sample against the expected shares of each category (goodness of fit). */
export function chiFit(xs: string[], expected: Record<string, number>): ChiResult {
  const total = Object.values(expected).reduce((s, x) => s + x, 0);
  const n = xs.length;
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  let chi2 = 0;
  for (const [k, w] of Object.entries(expected)) {
    const e = (n * w) / total;
    if (e > 0) chi2 += ((m.get(k) ?? 0) - e) ** 2 / e;
  }
  // a category never expected but seen is as far off as can be
  for (const k of m.keys()) if (!(k in expected)) chi2 = Infinity;
  const df = Object.keys(expected).length - 1;
  return { chi2, df, p: chiSquareP(chi2, df), v: n && df ? Math.sqrt(chi2 / (n * df)) : 0, n };
}

/** A difference worth a finding: very unlikely by chance (seeds are fixed, so it never flakes) and not tiny. */
export const chiDiffers = (x: ChiResult, opts: { p?: number; v?: number } = {}): boolean => x.p < (opts.p ?? 1e-6) && x.v > (opts.v ?? 0.12);
