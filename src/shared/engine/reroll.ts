// Re-rolling: clear a decision, and every decision nested under it, from a
// record; the next build() makes them again.
import type { Compendium } from "../rules/compendium.ts";
import { build } from "./build.ts";
import { cloneRecord, type CharacterRecord } from "./record.ts";

// Separators after a key that mark a key nested under it (docs/ENGINE.md):
// "#n" slots, "~n" re-rolls, ":part" parts, ">" effects inside a result.
const NESTED = ["#", "~", ":", ">"];

/** Whether `key` is `under` or nested under it by its spelling. */
export function isUnder(key: string, under: string): boolean {
  return key === under || (key.startsWith(under) && NESTED.includes(key[under.length]));
}

/** Clears `keys` and keys nested under them by spelling (no compendium needed). */
export function clearDecisions(record: CharacterRecord, keys: string[]): CharacterRecord {
  const r = cloneRecord(record);
  const hit = (k: string) => keys.some((u) => isUnder(k, u));
  r.dice = Object.fromEntries(Object.entries(r.dice).filter(([k]) => !hit(k)));
  r.choices = Object.fromEntries(Object.entries(r.choices).filter(([k]) => !hit(k)));
  return r;
}

/**
 * Clears decision `key` and everything that depends on it: keys nested by
 * spelling plus decisions made inside its outcome (a chosen option's
 * effects, a chance's branch, a table row's effects), found by building the
 * record once. Choice overrides on those keys stay.
 */
export function reroll(c: Compendium, record: CharacterRecord, key: string): CharacterRecord {
  const { log } = build(c, record, { mode: "freeform", roll: () => 1 });
  const children = new Map<string, string[]>();
  for (const e of log) {
    if (!e.parent) continue;
    const list = children.get(e.parent) ?? [];
    list.push(e.key);
    children.set(e.parent, list);
  }
  const clear = new Set<string>();
  const visit = (k: string) => {
    for (const e of log) if (isUnder(e.key, k) && !clear.has(e.key)) clear.add(e.key);
    clear.add(k);
    for (const ch of children.get(k) ?? []) if (!clear.has(ch)) visit(ch);
    for (const e of log) if (isUnder(e.key, k)) for (const ch of children.get(e.key) ?? []) if (!clear.has(ch)) visit(ch);
  };
  visit(key);
  // How many a pick makes (`<pick>:count`) goes with what it chose: the
  // choice is made again for the new count
  const pick = key.endsWith(":count") ? key.slice(0, -":count".length) : undefined;
  if (pick && log.some((e) => e.key === pick && e.type === "choice")) visit(pick);
  return clearDecisions(record, [...clear]);
}
