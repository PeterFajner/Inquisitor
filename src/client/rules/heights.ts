// Card heights measured on an earlier visit (localStorage), so the rules
// canvas can lay out ~1,000 cards at once instead of rendering every card
// hidden to measure it first. A height is keyed by what the card shows (its
// entry's content, width and edited mark), so an edited entry is measured
// again; and the whole store by the build (the client's script and style
// URLs, which carry content hashes), so a change to the cards' code or CSS
// measures everything again. A card that's mounted is measured anyway and
// corrects a stale height. Pure except load/save.

const STORE = "inquisitor:rules-heights";

/** FNV-1a, 32 bits, as 8 hex digits. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** What a card's height depends on, as a short key. */
export const heightKey = (entryJson: string, width: number, edited: boolean): string =>
  `${width}${edited ? "e" : ""}:${entryJson.length}:${fnv1a(entryJson)}`;

/** The heights stored for this build (empty for another build or anything unreadable). */
export function parseHeights(raw: string | null, build: string): Map<string, number> {
  if (!raw) return new Map();
  try {
    const v = JSON.parse(raw) as { build?: unknown; h?: unknown };
    if (v.build !== build || !v.h || typeof v.h !== "object") return new Map();
    return new Map(Object.entries(v.h as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0));
  } catch {
    return new Map();
  }
}

export const serializeHeights = (build: string, heights: ReadonlyMap<string, number>): string =>
  JSON.stringify({ build, h: Object.fromEntries(heights) });

/** This build: the client's script and stylesheet URLs (content-hashed in production). */
export function buildId(): string {
  const urls = [import.meta.url];
  if (typeof document !== "undefined")
    for (const l of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) urls.push(l.href);
  return fnv1a(urls.join(" "));
}

export function loadHeights(build: string): Map<string, number> {
  try {
    return parseHeights(localStorage.getItem(STORE), build);
  } catch {
    return new Map();
  }
}

export function saveHeights(build: string, heights: ReadonlyMap<string, number>): void {
  try {
    localStorage.setItem(STORE, serializeHeights(build, heights));
  } catch {}
}
