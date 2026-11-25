// A built character (src/shared/engine) as the GM's sheet (src/shared/sheet.ts):
// what the on-screen sheet, the print sheet and the Word export all show.
// Pure: no DOM, no Node.
//
// - Name line: the record's name; the tag line is "Archetype, Subtype,
//   <chosen options>, Alignment" (the sheet's "Archtype, Subtype, Role,
//   Alignment"; a character's chosen options are its role): the archetype's
//   own, and those a rule chose for it (p. 83's Chaos discipline: "Chaos
//   Undivided").
// - Starting: final stats (overrides included) and the derived Kbk, BIV, SS,
//   Cnc, Spd from them.
// - Abilities: talents, exotic abilities, mutations, psychic powers, as
//   "Name (Effect.)" with the entry's book text as the effect.
// - Items go by their profile: a ranged profile (Rng or Range, with Dam) is
//   a Firearm row, a melee profile (Reach) a Melee row, anything else Other
//   Equipment/Bionics/Etc.
// - Natural weapons (the engine's `weapons`) are rows too, by their profile.
// - "# Rld": an item's reloads, with the character's reloads effects.
// - Game Notes: the character's attributes ("Warp Strength 5") and gameplay
//   notes (the book's prose); a roll the book makes at the start of each game
//   is its sentence, then the table unrolled ("1-10 The gods are angry; …")
//   for the GM to roll at the table.
// - A roll that led to an item with nothing to choose from is a line in Other
//   Equipment/Bionics/Etc, named by what was rolled ("Heavy weapon (Common)").
// - A companion is a line there too, by the book's name ("Technical
//   Servitor"); its own sheet follows the character's (companions.ts).
// - Armour: the engine's AV per hit location (best piece plus extra AV),
//   with any force field's dice after it.
import { companionName } from "./engine/companion-name.ts";
import { deriveStats } from "./engine/derived.ts";
import type { Character, LocationArmour, Owned, OwnedItem } from "./engine/build.ts";
import type { Location, Table } from "./rules/schema.ts";
import type { Compendium } from "./rules/compendium.ts";
import type { Item } from "./rules/schema.ts";
import { STATS } from "./rules/schema.ts";
import {
  blankSheetCharacter,
  type SheetAbility,
  type SheetCharacter,
  type SheetFirearm,
  type SheetLocation,
  type SheetMelee,
} from "./sheet.ts";

/** The engine's hit locations as the sheet's Location columns name them. */
export const SHEET_LOCATION_OF: Record<Location, SheetLocation> = {
  "Left Leg": "L. Leg",
  "Right Leg": "R. Leg",
  Groin: "Groin",
  "Left Arm": "L. Arm",
  "Right Arm": "R. Arm",
  Abdomen: "Abdmn",
  Chest: "Chest",
  Head: "Head",
};

export type SheetItemKind = "firearm" | "melee" | "other";

/** Where an item goes on the sheet, by its profile. */
export function sheetItemKind(item: Item | undefined): SheetItemKind {
  const p = item?.profile;
  if (!p) return "other";
  if (p.Reach !== undefined) return "melee";
  if ((p.Rng !== undefined || p.Range !== undefined) && (p.Dam !== undefined || p.Damage !== undefined)) return "firearm";
  return "other";
}

const oneLine = (s: string | undefined): string => (s ?? "").replace(/\s*\n+\s*/g, " / ").trim();
const prose = (s: string | undefined): string => (s ?? "").replace(/\s*\n+\s*/g, " ").trim();
const withQty = (name: string, qty: number): string => (qty > 1 ? `${name} ×${qty}` : name);

// Profile columns a row already shows; the rest go to Special.
const FIREARM_COLUMNS = new Set(["Type", "Rng", "Range", "Mode", "Acc", "Dam", "Damage", "Shots", "Rld", "Wt", "Weight"]);
const MELEE_COLUMNS = new Set(["Reach", "Damage", "Dam", "Parry Penalty"]);

function special(item: Item, shown: Set<string>): string {
  const extra = Object.entries(item.profile ?? {})
    .filter(([k]) => !shown.has(k))
    .map(([k, v]) => `${k}: ${oneLine(v)}`);
  return [...extra, prose(item.text)].filter(Boolean).join("; ");
}

export function firearmRow(item: Item, qty = 1): SheetFirearm {
  const p = item.profile ?? {};
  return {
    name: withQty(item.name, qty),
    type: oneLine(p.Type),
    rng: oneLine(p.Rng ?? p.Range),
    mode: oneLine(p.Mode),
    acc: oneLine(p.Acc),
    damage: oneLine(p.Dam ?? p.Damage),
    shots: oneLine(p.Shots),
    rld: oneLine(p.Rld),
    // The book's weapon tables print weight (Wt); the sheet calls it Enc.
    enc: oneLine(p.Wt ?? p.Weight),
    reloads: "",
    special: special(item, FIREARM_COLUMNS),
  };
}

export function meleeRow(item: Item, qty = 1): SheetMelee {
  const p = item.profile ?? {};
  return {
    name: withQty(item.name, qty),
    rch: oneLine(p.Reach),
    dam: oneLine(p.Damage ?? p.Dam),
    pp: oneLine(p["Parry Penalty"]),
    special: special(item, MELEE_COLUMNS),
  };
}

/** "Name (Effect.)": the effect is the entry's text, ending in a full stop. */
export function abilityOf(name: string, text: string | undefined): SheetAbility {
  let effect = prose(text);
  if (effect && !/[.!?)]$/.test(effect)) effect += ".";
  return { name, effect };
}

/** A table as the book prints it, a line per row: "1-10 The gods are angry; …" (the column's ranges for a table with columns). */
export function tableLines(t: Table, column?: string): string[] {
  return t.rows.map((r) => {
    const range = r.range ?? (column ? r.ranges?.[column] : undefined) ?? Object.values(r.ranges ?? {})[0];
    const at = range ? (range[0] === range[1] ? `${range[0]}` : `${range[0]}-${range[1]}`) : "";
    return [at, prose(r.label)].filter(Boolean).join(" ");
  });
}

/** "Heavy weapon (Common)": a roll that came to nothing to choose from. */
export const emptyLine = (e: { name: string; variants: string[] }): string => (e.variants.length ? `${e.name} (${e.variants.join(", ")})` : e.name);

/** An armour cell: the AV, plus any force field dice ("6+D10"); blank for none. */
export function armourCell(a: LocationArmour): string {
  return [...(a.av ? [String(a.av)] : []), ...a.fields].join("+");
}

/** A reference back to what a sheet line shows, for editing it in place. `fixed`: not removable by itself (a natural weapon). */
export type SheetRef = { kind: Owned["kind"]; id: string; overridden: boolean; fixed?: boolean };

export type SheetParts = {
  sheet: SheetCharacter;
  /** Parallel to sheet.abilities / firearms / melee / other. */
  refs: { abilities: SheetRef[]; firearms: SheetRef[]; melee: SheetRef[]; other: SheetRef[] };
};

/** The sheet plus, for each line, the thing it shows. */
export function sheetParts(ch: Character, c: Compendium): SheetParts {
  const sheet = blankSheetCharacter();
  const refs: SheetParts["refs"] = { abilities: [], firearms: [], melee: [], other: [] };
  const ref = (t: Owned): SheetRef => ({ kind: t.kind, id: t.id, overridden: !!t.overridden });

  sheet.name = ch.name;
  // The role: the archetype's own options and a rule's (not options chosen inside a talent or item).
  const role = ch.options.filter((o) => o.source === ch.archetype.id || c.rules.has(o.source));
  sheet.tagLine = [ch.archetype.name, ch.subtype.name, ...role.map((o) => o.name), ch.alignment ?? ""]
    .filter((s, i, all) => s && all.indexOf(s) === i)
    .join(", ");

  const finals = Object.fromEntries(STATS.map((s) => [s, ch.stats[s].final])) as Record<(typeof STATS)[number], number>;
  for (const s of STATS) sheet.starting[s] = String(finals[s]);
  // The engine's derived values (with their effects); the core formulas when it has none.
  const d = deriveStats(finals);
  for (const k of ["Kbk", "BIV", "SS", "Cnc", "Spd"] as const) sheet.starting[k] = String(ch.derived?.[k]?.value ?? d[k]);

  for (const [loc, a] of Object.entries(ch.armour ?? {}) as [Location, NonNullable<Character["armour"]>[Location]][]) {
    const col = SHEET_LOCATION_OF[loc];
    if (!col || !a) continue;
    sheet.armour[col] = armourCell(a);
  }

  // What a thing's own effects chose or rolled, and picks made into it: "(Stunning Sermon)".
  // Each unit's own choices stay together: "Bionic Organs (Advanced, Heart; Advanced, Lungs) ×2".
  const extras = (it: Owned): string => {
    const units = (it.variants ?? []).map((v) => v.filter(Boolean).join(", ")).filter(Boolean);
    const one = new Set(units).size === 1 ? [units[0]] : units;
    const chosen = [...new Set((it.chosen ?? []).map((x) => x.name))].filter(Boolean);
    const parts = [one.join("; "), chosen.join(", ")].filter(Boolean);
    return parts.length ? ` (${parts.join("; ")})` : "";
  };
  const abilityLists: [Owned[], Map<string, { text?: string }>][] = [
    [ch.talents, c.talents],
    [ch.exotics, c.exotics],
    [ch.mutations, c.mutations],
    [ch.powers, c.powers],
  ];
  for (const [list, map] of abilityLists) {
    for (const t of list) {
      sheet.abilities.push(abilityOf(t.name + extras(t), map.get(t.id)?.text));
      refs.abilities.push(ref(t));
    }
  }

  // Reloads effects for every firearm ("an extra clip", "double ammunition").
  const rl = ch.reloads ?? { add: 0, multiply: 1 };
  const reloadsOf = (n: number | undefined): string => {
    if (n === undefined && !rl.add) return "";
    const total = (n ?? 0) * rl.multiply + rl.add;
    return total > 0 ? String(total) : "";
  };
  // Effects that hold only while an item is wielded, by item.
  const wielded = new Map<string, string[]>();
  for (const w of ch.wielded ?? []) wielded.set(w.source, [...(wielded.get(w.source) ?? []), ...w.effects]);
  const addSpecial = (s: string, more: string[]): string => [s, ...more].filter(Boolean).join("; ");

  for (const it of ch.items as OwnedItem[]) {
    const base = c.items.get(it.id);
    // The profile for this wielder, when the engine changed it.
    const item = base && it.profile ? { ...base, profile: it.profile } : base;
    const kind = sheetItemKind(item);
    const more = [...(it.alterations ?? []), ...(wielded.get(it.id) ?? [])];
    if (item && kind === "firearm") {
      const row = firearmRow(item, it.qty);
      row.name = withQty(item.name + extras(it), it.qty);
      row.reloads = reloadsOf(it.reloads);
      row.special = addSpecial(row.special, more);
      sheet.firearms.push(row);
      refs.firearms.push(ref(it));
    } else if (item && kind === "melee") {
      const row = meleeRow(item, it.qty);
      row.name = withQty(item.name + extras(it), it.qty);
      row.special = addSpecial(row.special, more);
      sheet.melee.push(row);
      refs.melee.push(ref(it));
    } else {
      sheet.other.push(withQty(it.name + extras(it), it.qty));
      refs.other.push(ref(it));
    }
  }

  // What a roll led to with nothing to choose from: still on the sheet, so the GM sees the roll happened.
  for (const e of ch.empty ?? []) {
    sheet.other.push(emptyLine(e));
    refs.other.push({ kind: "item", id: "", overridden: false, fixed: true });
  }

  // Companions (a Technical Servitor): each has its own sheet; named here.
  for (const m of ch.companions ?? []) {
    sheet.other.push(companionName(c, m));
    refs.other.push({ kind: "item", id: "", overridden: false, fixed: true });
  }

  // Natural weapons (claws, horns…): rows by their profile, as items are.
  for (const w of ch.weapons ?? []) {
    const asItem = { kind: "item", id: w.source, name: w.name, group: "", source: { page: 0 }, profile: w.profile } as unknown as Item;
    const kind = sheetItemKind(asItem);
    const owner = [ch.talents, ch.exotics, ch.mutations, ch.powers, ch.items].flat().find((t) => t.id === w.source);
    const r: SheetRef = { kind: owner?.kind ?? "exotic", id: w.source, overridden: false, fixed: true };
    if (kind === "firearm") {
      sheet.firearms.push({ ...firearmRow(asItem, w.qty), reloads: "" });
      refs.firearms.push(r);
    } else {
      // A natural weapon with no ranged profile is a melee weapon.
      sheet.melee.push(meleeRow(asItem, w.qty));
      refs.melee.push(r);
    }
  }

  sheet.gameNotes = [
    ...(ch.attributes ?? []).map((a) => `${a.name} ${a.value}`),
    ...ch.notes.filter((n) => n.kind === "gameplay").map((n) => prose(n.text)),
    // Rolled at the start of each game: the book's sentence, then the table to roll on.
    ...(ch.eachGame ?? []).flatMap((g) => {
      const t = c.tables.get(g.table);
      return [prose(g.text), ...(t ? [t.name, ...tableLines(t)] : [])];
    }),
  ];
  return { sheet, refs };
}

/** The GM's sheet for a built character (the Word and print exports use this). */
export function toSheetCharacter(ch: Character, c: Compendium): SheetCharacter {
  return sheetParts(ch, c).sheet;
}

/** A character's sheets: its own, then each companion's (a Technical Servitor's, named by the book). */
export function characterSheets(b: { character: Character; companions?: { result: { character: Character } }[] }, c: Compendium): SheetCharacter[] {
  return [toSheetCharacter(b.character, c), ...(b.companions ?? []).map((m) => toSheetCharacter(m.result.character, c))];
}
