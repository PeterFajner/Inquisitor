// What each Reroll on the character's card rolls again (CharacterView.tsx):
// the Stats' (every stat die), the Boons' (the count and every boon), and
// each other section's, the decisions behind its things.
import type { BuildResult, Owned } from "../../shared/engine/build.ts";
import type { CharacterRecord } from "../../shared/engine/record.ts";
import type { Compendium } from "../../shared/rules/compendium.ts";
import { occupationPicks } from "./occupation.ts";

export const BOON = /^(.*\/boons)(#\d+|:count)$/;
const STAT = /\/@stats:/;
export const fromBoons = (t: Owned) => t.from.some((o) => !!o.key && BOON.test(o.key.split(">")[0]));

export type Rerolls = { stats: string[]; boons: string[]; talents: string[]; exotics: string[]; powers: string[]; mutations: string[]; items: string[] };

/**
 * A section's things' decisions, each traced up to the one it was made under
 * (all of an archetype's gear, not one slot), less the boons' (the Boons'
 * Reroll) and those with a control of their own (the stats, the Occupation's
 * picks).
 */
function rolledBy(built: BuildResult, things: Owned[], own: Set<string>): string[] {
  const parent = new Map(built.log.map((e) => [e.key, e.parent]));
  const top = (k: string) => {
    while (parent.get(k)) k = parent.get(k)!;
    return k;
  };
  const keys = new Set(things.filter((t) => !fromBoons(t)).flatMap((t) => t.from.flatMap((o) => (o.key ? [top(o.key)] : []))));
  return [...keys].filter((k) => !own.has(k) && !STAT.test(k));
}

export function rerolls(c: Compendium, record: CharacterRecord, built: BuildResult): Rerolls {
  const ch = built.character;
  const own = new Set(occupationPicks(c, record, built).map((p) => p.key));
  return {
    stats: built.log.filter((e) => e.type === "dice" && STAT.test(e.key)).map((e) => e.key),
    boons: built.log.filter((e) => BOON.test(e.key.split(">")[0])).map((e) => e.key).filter((k) => !k.includes(">")),
    talents: rolledBy(built, ch.talents, own),
    exotics: rolledBy(built, ch.exotics, own),
    powers: rolledBy(built, ch.powers, own),
    mutations: rolledBy(built, ch.mutations, own),
    items: rolledBy(built, ch.items, own),
  };
}
