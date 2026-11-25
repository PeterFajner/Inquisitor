// The builder's Occupation dropdowns (CharacterView.tsx): the archetype's
// own picks of one, each labelled by its own book heading, and the optional
// headings of its own ("Truant?", "Repentia"). No two share a label.
import type { BuildResult, PendingChoice } from "../../shared/engine/build.ts";
import type { CharacterRecord } from "../../shared/engine/record.ts";
import { reroll } from "../../shared/engine/reroll.ts";
import type { Compendium } from "../../shared/rules/compendium.ts";
import type { Archetype, Effect, Option } from "../../shared/rules/schema.ts";
import { ROLE_SECTIONS, T } from "./labels.ts";
import { choiceOptions, view } from "./ops.ts";

/** The headings every archetype's page has; any other (an archetype's own "Truant?") is part of its occupation. */
export const SHEET_SECTIONS = new Set(["Equipment", "Armour", "Psychic Abilities", "Exotic Abilities", "Talents", "Mutations", "Alignment"]);

export type OccupationPick = { key: string; label: string; options: { id: string; label: string }[]; value: string; inner?: string; optional?: boolean };

/**
 * The option a pick of the archetype's follows: the first named by the
 * `when: { option }` around it (Rank 6 for Crone World's "Rare item or
 * extra Bonus" pick), by its book name and text.
 */
function gateOf(arch: Archetype, effectId: string): { name: string; text?: string } | null {
  const options = new Map<string, Option>();
  let gate: string | undefined;
  const walk = (list: (Effect | Option)[], around: string | undefined): void => {
    for (const x of list) {
      if ("name" in x) {
        const o = x as Option;
        options.set(o.id, o);
        if (o.effects) walk(o.effects, around);
        continue;
      }
      const e = x as Effect;
      if ("id" in e && e.id === effectId && gate === undefined) gate = around ?? "";
      if ("optional" in e) walk(e.optional, around);
      else if ("when" in e && "then" in e) {
        const w = e.when as { option?: string[] };
        const here = !("chance" in e) && Array.isArray(w.option) ? w.option[0] : around;
        walk(e.then, here);
        walk(e.else ?? [], around);
      } else if ("pick" in e && e.from) walk(e.from, around);
    }
  };
  for (const s of arch.sections) walk(s.effects, undefined);
  const o = gate ? options.get(gate) : undefined;
  return o ? { name: o.name, text: o.text } : null;
}

/** The Occupation dropdowns of a built character (`built` from view()). */
export function occupationPicks(c: Compendium, record: CharacterRecord, built: BuildResult): OccupationPick[] {
  const ch = built.character;
  const arch = c.archetypes.get(ch.archetype.id);
  const out: OccupationPick[] = [];
  // Every dropdown's label is its own: the Archetype's and Subtype's, then each pick's.
  const used = new Set<string>([T.archetype, T.subtype]);
  for (const e of built.log) {
    if (e.type !== "choice" || e.parent || !e.key.startsWith(`${ch.archetype.id}/`)) continue;
    const p = choiceOptions(c, record, e.key);
    if (!p || p.kind !== "pick" || p.count !== 1 || p.options.length < 2) continue;
    // Its section's heading (view() puts it for the archetype's name); the old site's "Role" where the book names the pick after the archetype.
    let label = arch && e.section && ROLE_SECTIONS[arch.id] === e.section ? T.role : e.label;
    // A follow-up under a heading already used (Crone World's "Rare item or extra Bonus" under Rank): the book's text of the option it follows.
    if (used.has(label) && arch) {
      const gate = gateOf(arch, e.key.slice(arch.id.length + 1).replace(/\*\d+$/, ""));
      const alt = [gate?.text, gate?.name].find((x) => x && !used.has(x));
      if (alt) label = alt;
    }
    used.add(label);
    out.push({ key: e.key, label, options: p.options, value: record.choices[e.key]?.[0] ?? "" });
  }
  // An optional heading of its own before the sheet's ("Truant?", "Repentia", "Servitor Type"): "–", or one of its pick's options.
  for (const e of built.log) {
    if (e.type !== "choice" || e.parent || !e.key.startsWith(`${ch.archetype.id}/`) || !e.section || SHEET_SECTIONS.has(e.section)) continue;
    if (record.choices[e.key]?.[0] !== "yes" && record.choices[e.key]?.[0] !== "no") continue;
    let inner: Pick<PendingChoice, "key" | "kind" | "count" | "options"> | undefined;
    try {
      const r = reroll(c, record, e.key);
      r.choices[e.key] = ["yes"];
      const b = view(c, r);
      inner = b.pending.find((x) => x.parent === e.key);
      // a pick of one (Truant) is made by itself: its one option is the choice made
      const only = !inner && b.log.find((x) => x.parent === e.key && x.type === "choice");
      const id = only && b.record.choices[only.key]?.[0];
      if (only && id) inner = { key: only.key, kind: "pick", count: 1, options: [{ id, label: only.result[0] ?? id }] };
    } catch {}
    if (!inner || inner.kind !== "pick" || inner.count !== 1) continue;
    const on = record.choices[e.key]?.[0] === "yes";
    if (used.has(e.section)) continue;
    used.add(e.section);
    out.push({ key: e.key, inner: inner.key, label: e.section, options: inner.options, value: on ? (record.choices[inner.key]?.[0] ?? "") : "", optional: true });
  }
  return out;
}
