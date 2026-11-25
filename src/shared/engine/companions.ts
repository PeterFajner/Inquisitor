// Companions: a model that comes with the character (a `companion` effect,
// "May be accompanied by a Technical Servitor") is a character of its own,
// built from its archetype and subtype with the named option chosen. It is
// rolled with the character and its dice and choices live in the
// character's record, under the companion's key ("<key>>" + its own key:
// "enginseers/technical-servitor>@companion>servitors/@stats:WS"), so
// replaying the record rebuilds both. The choices that make its option are
// the companion effect's, not decisions: they are made every build and kept
// out of the record, the log and the open choices.
//
// buildAll() is build() plus companions: its record, log and open choices
// hold the companions' too (keys prefixed, nested under the decision that
// gave the companion), and `companions` has each one built.
import type { Compendium } from "../rules/compendium.ts";
import { build, type BuildOptions, type BuildResult, type Character } from "./build.ts";
import { companionName, findOption } from "./companion-name.ts";
import { cloneRecord, newRecord, type CharacterRecord } from "./record.ts";

export type CompanionBuild = {
  /** Its decisions' prefix in the character's record is `${key}>`. */
  key: string;
  /** The book's name: "Technical Servitor". */
  name: string;
  /** The entry whose effect it is. */
  source: string;
  /** Its own record (keys unprefixed). */
  record: CharacterRecord;
  result: BuildResult;
};

export type FullBuild = BuildResult & { companions: CompanionBuild[] };

/** Companions of companions, at most this deep. */
const MAX_DEPTH = 2;

const prefixOf = (key: string) => `${key}>`;
/** A key under a companion's (its key ends in "@companion", or "@companion*2": build.ts). */
const COMPANION = /@companion(\*\d+)?>/;

/** The companion's own record: what the character's record holds under its key, and the choices that make its option. */
export function companionRecord(c: Compendium, input: CharacterRecord, comp: Character["companions"][number]): { record: CharacterRecord; forced: Set<string>; name: string } | null {
  const arch = c.archetypes.get(comp.archetype);
  const sub = arch && (arch.subtypes.find((s) => s.id === comp.subtype) ?? arch.subtypes[0]);
  if (!arch || !sub) return null;
  const pre = prefixOf(comp.key);
  const under = <T>(m: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith(pre)).map(([k, v]) => [k.slice(pre.length), v]));
  const name = companionName(c, comp);
  const r = newRecord(input.packs, arch.id, sub.id, name);
  r.dice = structuredClone(under(input.dice));
  r.choices = structuredClone(under(input.choices));
  r.overrides = input.overrides.flatMap((o) => (o.op === "choice" && o.key.startsWith(pre) ? [{ ...o, key: o.key.slice(pre.length), value: [...o.value] }] : []));
  if (input.rulesVersion) r.rulesVersion = input.rulesVersion;
  const opt = comp.option ? findOption(arch, comp.option, sub.id) : null;
  for (const [k, v] of Object.entries(opt?.choices ?? {})) r.choices[k] = [...v];
  return { record: r, forced: new Set(Object.keys(opt?.choices ?? {})), name };
}

/** build(), with the character's companions built too (docs/ENGINE.md "Companions"). */
export function buildAll(c: Compendium, input: CharacterRecord, opts: BuildOptions, depth = 0): FullBuild {
  // The character's own decisions: what isn't under a companion's key (the
  // engine keeps only the dice and choices it used; a companion's forced
  // choices are set aside so it doesn't warn of them).
  const theirs = (o: CharacterRecord["overrides"][number]) => o.op === "choice" && COMPANION.test(o.key);
  const main = build(c, { ...input, overrides: input.overrides.filter((o) => !theirs(o)) }, opts);
  const out: FullBuild = { ...main, record: cloneRecord(main.record), log: [...main.log], pending: [...main.pending], companions: [] };
  out.record.overrides = cloneRecord(input).overrides;
  if (depth >= MAX_DEPTH) return out;
  for (const comp of main.character.companions) {
    const made = companionRecord(c, input, comp);
    if (!made) continue;
    const pre = prefixOf(comp.key);
    const { forced } = made;
    // A key of the companion's as the character's; its top decisions under the one that gave it.
    const key = (k: string) => pre + k;
    const parent = (p: string | undefined) => (p && !forced.has(p) ? key(p) : comp.parent);
    const result = buildAll(
      c,
      made.record,
      {
        ...opts,
        pick: opts.pick && ((p) => opts.pick!({ ...p, key: key(p.key), parent: parent(p.parent) })),
      },
      depth + 1,
    );
    out.companions.push({ key: comp.key, name: made.name, source: comp.source, record: result.record, result });
    for (const [k, v] of Object.entries(result.record.dice)) out.record.dice[key(k)] = [...v];
    for (const [k, v] of Object.entries(result.record.choices)) if (!forced.has(k)) out.record.choices[key(k)] = [...v];
    // Its log right after the decision that gave it (or at the end).
    const entries = result.log.filter((e) => !forced.has(e.key)).map((e) => ({ ...e, key: key(e.key), parent: parent(e.parent) }));
    let at = out.log.length;
    if (comp.parent) {
      const i = out.log.findIndex((e) => e.key === comp.parent);
      if (i >= 0) {
        at = i + 1;
        while (at < out.log.length && out.log[at].key.startsWith(pre)) at++;
      }
    }
    out.log.splice(at, 0, ...entries);
    out.pending.push(...result.pending.filter((p) => !forced.has(p.key)).map((p) => ({ ...p, key: key(p.key), parent: parent(p.parent) })));
  }
  return out;
}
