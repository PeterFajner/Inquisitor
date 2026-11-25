// The rules format: every entry in data/rules/<pack>/<kind>/<id>.yaml is one
// of the entry types below, and an entry's rules are a list of effects (the
// "chips" on the canvas). The engine (src/shared/engine) interprets effects;
// docs/RULES-FORMAT.md explains them with examples from the book.
//
// Effects that involve chance or a choice carry an `id`, unique within their
// entry. The engine keys every die roll and choice by entry id + effect id
// (e.g. "inquisitor-acolyte/type"), so saved characters keep their dice when
// unrelated rules are added or removed.
import { z } from "zod";

export const STATS = ["WS", "BS", "S", "T", "I", "Wp", "Sg", "Nv", "Ld"] as const;
export const Stat = z.enum(STATS);
export type Stat = z.infer<typeof Stat>;

export const ALIGNMENTS = ["Puritan", "Neutral", "Radical", "Chaos"] as const;
export const Alignment = z.enum(ALIGNMENTS);
export type Alignment = z.infer<typeof Alignment>;

export const AVAILABILITIES = ["Common", "Rare", "Exotic", "Legendary"] as const;
export const Availability = z.enum(AVAILABILITIES);
export type Availability = z.infer<typeof Availability>;

// kebab-case ids, stable forever once published (characters refer to them)
export const Id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case id");

// "60+2D10", "D3+3", "2D6", "D100", "4D10", "-20", or a plain number.
// Terms are integers or [N]D<M>, joined by + or -. A dice term may be
// multiplied by an integer: "D6x10" ("+ [D6 x 10] Strength").
export const DICE_RE = /^[+-]?(\d*D\d+(x\d+)?|\d+)([+-](\d*D\d+(x\d+)?|\d+))*$/;
export const Dice = z.union([z.number().int(), z.string().regex(DICE_RE, "dice like 60+2D10")]);
export type Dice = z.infer<typeof Dice>;

// Hit locations, as the core rulebook's Hit Location table names them (the GM
// sheet's Location columns). Groups: "all", "non-head" (everything but the
// head), "arms", "legs".
export const LOCATIONS = ["Head", "Chest", "Abdomen", "Groin", "Left Arm", "Right Arm", "Left Leg", "Right Leg"] as const;
export const Location = z.enum(LOCATIONS);
export type Location = z.infer<typeof Location>;
export const LOCATION_GROUPS = ["all", "non-head", "arms", "legs"] as const;
export type LocationSet = Location | (typeof LOCATION_GROUPS)[number];
export const LocationSet = z.union([Location, z.enum(LOCATION_GROUPS)]);

// The GM sheet's derived values (src/shared/engine/derived.ts).
export const DERIVED = ["Kbk", "BIV", "SS", "Cnc", "Spd"] as const;
export const DerivedStat = z.enum(DERIVED);
export type DerivedStat = z.infer<typeof DerivedStat>;

// Bionic quality (p.61): Crude = Common, Average = Rare, Advanced = Exotic.
export const QUALITIES = ["Crude", "Average", "Advanced"] as const;
export const Quality = z.enum(QUALITIES);
export type Quality = z.infer<typeof Quality>;

// Kinds of things a character has (the engine's ThingKind).
export const POOLS = ["talent", "exotic", "item", "mutation", "power"] as const;
export const Pool = z.enum(POOLS);
export type Pool = z.infer<typeof Pool>;

// A number worked out from a stat at the end of the build:
// { stat: S, divide: 10 } is "[Strength/10]"; { stat: S, add: 50 } is
// "Strength + 50". Rounded off (half up) like the core rules' fractions.
export type StatFormula = { stat: Stat; times?: number; divide?: number; add?: number };
export const StatFormula: z.ZodType<StatFormula> = z.strictObject({
  stat: Stat,
  times: z.number().optional(),
  divide: z.number().positive().optional(),
  add: z.number().optional(),
});

export const Source = z.object({
  page: z.number().int().positive(),
  // The book's wording for this entry, verbatim (spelling fixed), shown behind
  // the quote icon. Not interpreted by anything.
  text: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type Condition =
  | { alignment: Alignment[] }
  | { subtype: string[] } // subtype ids of the current archetype
  | { option: string[] } // ids of named options chosen anywhere on the character
  | { archetype: string[] }
  | { has: { talent?: string; exotic?: string; item?: string; mutation?: string; power?: string } }
  | { not: Condition }
  | { any: Condition[] }
  | { all: Condition[] }
  | { stat: Stat; below?: number; above?: number } // the stat's current value (final values for profileWhen)
  | { rolled: string[] } // the character has a result on any of these tables
  | { psyker: boolean } // has powers, a psyker subtype, or a { psyker: true } effect
  | { generates: Availability[] } // a gear effect so far may generate any of these availabilities
  | { availability: Availability[] }; // the gear result being made (an equipment generator row's effects) is of one of these

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ alignment: z.array(Alignment).min(1) }),
    z.strictObject({ subtype: z.array(Id).min(1) }),
    z.strictObject({ option: z.array(Id).min(1) }),
    z.strictObject({ archetype: z.array(Id).min(1) }),
    z.strictObject({
      has: z.strictObject({
        talent: Id.optional(),
        exotic: Id.optional(),
        item: Id.optional(),
        mutation: Id.optional(),
        power: Id.optional(),
      }),
    }),
    z.strictObject({ not: Condition }),
    z.strictObject({ any: z.array(Condition).min(1) }),
    z.strictObject({ all: z.array(Condition).min(1) }),
    z
      .strictObject({ stat: Stat, below: z.number().optional(), above: z.number().optional() })
      .refine((c) => c.below !== undefined || c.above !== undefined, { message: "stat condition needs below or above" }),
    z.strictObject({ rolled: z.array(Id).min(1) }),
    z.strictObject({ psyker: z.boolean() }),
    z.strictObject({ generates: z.array(Availability).min(1) }),
    z.strictObject({ availability: z.array(Availability).min(1) }),
  ]),
);

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type Effect =
  | StatEffect
  | GrantEffect
  | PickEffect
  | OptionalEffect
  | ChanceEffect
  | RollEffect
  | WhenEffect
  | AlignmentEffect
  | GearEffect
  | PowersEffect
  | ProseEffect
  | ArmourEffect
  | RestrictEffect
  | ExclusiveEffect
  | DerivedEffect
  | AttributeEffect
  | WieldedEffect
  | RemoveEffect
  | ReloadsEffect
  | TradeEffect
  | UpgradeEffect
  | BionicsEffect
  | WeaponEffect
  | AccessEffect
  | PsykerEffect
  | CompanionEffect
  | WarbandEffect
  | LocationEffect;

// Change one or more stats. `add` may be dice ("-D10") and is rolled once per
// effect (the same amount for every listed stat unless `each` is set), or a
// formula on another stat ({ stat: S, divide: 10 }, worked out at the end).
// `multiply` scales the stat at the end ("increase their Strength by 1/5th":
// 1.2). `max`/`min` clamp; "average" is the subtype's stat line with every
// die at its mean, rounded down.
export type StatEffect = {
  id?: string;
  stat: Stat | Stat[] | "all";
  add?: Dice | StatFormula;
  set?: Dice;
  multiply?: number;
  max?: number | "average";
  min?: number;
  each?: boolean;
};

// Extras every grant may carry:
//  - set: answers for the granted entry's own decisions, by effect id: an
//    option id for a pick, a row label for a roll, "then"/"else" for a
//    chance, "yes"/"no" for an optional. Its effects run again for this grant
//    (Eversor: Bionic Organs set to Advanced Heart, and again to Lungs).
//  - again: its effects run again even if the character already has it (a
//    second Word of the Emperor prayer).
//  - variant: shown with this one like its quality ("Left arm" for a Bionic
//    Limb rolled on Bionic Limbs).
type GrantExtras = { note?: string; set?: Record<string, string[]>; again?: boolean; variant?: string };

// What an item's armour covers for this grant only: these locations instead
// of the item's own ("Flak (All non-head locations)"), or `choose` that many
// of them (dice: "Padded Clothing (D6 locations)").
export type GrantCovers = { locations?: LocationSet | LocationSet[]; choose?: Dice };

// Give the character a specific thing. Items may also carry a quantity, a
// bionic quality, "implanted", reloads ("with four Bolt Weapon Reloads") and
// equipment alterations (each raises its availability a step).
export type GrantEffect =
  | ({ talent: string } & GrantExtras)
  | ({ exotic: string } & GrantExtras)
  | ({
      item: string;
      qty?: Dice;
      quality?: Quality;
      implanted?: boolean;
      reloads?: number;
      alterations?: string[];
      covers?: GrantCovers;
    } & GrantExtras)
  | ({ mutation: string } & GrantExtras)
  | ({ power: string } & GrantExtras);

// A named option: an Acolyte type, a faction, Grey Knight, a Cherubim role…
// `when`: offered only when the condition holds (a quality "you can generate").
export type Option = {
  id: string;
  name: string;
  text?: string; // the book's description of the option (gameplay prose)
  when?: Condition;
  effects?: Effect[];
};

// Which entries a pool (or a give, or a restriction) is about. Every name is
// exact (rules:check reports one that matches nothing): `group`/`discipline`
// an entry's group, `category` an item's category; names in `tag`/`exclude`
// match an entry's id, group, category, tags, product ("Chaos", "Radical",
// "Xenos") or "alien" (entryNames in compendium.ts).
export type PickFilter = {
  group?: string[];
  category?: string[]; // items: the equipment generator's category (Pistol, Basic weapon…)
  tag?: string[];
  exclude?: string[];
  availability?: Availability[];
  discipline?: string[];
  maxDifficulty?: number;
  owned?: boolean; // true: only what the character has; false: only what it hasn't
};

// Pick N. Either from explicit options/effects, or "any N" from a pool of a
// kind of entry (optionally filtered). In random mode the engine picks at
// random; in freeform mode the user picks.
//  - pick: "any" or { max: N }: as many as the player likes (up to N).
//    Random mode takes `random` of them (dice; default 0 for "any", 0..N
//    uniformly for max).
//  - qty: how many of each picked item ("ten rounds of special ammunition").
//  - implanted: picked items are implanted.
//  - into: the pick goes onto an item (or ability) instead of the character:
//    "self" is the entry these effects belong to, else an item id the
//    character has (a toxin in a needle pistol, a power in archeotech).
export type PickEffect = {
  id: string;
  pick: Dice | "any" | { max: number };
  from?: (Option | Effect)[];
  pool?: Pool;
  filter?: PickFilter;
  distinct?: boolean; // default true
  qty?: Dice;
  implanted?: boolean;
  into?: string;
  random?: Dice;
};

// "May have …": the player decides (random mode flips a coin).
export type OptionalEffect = { id: string; optional: Effect[] };

// "N% chance of …" (D100 ≤ chance), or a chance on any die:
// { die: D6, on: [6] } ("Roll a D6. On a 6, …").
export type ChanceEffect = { id: string; chance: number | { die: Dice; on: number[] }; then: Effect[]; else?: Effect[] };

// Roll on a table, `times` times (default 1). `column` picks a column of a
// multi-column table (boons are per subtype); "$subtype" means the
// character's subtype id. Duplicate results are re-rolled when the table or
// this effect says so (and in every roll nested under such a roll).
//  - qty: items the result grants come in this quantity ("(D10 doses)").
//  - rerollUnless: a result is re-rolled unless every item it grants has
//    `profile` containing `includes` ("Re-roll if not allowed with dispenser
//    type generated").
//  - column { owned, else }: the column for a weapon the character carries
//    ("Random Special Ammunition By Weapon Type"): the columns whose names
//    match an item it has (chosen among them when several do), else `else`.
//    In a gear effect such a row is made after the effect's other results.
//  - matchAvailability: under a gear result, its rows' items must be of the
//    result's availability (or have none); others are re-rolled ("Random
//    Other Implant": the Scarcity column).
export type ColumnByOwned = { owned: Record<string, string[]>; else?: string };
export type RollEffect = {
  id: string;
  roll: string;
  times?: Dice;
  column?: string | ColumnByOwned;
  rerollDuplicates?: boolean;
  qty?: Dice;
  rerollUnless?: { profile: string; includes: string };
  matchAvailability?: boolean;
  eachGame?: string; // the book's "At the beginning of each game, … roll …": not rolled at creation
};

export type WhenEffect = { when: Condition; then: Effect[]; else?: Effect[] };

// Which alignments the character may have; picked like a `pick`.
export type AlignmentEffect = { id: string; alignment: Alignment[] };

// Generate gear: roll `count` times on the equipment generator (column =
// subtype), then on the availability table, limited to `availability`
// (omitted: the availability of the character's previous gear effect).
//  - downgrade: steps to downgrade generated availabilities; { steps, only }
//    downgrades only results whose generator row is named in `only`
//    ("all other weapons generated").
//  - require: generated results must include, for each list, a row named in
//    it ("at least one melee and ranged weapon, and one piece of armour");
//    the last slots are re-rolled until they do.
export type GearEffect = {
  id: string;
  gear: {
    count: Dice;
    availability?: Availability[];
    alien?: boolean | Condition; // may generate alien gear
    downgrade?: number | { steps: number; only?: string[] };
    exclude?: string[]; // never generated (matched like PickFilter.exclude)
    require?: string[][];
  };
};

// Generate psychic powers. A power whose difficulty is a formula ("TT/2")
// counts as within any maxDifficulty.
export type PowersEffect = {
  id: string;
  powers: {
    count: Dice;
    maxDifficulty?: number;
    crossDisciplinePenalty?: number; // "or D6-1 if … across different disciplines"
    disciplines?: string[];
    // random mode rolls this table for each power (its rows grant powers;
    // results the effect doesn't allow are re-rolled), in `column` of a
    // multi-column table; freeform offers the powers the table can give
    table?: string;
    column?: string;
  };
};

// Text the engine doesn't interpret. `kind`:
//  - "gameplay": affects play, not the character's build (most talent text)
//  - "gm": needs GM judgement ("GM may…", "if the GM approves")
//  - "unfit": should be structured but the vocabulary can't express it yet;
//    `proposal` describes the effect type that would.
export type ProseEffect = {
  prose: string;
  kind: "gameplay" | "gm" | "unfit";
  proposal?: string;
};

// Armour on hit locations (the GM sheet's Armour row). A piece has `av` or
// counts `as` another item's armour (`av` then replaces its value, `add`
// adds to it); per location the best piece counts. An effect with only
// `add` is extra AV on top of whatever is worn ("+5 AV to all locations").
// `field` is a force field's dice ("D10"), rolled in play. `locations`
// defaults to all; `choose: N` lets the player choose N of `locations`
// ("two adjacent hit locations of your choice"). Dice need an `id`.
export type ArmourEffect = {
  id?: string;
  armour: {
    av?: Dice;
    add?: Dice;
    as?: string;
    field?: Dice;
    locations?: LocationSet | LocationSet[];
    choose?: number;
  };
};

// What a restriction or exclusivity is about: entries of `pool`, narrowed
// by group/category/tag (names matched like PickFilter.tag).
export type Restriction = {
  pool: Pool;
  group?: string[];
  category?: string[];
  tag?: string[];
  only?: string[]; // of those, only these are allowed (names)
  except?: string[]; // of those, these never are (names)
  maxAV?: number; // armour: only pieces whose best AV is at most this
  alien?: false; // no alien entries
};
// The character can't have entries the restriction refuses: pools, gear,
// powers and table results skip them; anything else breaking it (an
// override) is a warning.
export type RestrictEffect = { restrict: Restriction };
// "Can't be used in conjunction with other …": while the character has the
// entry this effect belongs to, it can't have any other entry in scope.
export type ExclusiveEffect = { exclusive: { pool: Pool; group?: string[]; category?: string[]; tag?: string[] } };

// Change a derived value on the sheet. `counts` counts a stat as higher or
// lower for working it out ("counts their Toughness as 20 higher for … Base
// Injury Value"); `set` may be "No" (Curse of Thlezzloath's SS and Cnc); a
// list of values goes with a list of derived values.
export type DerivedEffect = {
  id?: string;
  derived: DerivedStat | DerivedStat[];
  add?: Dice;
  set?: number | "No" | (number | "No")[];
  counts?: Partial<Record<Stat, number>>;
};

// A value the character has that isn't a stat ("Warp Strength", "Binding
// Level", "Encumbrance Limit"): the book's name, set or added to.
export type AttributeEffect = { id?: string; attribute: string; set?: Dice | StatFormula; add?: Dice | StatFormula };

// Effects that hold only while the item is wielded ("Characters get the
// Butcherman Talent and -20 Willpower while they wield this weapon"). Not
// applied to the build; listed on the character.
export type WieldedEffect = { wielded: Effect[] };

// The character loses these if it has them (Warp Disruptor).
export type RemoveEffect = {
  remove: { talent?: string[]; exotic?: string[]; item?: string[]; mutation?: string[]; power?: string[] };
};

// Reloads for every firearm the character has: `add` extra clips, `multiply`
// the starting ammunition.
export type ReloadsEffect = { reloads: { add?: number; multiply?: number } };

// Give something up at creation to gain something else. Asked `times` times
// (default 1; "any" = as often as the player likes); random mode never
// trades. `give`:
//  - lose: kinds of things to give up (count of them, default 1), filtered;
//    `generated: true` = only things that came from a roll or a choice;
//  - downgrade: steps to downgrade generated gear results (count of them);
//    a downgraded result's item is chosen again; a Common one is lost.
export type TradeEffect = {
  id: string;
  trade: {
    give: { lose?: Pool | Pool[]; downgrade?: number; count?: number; generated?: boolean; filter?: PickFilter };
    get: Effect[];
    times?: number | "any";
  };
};

// Raise one generated gear result's availability by N steps and choose its
// item (the equipment rule's "one step higher and you pick").
export type UpgradeEffect = { id: string; upgrade: number };

// Bionics: roll `count` times on the bionics table (default
// "bionics-table"); every bionic is of `quality`, each with an `upgrade`%
// chance of the next quality up.
export type BionicsEffect = {
  id: string;
  bionics: { count: Dice; quality?: Quality; upgrade?: number; table?: string; only?: string[] }; // only: these rows (labels); others re-rolled
};

// A natural weapon: a row on the sheet's Melee (Reach…) or Firearm (Type…)
// table, with profile columns named as the items' profiles name them.
export type WeaponEffect = { weapon: { name?: string; profile: Record<string, string>; qty?: number } };

// Opens more entries to the character's pools: talent groups ("can take
// Space Marine Talents") or power disciplines.
export type AccessEffect = { access: { pool: Pool; group: string[] } };

// "All Navigator Characters are psykers."
export type PsykerEffect = { psyker: true };

// A model that comes with the character ("May be accompanied by a Technical
// Servitor").
export type CompanionEffect = { companion: { archetype: string; subtype?: string; option?: string } };

// A warband rule (a warning, never a block): at most `max` characters of
// these archetypes.
export type WarbandEffect = { warband: { max: number; archetype: string[] } };

// Hit locations: choose (or roll, `random: true`) one of `from` ("Choose one
// of the character's hands", "A random limb"), or add one ("grows an
// additional arm").
export type LocationEffect =
  | { id: string; location: { from: Location[]; random?: boolean } }
  | { location: { add: string } };

const EffectArray: z.ZodType<Effect[]> = z.lazy(() => z.array(Effect));

export const Option: z.ZodType<Option> = z.lazy(() =>
  z.strictObject({
    id: Id,
    name: z.string(),
    text: z.string().optional(),
    when: Condition.optional(),
    effects: EffectArray.optional(),
  }),
);

const StatField = z.union([Stat, z.array(Stat).min(1), z.literal("all")]);
const Names = z.array(z.string()).optional();

export const PickFilter: z.ZodType<PickFilter> = z.strictObject({
  group: Names,
  category: Names,
  tag: Names,
  exclude: Names,
  availability: z.array(Availability).optional(),
  discipline: Names,
  maxDifficulty: z.number().int().optional(),
  owned: z.boolean().optional(),
});

const grantExtras = {
  note: z.string().optional(),
  variant: z.string().optional(),
  set: z.record(z.string(), z.array(z.string())).optional(),
  again: z.boolean().optional(),
};
const Scope = { group: Names, category: Names, tag: Names };

export const Effect: z.ZodType<Effect> = z.lazy(() =>
  z.union([
    z
      .strictObject({
        id: Id.optional(),
        stat: StatField,
        add: z.union([Dice, StatFormula]).optional(),
        set: Dice.optional(),
        multiply: z.number().positive().optional(),
        max: z.union([z.number().int(), z.literal("average")]).optional(),
        min: z.number().int().optional(),
        each: z.boolean().optional(),
      })
      .refine(
        (e) => e.add !== undefined || e.set !== undefined || e.multiply !== undefined || e.max !== undefined || e.min !== undefined,
        { message: "stat effect needs add, set, multiply, max or min" },
      ),
    z.strictObject({ talent: Id, ...grantExtras }),
    z.strictObject({ exotic: Id, ...grantExtras }),
    z.strictObject({
      item: Id,
      qty: Dice.optional(),
      quality: Quality.optional(),
      implanted: z.boolean().optional(),
      reloads: z.number().int().nonnegative().optional(),
      alterations: z.array(Id).optional(),
      covers: z
        .strictObject({ locations: z.union([LocationSet, z.array(LocationSet).min(1)]).optional(), choose: Dice.optional() })
        .refine((a) => a.locations !== undefined || a.choose !== undefined, { message: "covers needs locations or choose" })
        .optional(),
      ...grantExtras,
    }),
    z.strictObject({ mutation: Id, ...grantExtras }),
    z.strictObject({ power: Id, ...grantExtras }),
    z
      .strictObject({
        id: Id,
        pick: z.union([Dice, z.literal("any"), z.strictObject({ max: z.number().int().positive() })]),
        from: z.array(z.union([Option, Effect])).optional(),
        pool: Pool.optional(),
        filter: PickFilter.optional(),
        distinct: z.boolean().optional(),
        qty: Dice.optional(),
        implanted: z.boolean().optional(),
        into: z.string().optional(),
        random: Dice.optional(),
      })
      .refine((e) => (e.from === undefined) !== (e.pool === undefined), { message: "pick needs exactly one of from/pool" }),
    z.strictObject({ id: Id, optional: EffectArray }),
    z.strictObject({
      id: Id,
      chance: z.union([
        z.number().positive().max(100),
        z.strictObject({ die: Dice, on: z.array(z.number().int()).min(1) }),
      ]),
      then: EffectArray,
      else: EffectArray.optional(),
    }),
    z.strictObject({
      id: Id,
      roll: Id,
      times: Dice.optional(),
      column: z.union([z.string(), z.strictObject({ owned: z.record(z.string(), z.array(z.string()).min(1)), else: z.string().optional() })]).optional(),
      rerollDuplicates: z.boolean().optional(),
      qty: Dice.optional(),
      rerollUnless: z.strictObject({ profile: z.string(), includes: z.string() }).optional(),
      matchAvailability: z.boolean().optional(),
      // "At the beginning of each game, … roll on …": the book's sentence. The
      // roll isn't made when the character is built: the character shows this
      // sentence instead of a result, and the GM's sheet lists the table
      // unrolled (docs/RULES-FORMAT.md, "Rolled each game").
      eachGame: z.string().min(1).optional(),
    }),
    z.strictObject({ when: Condition, then: EffectArray, else: EffectArray.optional() }),
    z.strictObject({ id: Id, alignment: z.array(Alignment).min(1) }),
    z.strictObject({
      id: Id,
      gear: z.strictObject({
        count: Dice,
        availability: z.array(Availability).min(1).optional(),
        alien: z.union([z.boolean(), Condition]).optional(),
        downgrade: z
          .union([z.number().int(), z.strictObject({ steps: z.number().int(), only: z.array(z.string()).optional() })])
          .optional(),
        exclude: z.array(z.string()).optional(),
        require: z.array(z.array(z.string()).min(1)).optional(),
      }),
    }),
    z.strictObject({
      id: Id,
      powers: z.strictObject({
        count: Dice,
        maxDifficulty: z.number().int().optional(),
        crossDisciplinePenalty: z.number().int().optional(),
        disciplines: z.array(z.string()).optional(),
        table: Id.optional(),
        column: z.string().optional(),
      }),
    }),
    z.strictObject({
      prose: z.string(),
      kind: z.enum(["gameplay", "gm", "unfit"]),
      proposal: z.string().optional(),
    }),
    z.strictObject({
      id: Id.optional(),
      armour: z
        .strictObject({
          av: Dice.optional(),
          add: Dice.optional(),
          as: Id.optional(),
          field: Dice.optional(),
          locations: z.union([LocationSet, z.array(LocationSet).min(1)]).optional(),
          choose: z.number().int().positive().optional(),
        })
        .refine((a) => a.av !== undefined || a.add !== undefined || a.as !== undefined || a.field !== undefined, {
          message: "armour needs av, add, as or field",
        }),
    }),
    z.strictObject({
      restrict: z.strictObject({
        pool: Pool,
        ...Scope,
        only: Names,
        except: Names,
        maxAV: z.number().optional(),
        alien: z.literal(false).optional(),
      }),
    }),
    z.strictObject({ exclusive: z.strictObject({ pool: Pool, ...Scope }) }),
    z
      .strictObject({
        id: Id.optional(),
        derived: z.union([DerivedStat, z.array(DerivedStat).min(1)]),
        add: Dice.optional(),
        set: z
          .union([z.number(), z.literal("No"), z.array(z.union([z.number(), z.literal("No")])).min(1)])
          .optional(),
        counts: z.partialRecord(Stat, z.number()).optional(),
      })
      .refine((e) => e.add !== undefined || e.set !== undefined || e.counts !== undefined, {
        message: "derived needs add, set or counts",
      }),
    z
      .strictObject({
        id: Id.optional(),
        attribute: z.string().min(1),
        set: z.union([Dice, StatFormula]).optional(),
        add: z.union([Dice, StatFormula]).optional(),
      })
      .refine((e) => e.set !== undefined || e.add !== undefined, { message: "attribute needs set or add" }),
    z.strictObject({ wielded: EffectArray }),
    z.strictObject({
      remove: z.strictObject({
        talent: z.array(Id).optional(),
        exotic: z.array(Id).optional(),
        item: z.array(Id).optional(),
        mutation: z.array(Id).optional(),
        power: z.array(Id).optional(),
      }),
    }),
    z.strictObject({ reloads: z.strictObject({ add: z.number().int().optional(), multiply: z.number().positive().optional() }) }),
    z.strictObject({
      id: Id,
      trade: z.strictObject({
        give: z
          .strictObject({
            lose: z.union([Pool, z.array(Pool).min(1)]).optional(),
            downgrade: z.number().int().positive().optional(),
            count: z.number().int().positive().optional(),
            generated: z.boolean().optional(),
            filter: PickFilter.optional(),
          })
          .refine((g) => (g.lose === undefined) !== (g.downgrade === undefined), { message: "give needs lose or downgrade" }),
        get: EffectArray,
        times: z.union([z.number().int().positive(), z.literal("any")]).optional(),
      }),
    }),
    z.strictObject({ id: Id, upgrade: z.number().int().positive() }),
    z.strictObject({
      id: Id,
      bionics: z.strictObject({
        count: Dice,
        quality: Quality.optional(),
        upgrade: z.number().positive().max(100).optional(),
        table: Id.optional(),
        only: z.array(z.string()).min(1).optional(),
      }),
    }),
    z.strictObject({
      weapon: z.strictObject({
        name: z.string().optional(),
        profile: z.record(z.string(), z.string()),
        qty: z.number().int().positive().optional(),
      }),
    }),
    z.strictObject({ access: z.strictObject({ pool: Pool, group: z.array(z.string()).min(1) }) }),
    z.strictObject({ psyker: z.literal(true) }),
    z.strictObject({ companion: z.strictObject({ archetype: Id, subtype: Id.optional(), option: Id.optional() }) }),
    z.strictObject({ warband: z.strictObject({ max: z.number().int().nonnegative(), archetype: z.array(Id).min(1) }) }),
    z.strictObject({ id: Id, location: z.strictObject({ from: z.array(Location).min(1), random: z.boolean().optional() }) }),
    z.strictObject({ location: z.strictObject({ add: z.string().min(1) }) }),
  ]),
);

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

const Pos = z.tuple([z.number(), z.number()]).optional(); // canvas position

const base = {
  id: Id,
  name: z.string(),
  source: Source,
  pos: Pos,
  // power points for the balance score (talents, abilities, items, …);
  // estimated, then tuned on the canvas
  points: z.number().optional(),
  // kept in the data but shown nowhere: not served to the app (no pickers,
  // random rolls, balance or rules canvas); docs/RULES-FORMAT.md, "Hidden entries"
  hidden: z.boolean().optional(),
};

export const Subtype = z.strictObject({
  id: Id,
  name: z.string(),
  // a stat line: dice per stat ("60+2D10") or fixed numbers (Cherubim)
  stats: z.record(Stat, Dice),
  // the archetype's subtypeDie result that gives this subtype ("On a 1-3:
  // they're a Rookie")
  range: z.tuple([z.number().int(), z.number().int()]).optional(),
});
export type Subtype = z.infer<typeof Subtype>;

export const Archetype = z.strictObject({
  ...base,
  kind: z.literal("archetype"),
  gmApproval: z.boolean().optional(), // marked * in the book
  // one character of the archetype in the book's words: its stat table's header
  // without "Characters" ("Inquisitor Characters" → Inquisitor), or the p3
  // list's singular; used where the name reads as a single character
  characters: z.string().optional(),
  human: z.boolean().optional(), // stats can't surpass 100 (default true)
  // the subtype is rolled: this die against each subtype's `range`
  // (Alien Bounty Hunter's Level Of Experience); see rollSubtype()
  subtypeDie: Dice.optional(),
  subtypes: z.array(Subtype).min(1),
  // Book sections in order (Equipment, Armour, Psychic Abilities, Exotic
  // Abilities, Talents, Mutations, Alignment, …), each a list of effects.
  sections: z.array(z.strictObject({ name: z.string(), effects: EffectArray })),
});
export type Archetype = z.infer<typeof Archetype>;

// Talents, exotic abilities, psyker talents, mutations, psychic powers: a
// name, the book's text, and (sometimes) effects on the character's build.
export const Ability = z.strictObject({
  ...base,
  kind: z.enum(["talent", "exotic", "mutation", "power"]),
  group: z.string().optional(), // "Psyker Talents", a psychic discipline, …
  // psychic powers: a number, or the book's formula ("TT/2", "Wp/2")
  difficulty: z.union([z.number().int(), z.string().min(1)]).optional(),
  text: z.string(),
  effects: EffectArray.optional(),
});
export type Ability = z.infer<typeof Ability>;

export const Item = z.strictObject({
  ...base,
  kind: z.literal("item"),
  group: z.string(), // "Ranged Weapons", "Armour", "Bionics", … as the book groups them
  category: z.string().optional(), // "Pistol", "Basic weapon", … (equipment generator results)
  availability: Availability.optional(),
  // "This item only counts as Rare for characters that are part of … the
  // Ecclesiarchy. Otherwise, the GM will say": the availability is `then`
  // (default: `availability`) when the condition holds, else `else`; "gm"
  // means none the engine can use (never generated or offered by
  // availability).
  availabilityWhen: z
    .strictObject({ when: Condition, then: Availability.optional(), else: z.union([Availability, z.literal("gm")]) })
    .optional(),
  // "Only characters who are part of … may take this weapon"
  requires: Condition.optional(),
  // "Combat Stimms don't have availability restrictions": counts as every availability
  unrestricted: z.boolean().optional(),
  alien: z.boolean().optional(),
  // "Chaos Product.", "Radical Product." (matched as "Chaos", "Radical", "Xenos")
  product: z.enum(["Chaos", "Radical", "Xenos"]).optional(),
  // names for filters and restrictions, matched exactly (none in the book's items yet)
  tags: z.array(z.string()).optional(),
  // the book's table columns, verbatim: { Type: "Pistol", Rng: "…", … }
  profile: z.record(z.string(), z.string()).optional(),
  // profile cells that change with the wielder: the first whose condition
  // holds (against final stats) replaces those cells
  profileWhen: z.array(z.strictObject({ when: Condition, profile: z.record(z.string(), z.string()) })).optional(),
  text: z.string().optional(),
  effects: EffectArray.optional(),
});
export type Item = z.infer<typeof Item>;

// A roll table. Single-column tables give each row a `range`; multi-column
// tables (boons: one column per subtype) give `ranges` per column, with a
// missing column meaning "–" (that column has no such row).
export const TableRow = z.strictObject({
  range: z.tuple([z.number().int(), z.number().int()]).optional(),
  ranges: z.record(z.string(), z.tuple([z.number().int(), z.number().int()])).optional(),
  label: z.string(), // the row's text in the book ("+10 WS", "Dodge")
  effects: EffectArray,
  // equipment generator: how many of the chosen item, by its availability
  // ("D3 of a Common type, or one of a less available type")
  qty: z.partialRecord(Availability, Dice).optional(),
  // equipment generator: the bionic quality of what the row makes, by the
  // rolled availability ("Crude Quality Bionics are Common, Average Bionics
  // are Rare, and Advanced Bionics are Exotic")
  quality: z.partialRecord(Availability, Quality).optional(),
});
export const Table = z.strictObject({
  ...base,
  kind: z.literal("table"),
  // the book's section it's printed under ("Armour", "Psychic Powers", …;
  // an article's table, the book's section it belongs with): its shelf on
  // the rules canvas
  group: z.string().optional(),
  die: Dice, // "D100", "D6", "2D10", …
  columns: z.array(z.string()).optional(),
  rerollDuplicates: z.boolean().optional(),
  rows: z.array(TableRow).min(1),
});
export type Table = z.infer<typeof Table>;
export type TableRow = z.infer<typeof TableRow>;

// Prose-only rules that aren't any of the above (warband steps, methodology).
export const Rule = z.strictObject({
  ...base,
  kind: z.literal("rule"),
  group: z.string().optional(), // the book's section it's printed under (an article's: none, the article itself)
  text: z.string(),
  effects: EffectArray.optional(),
  // The rule's effects apply to every character: right after the archetype
  // section named `after` (or before the one named `before`), else at the
  // end. Rules without `apply` only show their text.
  apply: z
    .union([z.literal(true), z.strictObject({ after: z.string().optional(), before: z.string().optional() })])
    .optional(),
});
export type Rule = z.infer<typeof Rule>;

export const Entry = z.discriminatedUnion("kind", [Archetype, Ability, Item, Table, Rule]);
export type Entry = z.infer<typeof Entry>;
export type EntryKind = Entry["kind"];

// data/rules/<pack>/pack.yaml
export const Pack = z.strictObject({
  id: Id,
  name: z.string(),
  // a shorter name for tight spots (a name another book shares, in brackets)
  short: z.string().optional(),
  // packs this one builds on; its entries with the same id replace theirs
  extends: z.array(Id).optional(),
});
export type Pack = z.infer<typeof Pack>;
