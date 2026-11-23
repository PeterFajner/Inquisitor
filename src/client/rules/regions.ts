// The canvas's regions: the book's sections in book order (their titles are
// the book's headings), then one region per extra rule pack, titled with the
// pack's name. A loyalist entry goes to its section by kind, or (tables and
// prose rules) by the page it's on.
import type { ComponentType } from "preact";
import { Brain, Dna, Gavel, Gift, Layers, ListOrdered, Package, ScrollText, Sparkles, Users } from "lucide-preact";
import type { Entry } from "../../shared/rules/schema.ts";

export type RegionDef = {
  id: string;
  title: string;
  icon: ComponentType<{ size?: number | string; "aria-hidden"?: boolean | "true" }>;
  /** First and last PDF page of the section. */
  pages?: [number, number];
  /** Columns of the masonry layout (default: the count that gives the region the layout's aspect). */
  columns?: number;
};

// Pages from data/source/pages: each section starts with its heading.
export const BOOK_REGIONS: RegionDef[] = [
  { id: "steps", title: "Steps To Create a Warrior Band", icon: ListOrdered, pages: [1, 3] },
  { id: "archetypes", title: "Character Archetypes", icon: Users, pages: [4, 21] },
  { id: "boons", title: "Boons", icon: Gift, pages: [22, 23] },
  { id: "talents", title: "Talents & Exotic Abilities", icon: Sparkles, pages: [24, 37] },
  { id: "equipment", title: "Equipment", icon: Package, pages: [38, 81] },
  { id: "powers", title: "Psychic Powers", icon: Brain, pages: [82, 91] },
  { id: "mutations", title: "Mutations", icon: Dna, pages: [92, 93] },
  { id: "methodology", title: "Methodology & Explanations", icon: ScrollText, pages: [94, 97] },
  { id: "house-rule", title: "The One Recommended House Rule & Tips", icon: Gavel, pages: [98, 98] },
];

const BY_KIND: Partial<Record<Entry["kind"], string>> = {
  archetype: "archetypes",
  talent: "talents",
  exotic: "talents",
  item: "equipment",
  power: "powers",
  mutation: "mutations",
};

export const BASE_PACK = "loyalist";

export const packRegionId = (pack: string) => `pack:${pack}`;
export const PACK_ICON = Layers;

/** The region an entry of a pack goes in. */
export function regionOf(pack: string, e: Entry): string {
  if (pack !== BASE_PACK) return packRegionId(pack);
  const page = e.source?.page ?? 0;
  if (e.kind === "table" || e.kind === "rule") {
    const r = BOOK_REGIONS.find((r) => r.pages && page >= r.pages[0] && page <= r.pages[1]);
    if (r) return r.id;
  }
  return BY_KIND[e.kind] ?? BOOK_REGIONS.find((r) => r.pages && page >= r.pages[0] && page <= r.pages[1])?.id ?? "steps";
}

/** Book order within a region: page, then kind, then the order the entries came in. */
const KIND_ORDER: Record<Entry["kind"], number> = { rule: 0, archetype: 1, table: 2, talent: 3, exotic: 4, item: 5, power: 6, mutation: 7 };
export function bookOrder(a: Entry, b: Entry): number {
  return (a.source?.page ?? 0) - (b.source?.page ?? 0) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}
