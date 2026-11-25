// The real rules (data/rules, or RULES_DIR) as the app sees them: every
// pack, hidden entries left out (the server never serves them), stacked
// into one compendium. Loaded once per process.
import { join } from "node:path";
import { loadAllPacks } from "../../../src/lib/rules-files.ts";
import { buildCompendium, withoutHidden, type Compendium } from "../../../src/shared/rules/compendium.ts";
import type { Archetype } from "../../../src/shared/rules/schema.ts";

export const ROOT = join(import.meta.dirname, "../../..");
export const RULES = process.env.RULES_DIR || join(ROOT, "data/rules");

let cached: Compendium | null = null;
export function realCompendium(): Compendium {
  if (!cached) cached = buildCompendium(withoutHidden(loadAllPacks(RULES)));
  return cached;
}

/** Every archetype the builder offers (A–Z by id). */
export function archetypeIds(): string[] {
  return [...realCompendium().archetypes.keys()].sort();
}

export function archetype(id: string): Archetype {
  const a = realCompendium().archetypes.get(id);
  if (!a) throw new Error(`no archetype ${id}`);
  return a;
}
