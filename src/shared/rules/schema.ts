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
// Terms are integers or [N]D<M>, joined by + or -.
export const DICE_RE = /^[+-]?(\d*D\d+|\d+)([+-](\d*D\d+|\d+))*$/;
export const Dice = z.union([z.number().int(), z.string().regex(DICE_RE, "dice like 60+2D10")]);
export type Dice = z.infer<typeof Dice>;

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
  | { all: Condition[] };

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
  | ProseEffect;

// Change one or more stats. `add` may be dice ("-D10") and is rolled once per
// effect (the same amount for every listed stat unless `each` is set).
// `max`/`min` clamp; "average" is the subtype's stat line with every die at
// its mean, rounded down.
export type StatEffect = {
  id?: string;
  stat: Stat | Stat[] | "all";
  add?: Dice;
  set?: Dice;
  max?: number | "average";
  min?: number;
  each?: boolean;
};

// Give the character a specific thing.
export type GrantEffect =
  | { talent: string; note?: string }
  | { exotic: string; note?: string }
  | { item: string; qty?: Dice; note?: string }
  | { mutation: string; note?: string }
  | { power: string; note?: string };

// A named option: an Acolyte type, a faction, Grey Knight, a Cherubim role…
export type Option = {
  id: string;
  name: string;
  text?: string; // the book's description of the option (gameplay prose)
  effects?: Effect[];
};

// Pick N. Either from explicit options/effects, or "any N" from a pool of a
// kind of entry (optionally filtered). In random mode the engine picks at
// random; in freeform mode the user picks.
export type PickEffect = {
  id: string;
  pick: Dice;
  from?: (Option | Effect)[];
  pool?: "talent" | "exotic" | "item" | "mutation" | "power";
  filter?: { group?: string[]; availability?: Availability[]; discipline?: string[]; maxDifficulty?: number };
  distinct?: boolean; // default true
};

// "May have …": the player decides (random mode flips a coin).
export type OptionalEffect = { id: string; optional: Effect[] };

// "N% chance of …" (D100 ≤ chance).
export type ChanceEffect = { id: string; chance: number; then: Effect[]; else?: Effect[] };

// Roll on a table, `times` times (default 1). `column` picks a column of a
// multi-column table (boons are per subtype); "$subtype" means the
// character's subtype id. Duplicate results are re-rolled when the table or
// this effect says so.
export type RollEffect = {
  id: string;
  roll: string;
  times?: Dice;
  column?: string;
  rerollDuplicates?: boolean;
};

export type WhenEffect = { when: Condition; then: Effect[]; else?: Effect[] };

// Which alignments the character may have; picked like a `pick`.
export type AlignmentEffect = { id: string; alignment: Alignment[] };

// Generate gear: roll `count` times on the equipment generator (column =
// subtype), then on the availability table, limited to `availability`.
export type GearEffect = {
  id: string;
  gear: {
    count: Dice;
    availability: Availability[];
    alien?: boolean | Condition; // may generate alien gear
    downgrade?: number; // steps to downgrade every generated item's availability
    exclude?: string[]; // item groups never generated (e.g. "power-weapon")
  };
};

// Generate psychic powers.
export type PowersEffect = {
  id: string;
  powers: {
    count: Dice;
    maxDifficulty?: number;
    crossDisciplinePenalty?: number; // "or D6-1 if … across different disciplines"
    disciplines?: string[];
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

const EffectArray: z.ZodType<Effect[]> = z.lazy(() => z.array(Effect));

export const Option: z.ZodType<Option> = z.lazy(() =>
  z.strictObject({ id: Id, name: z.string(), text: z.string().optional(), effects: EffectArray.optional() }),
);

const StatField = z.union([Stat, z.array(Stat).min(1), z.literal("all")]);

export const Effect: z.ZodType<Effect> = z.lazy(() =>
  z.union([
    z
      .strictObject({
        id: Id.optional(),
        stat: StatField,
        add: Dice.optional(),
        set: Dice.optional(),
        max: z.union([z.number().int(), z.literal("average")]).optional(),
        min: z.number().int().optional(),
        each: z.boolean().optional(),
      })
      .refine((e) => e.add !== undefined || e.set !== undefined || e.max !== undefined || e.min !== undefined, {
        message: "stat effect needs add, set, max or min",
      }),
    z.strictObject({ talent: Id, note: z.string().optional() }),
    z.strictObject({ exotic: Id, note: z.string().optional() }),
    z.strictObject({ item: Id, qty: Dice.optional(), note: z.string().optional() }),
    z.strictObject({ mutation: Id, note: z.string().optional() }),
    z.strictObject({ power: Id, note: z.string().optional() }),
    z
      .strictObject({
        id: Id,
        pick: Dice,
        from: z.array(z.union([Option, Effect])).optional(),
        pool: z.enum(["talent", "exotic", "item", "mutation", "power"]).optional(),
        filter: z
          .strictObject({
            group: z.array(z.string()).optional(),
            availability: z.array(Availability).optional(),
            discipline: z.array(z.string()).optional(),
            maxDifficulty: z.number().int().optional(),
          })
          .optional(),
        distinct: z.boolean().optional(),
      })
      .refine((e) => (e.from === undefined) !== (e.pool === undefined), { message: "pick needs exactly one of from/pool" }),
    z.strictObject({ id: Id, optional: EffectArray }),
    z.strictObject({ id: Id, chance: z.number().positive().max(100), then: EffectArray, else: EffectArray.optional() }),
    z.strictObject({
      id: Id,
      roll: Id,
      times: Dice.optional(),
      column: z.string().optional(),
      rerollDuplicates: z.boolean().optional(),
    }),
    z.strictObject({ when: Condition, then: EffectArray, else: EffectArray.optional() }),
    z.strictObject({ id: Id, alignment: z.array(Alignment).min(1) }),
    z.strictObject({
      id: Id,
      gear: z.strictObject({
        count: Dice,
        availability: z.array(Availability).min(1),
        alien: z.union([z.boolean(), Condition]).optional(),
        downgrade: z.number().int().optional(),
        exclude: z.array(z.string()).optional(),
      }),
    }),
    z.strictObject({
      id: Id,
      powers: z.strictObject({
        count: Dice,
        maxDifficulty: z.number().int().optional(),
        crossDisciplinePenalty: z.number().int().optional(),
        disciplines: z.array(z.string()).optional(),
      }),
    }),
    z.strictObject({
      prose: z.string(),
      kind: z.enum(["gameplay", "gm", "unfit"]),
      proposal: z.string().optional(),
    }),
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
};

export const Subtype = z.strictObject({
  id: Id,
  name: z.string(),
  // a stat line: dice per stat ("60+2D10") or fixed numbers (Cherubim)
  stats: z.record(Stat, Dice),
});
export type Subtype = z.infer<typeof Subtype>;

export const Archetype = z.strictObject({
  ...base,
  kind: z.literal("archetype"),
  gmApproval: z.boolean().optional(), // marked * in the book
  human: z.boolean().optional(), // stats can't surpass 100 (default true)
  subtypes: z.array(Subtype).min(1),
  // Book sections in order (Equipment, Armor, Psychic Abilities, Exotic
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
  difficulty: z.number().int().optional(), // psychic powers
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
  alien: z.boolean().optional(),
  // the book's table columns, verbatim: { Type: "Pistol", Rng: "…", … }
  profile: z.record(z.string(), z.string()).optional(),
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
});
export const Table = z.strictObject({
  ...base,
  kind: z.literal("table"),
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
  text: z.string(),
  effects: EffectArray.optional(),
});
export type Rule = z.infer<typeof Rule>;

export const Entry = z.discriminatedUnion("kind", [Archetype, Ability, Item, Table, Rule]);
export type Entry = z.infer<typeof Entry>;
export type EntryKind = Entry["kind"];

// data/rules/<pack>/pack.yaml
export const Pack = z.strictObject({
  id: Id,
  name: z.string(),
  // packs this one builds on; its entries with the same id replace theirs
  extends: z.array(Id).optional(),
});
export type Pack = z.infer<typeof Pack>;
