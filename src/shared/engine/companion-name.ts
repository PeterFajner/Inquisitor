// A companion effect's option, found in its archetype: the decisions that
// choose it (the pick offering it, and the optionals leading there) and the
// book's name of the companion ("Technical" + "Servitor"). No engine
// imports, so build.ts can name a companion too.
import type { Compendium } from "../rules/compendium.ts";
import type { Archetype, CompanionEffect, Effect, Option } from "../rules/schema.ts";

export type CompanionOption = {
  /** The archetype's choices that make the option ("servitors/servitor-type": yes, "servitors/type": technical). */
  choices: Record<string, string[]>;
  /** The option's book name ("Technical"). */
  name: string;
};

/** Where `option` is chosen in the archetype (first match, in book order; a branch on the subtype follows `subtype` when given). */
export function findOption(arch: Archetype, option: string, subtype?: string): CompanionOption | null {
  const walk = (list: (Effect | Option)[], opened: string[]): CompanionOption | null => {
    for (const e of list) {
      if ("name" in e) {
        const o = e as Option;
        const inner = o.effects ? walk(o.effects, opened) : null;
        if (inner) return inner;
        continue;
      }
      const x = e as Effect;
      if ("optional" in x) {
        const r = walk(x.optional, [...opened, `${arch.id}/${x.id}`]);
        if (r) return r;
      } else if ("when" in x && "then" in x && !("chance" in x)) {
        const w = x.when as { subtype?: string[] };
        const r =
          subtype && Array.isArray(w.subtype) && Object.keys(w).length === 1
            ? walk(w.subtype.includes(subtype) ? x.then : (x.else ?? []), opened)
            : (walk(x.then, opened) ?? walk(x.else ?? [], opened));
        if (r) return r;
      } else if ("pick" in x && x.from) {
        const hit = x.from.find((o): o is Option => "name" in o && (o as Option).id === option);
        if (hit) return { choices: { ...Object.fromEntries(opened.map((k) => [k, ["yes"]])), [`${arch.id}/${x.id}`]: [option] }, name: hit.name };
        const r = walk(x.from, opened);
        if (r) return r;
      }
    }
    return null;
  };
  for (const s of arch.sections) {
    const r = walk(s.effects, []);
    if (r) return r;
  }
  return null;
}

/** The book's name of a companion: its option's name and the archetype's characters ("Technical Servitor"). */
export function companionName(c: Compendium, comp: CompanionEffect["companion"]): string {
  const arch = c.archetypes.get(comp.archetype);
  if (!arch) return comp.archetype;
  const who = arch.characters ?? arch.name;
  const opt = comp.option ? findOption(arch, comp.option, comp.subtype)?.name : undefined;
  return opt ? `${opt} ${who}` : who;
}
