// Limits that keep one client from taking the server down or filling the
// disk. The app sees no IP addresses (nginx passes none), so these are
// global; nginx adds per-IP limits in front (deploy/nginx).
import { HttpError, type Ctx } from "./http.ts";

/** At most `max` hits per `ms` for each key (a sliding window). */
export class RateWindow {
  private hits = new Map<string, number[]>();
  readonly max: number;
  readonly ms: number;
  constructor(max: number, ms: number) {
    this.max = max;
    this.ms = ms;
  }
  /** Counts a hit; false (and not counted) when the key is over its limit. */
  hit(key = "*", now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.ms)) this.hits.delete(k);
    return true;
  }
  /** Forget every hit (tests). */
  clear(): void {
    this.hits.clear();
  }
}

/** Throws 429 (retry after the window) when `w` refuses the hit. */
export function rateLimit(w: RateWindow, key = "*"): void {
  if (!w.hit(key)) throw new HttpError(429, "rate_limited");
}
