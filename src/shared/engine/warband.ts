// Warband rules: `warband` effects in rules (and archetypes) are warnings,
// never blocks (PLAN.md): "Generally, Warrior Bands should never have more
// than one Inquisitor."
import type { Compendium } from "../rules/compendium.ts";
import { walkEffects } from "../rules/compendium.ts";

export type WarbandWarning = { source: string; max: number; archetype: string[]; count: number };

/** Every warband rule the characters (by archetype id) break. */
export function warbandWarnings(c: Compendium, characters: { archetype: string }[]): WarbandWarning[] {
  const out: WarbandWarning[] = [];
  const entries = [...c.rules.values(), ...c.archetypes.values()];
  for (const e of entries) {
    const lists = e.kind === "archetype" ? e.sections.map((s) => s.effects) : [e.effects ?? []];
    for (const list of lists) {
      walkEffects(list, (x) => {
        if (!("warband" in x)) return;
        const count = characters.filter((ch) => x.warband.archetype.includes(ch.archetype)).length;
        if (count > x.warband.max) out.push({ source: e.id, max: x.warband.max, archetype: x.warband.archetype, count });
      });
    }
  }
  return out;
}
