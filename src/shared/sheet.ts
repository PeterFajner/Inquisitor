// The GM's character sheet (data/source/BETTER_3_CHARACTERSPER_PAGE.doc) as
// a view model: one SheetCharacter fills one of the sheet's blocks. Every
// value is display text, already formatted; an empty string leaves the cell
// blank. Field names follow the sheet's own headings. The Progress and
// Current rows and the Injury Lvl / Injury Total cells are for play and are
// never filled.

/** The sheet's stat columns, in its order (the Starting row). */
export const SHEET_STATS = [
  'WS', 'BS', 'S', 'T', 'I', 'Wp', 'Sg', 'Nv', 'Ld',
  'Kbk', 'BIV', 'SS', 'Cnc', 'Spd',
] as const;
export type SheetStat = (typeof SHEET_STATS)[number];

/** The Location table's columns, as the sheet spells them (it abbreviates Abdomen to "Abdmn"). */
export const SHEET_LOCATIONS = [
  'L. Leg', 'R. Leg', 'Groin', 'L. Arm', 'R. Arm', 'Abdmn', 'Chest', 'Head',
] as const;
export type SheetLocation = (typeof SHEET_LOCATIONS)[number];

/** One row of the Firearm table. */
export interface SheetFirearm {
  /** "Firearm": the weapon's name. */
  name: string;
  /** "Type": Pistol, Basic, Heavy… */
  type: string;
  /** "Rng" */
  rng: string;
  /** "Mode": e.g. "Single / Semi". */
  mode: string;
  /** "Acc" */
  acc: string;
  /** "Damage": e.g. "2D6+2". */
  damage: string;
  /** "Shots" */
  shots: string;
  /** "Rld": reload time. */
  rld: string;
  /** "Enc" */
  enc: string;
  /** "# Rld": the number of reloads, printed after the sheet's "/ " (the space before it is the GM's tally). */
  reloads: string;
  /** "Special" */
  special: string;
}

/** One row of the Melee table. */
export interface SheetMelee {
  /** "Melee": the weapon's name. */
  name: string;
  /** "Rch" */
  rch: string;
  /** "Dam" */
  dam: string;
  /** "PP" */
  pp: string;
  /** "Special" */
  special: string;
}

/** One entry of the Abilities cell, printed "Name (Effect.)", one per line. */
export interface SheetAbility {
  /** Printed bold red, as on the sheet. */
  name: string;
  /** Printed in brackets after the name; include the closing full stop. Empty prints the name alone. */
  effect: string;
}

export interface SheetCharacter {
  /** Name line: printed bold red. */
  name: string;
  /** Name line: the sheet's "(Archtype, Subtype, Role, Alignment)", without the brackets, e.g. "Inquisitor, Puritan, Leader, Ordo Hereticus". Empty drops the brackets. */
  tagLine: string;
  /** The Starting row: stats then the derived Kbk, BIV, SS, Cnc, Spd. */
  starting: Record<SheetStat, string>;
  /** The Game Notes column (bold red on the sheet), one line each. */
  gameNotes: string[];
  /** The Abilities cell. */
  abilities: SheetAbility[];
  /** The Armour row of the Location table, per location (e.g. "4"). */
  armour: Record<SheetLocation, string>;
  /** Firearm rows; the sheet has two, more add rows. */
  firearms: SheetFirearm[];
  /** Melee rows; the sheet has two, more add rows. */
  melee: SheetMelee[];
  /** The "Other Equipment/Bionics/Etc" cell, one line each. */
  other: string[];
}

/** Characters per printed page: the sheet has three blocks. */
export const SHEET_BLOCKS_PER_PAGE = 3;

/** A block with nothing in it (the empty blocks of a partly used last page). */
export function blankSheetCharacter(): SheetCharacter {
  return {
    name: '',
    tagLine: '',
    starting: Object.fromEntries(SHEET_STATS.map((s) => [s, ''])) as Record<SheetStat, string>,
    gameNotes: [],
    abilities: [],
    armour: Object.fromEntries(SHEET_LOCATIONS.map((l) => [l, ''])) as Record<SheetLocation, string>,
    firearms: [],
    melee: [],
    other: [],
  };
}
