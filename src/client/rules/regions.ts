// The canvas's regions, by kind across every book (an article's entries go
// in the same region as the book's), and their shelves (./shelves.ts): the
// book's own groups. Titles are the book's headings ("Tables" and "Rules"
// approved by the owner, November 2026).
import type { ComponentType } from "preact";
import { Brain, Dices, Dna, Gavel, Package, Sparkles, Users } from "lucide-preact";
import type { Entry } from "../../shared/rules/schema.ts";

export type RegionDef = {
  id: string;
  title: string;
  icon: ComponentType<{ size?: number | string; "aria-hidden"?: boolean | "true" }>;
};

export const REGIONS: RegionDef[] = [
  { id: "archetypes", title: "Character Archetypes", icon: Users },
  { id: "talents", title: "Talents & Exotic Abilities", icon: Sparkles },
  { id: "equipment", title: "Equipment", icon: Package },
  { id: "powers", title: "Psychic Powers", icon: Brain },
  { id: "mutations", title: "Mutations", icon: Dna },
  { id: "tables", title: "Tables", icon: Dices },
  { id: "rules", title: "Rules", icon: Gavel },
];

const BY_KIND: Record<Entry["kind"], string> = {
  archetype: "archetypes",
  talent: "talents",
  exotic: "talents",
  item: "equipment",
  power: "powers",
  mutation: "mutations",
  table: "tables",
  rule: "rules",
};

/** The book's headings for an entry with no group of its own (p. 24, 28, 92). */
const KIND_SHELF: Partial<Record<Entry["kind"], string>> = { talent: "Talents", exotic: "Exotic Abilities", mutation: "Mutations" };

export const BASE_PACK = "loyalist";

/** The region an entry goes in. */
export const regionOf = (e: Entry): string => BY_KIND[e.kind];

/** The shelf it goes on: its group, else its kind's heading, else (an article's rule) the article. */
export function shelfOf(e: Entry, packName: string): string {
  const g = "group" in e ? e.group : undefined;
  if (g) return g;
  if (e.kind === "archetype") return "";
  return KIND_SHELF[e.kind] ?? packName;
}

/**
 * Shelves in book order: a shelf ranks by the first page the book has
 * anything of it on (any kind: Talents' tables shelve where the talents
 * are), then those only articles have, in the order of their packs.
 */
export function shelfRanker(items: Iterable<{ pack: string; entry: Entry }>, packOrder: readonly string[], packName: (id: string) => string): (region: string, shelf: string) => number {
  const page = new Map<string, number>();
  const pack = new Map<string, number>();
  for (const { pack: p, entry } of items) {
    const s = shelfOf(entry, packName(p));
    if (p === BASE_PACK) page.set(s, Math.min(page.get(s) ?? Infinity, entry.source?.page ?? 0));
    else pack.set(s, Math.min(pack.get(s) ?? Infinity, packOrder.indexOf(p)));
  }
  return (_region, shelf) => page.get(shelf) ?? 1000 + (pack.get(shelf) ?? 0);
}
