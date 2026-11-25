// How a chosen option shows on the character, for the "shown outside the
// Rolls panel" and "on the GM sheet" checks. A named option is shown by its
// name, except:
// - a routing option (a branch with no grant of its own: "Legendary weapon",
//   "Wyrd Power (random discipline and random power)", "choose a mutation")
//   is shown by what it led to, the things its nested decisions gave;
// - a stat option (bare `{ stat, add }` effects: "+5 Nv") is shown by the
//   stats it changed (the card's Boon column, the sheet's Starting row).
// Names are compared without case ("Deadeye shot" is the talent "Deadeye Shot").
import type { BuildResult } from "../../../src/shared/engine/build.ts";
import { allEntries, effectLists, walkEffects, type Compendium } from "../../../src/shared/rules/compendium.ts";
import { STATS, type Effect, type Option, type Stat } from "../../../src/shared/rules/schema.ts";

export const includesCaseless = (hay: string, needle: string): boolean => hay.toLowerCase().includes(needle.toLowerCase());

const optionCache = new WeakMap<Compendium, Map<string, Option>>();

/** Every named option of every entry, by "<entry id>|<option id>" (the entry the pick belongs to). */
export function optionsOf(c: Compendium): Map<string, Option> {
  let m = optionCache.get(c);
  if (m) return m;
  m = new Map();
  for (const e of allEntries(c)) {
    for (const { effects } of effectLists(e)) {
      walkEffects(effects, (x) => {
        if (!("pick" in x) || !x.from) return;
        for (const o of x.from) if ("name" in o && "id" in o && !("stat" in o)) m!.set(`${e.id}|${o.id}`, o as Option);
      });
    }
  }
  optionCache.set(c, m);
  return m;
}

export type OptionShape = { kind: "named" } | { kind: "routing" } | { kind: "stats"; stats: Stat[] };

/** What an option's own effects are: only stat changes, only decisions that lead elsewhere (a routing option), or anything else (named). */
export function optionShape(c: Compendium, source: string, id: string): OptionShape {
  const o = optionsOf(c).get(`${source}|${id}`);
  const effects: Effect[] = o?.effects ?? [];
  if (!effects.length) return { kind: "named" };
  const stats = new Set<Stat>();
  let decides = 0;
  let other = 0;
  for (const e of effects) {
    if ("stat" in e) {
      const list = e.stat === "all" ? STATS : Array.isArray(e.stat) ? e.stat : [e.stat];
      for (const s of list) stats.add(s as Stat);
    } else if ("prose" in e) continue;
    else if ("pick" in e || "roll" in e || "chance" in e || "optional" in e || "powers" in e || "gear" in e) decides++;
    else other++;
  }
  if (!other && !decides && stats.size) return { kind: "stats", stats: [...stats] };
  if (!other && decides && !stats.size) return { kind: "routing" };
  return { kind: "named" };
}

/** The decisions an option's choice led to that made something (its nested decisions with a result). */
export function ledTo(b: BuildResult, key: string): string[] {
  const kids = new Map<string, string[]>();
  for (const e of b.log) if (e.parent) kids.set(e.parent, [...(kids.get(e.parent) ?? []), e.key]);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (k: string) => {
    for (const ch of kids.get(k) ?? []) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      out.push(ch);
      visit(ch);
    }
  };
  visit(key);
  return out.filter((k) => b.log.some((e) => e.key === k && e.result.some(Boolean)));
}
