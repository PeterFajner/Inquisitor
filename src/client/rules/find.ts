// Finding a card by name (./Search.tsx): the shown cards whose names hold
// the query, case and accents aside; names starting with it first, then
// those with a word starting with it, then the rest, A–Z. Pure.
import type { Entry } from "../../shared/rules/schema.ts";
import { compareNames } from "./shelves.ts";

/** `label`: as listed (./book.ts listNames: with its book's name where another book's card on its tab has the same name). */
export type Searchable = { key: string; name: string; label: string; kind: Entry["kind"]; book: string };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function matches(cards: readonly Searchable[], query: string, max = 40): Searchable[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: { c: Searchable; r: number }[] = [];
  for (const c of cards) {
    const n = fold(c.name);
    const at = n.indexOf(q);
    if (at < 0) continue;
    scored.push({ c, r: at === 0 ? 0 : /[\s\-–(/'"’]/.test(n[at - 1]) ? 1 : 2 });
  }
  scored.sort((a, b) => a.r - b.r || compareNames(a.c.name, b.c.name) || compareNames(a.c.book, b.c.book));
  return scored.slice(0, max).map((x) => x.c);
}
