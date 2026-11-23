// The character record: everything needed to rebuild a character from the
// rules. Versioned; dice are stored as faces under stable decision keys
// (docs/ENGINE.md), never as seeds.
import { z } from "zod";
import { Alignment, Id, Stat } from "../rules/schema.ts";

export const THING_KINDS = ["talent", "exotic", "item", "mutation", "power"] as const;
export type ThingKind = (typeof THING_KINDS)[number];

// Overrides break the rules on purpose; the built character flags each one.
export type Override =
  | { op: "stat"; stat: Stat; value: number } // set a stat's final value
  | { op: "add"; kind: ThingKind; id: string; qty?: number } // give a talent/exotic/item/mutation/power
  | { op: "remove"; kind: ThingKind; id: string } // take one away
  | { op: "alignment"; value: Alignment } // set the alignment
  | { op: "choice"; key: string; value: string[] }; // force a choice (taken as-is, even if the rules don't allow it)

export const Override: z.ZodType<Override> = z.union([
  z.strictObject({ op: z.literal("stat"), stat: Stat, value: z.number().int() }),
  z.strictObject({ op: z.literal("add"), kind: z.enum(THING_KINDS), id: Id, qty: z.number().int().positive().optional() }),
  z.strictObject({ op: z.literal("remove"), kind: z.enum(THING_KINDS), id: Id }),
  z.strictObject({ op: z.literal("alignment"), value: Alignment }),
  z.strictObject({ op: z.literal("choice"), key: z.string().min(1), value: z.array(z.string()) }),
]);

export type CharacterRecord = {
  v: 1;
  packs: string[];
  name: string;
  archetype: string;
  subtype: string;
  dice: Record<string, number[]>; // decision key → faces
  choices: Record<string, string[]>; // decision key → chosen ids
  overrides: Override[];
  rulesVersion?: string; // the rules repo commit the record was last built against
};

export const CharacterRecord: z.ZodType<CharacterRecord> = z.strictObject({
  v: z.literal(1),
  packs: z.array(Id),
  name: z.string(),
  archetype: Id,
  subtype: Id,
  dice: z.record(z.string(), z.array(z.number().int())),
  choices: z.record(z.string(), z.array(z.string())),
  overrides: z.array(Override),
  rulesVersion: z.string().optional(),
});

/** Validates untrusted input (saved JSON, Luna's output) as a record. */
export function parseRecord(x: unknown): { ok: true; record: CharacterRecord } | { ok: false; error: string } {
  const r = CharacterRecord.safeParse(x);
  if (r.success) return { ok: true, record: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

export function newRecord(packs: string[], archetype: string, subtype: string, name = ""): CharacterRecord {
  return { v: 1, packs: [...packs], name, archetype, subtype, dice: {}, choices: {}, overrides: [] };
}

export function cloneRecord(r: CharacterRecord): CharacterRecord {
  return {
    ...r,
    packs: [...r.packs],
    dice: Object.fromEntries(Object.entries(r.dice).map(([k, v]) => [k, [...v]])),
    choices: Object.fromEntries(Object.entries(r.choices).map(([k, v]) => [k, [...v]])),
    overrides: r.overrides.map((o) => ({ ...o, ...("value" in o && Array.isArray(o.value) ? { value: [...o.value] } : {}) }) as Override),
  };
}
