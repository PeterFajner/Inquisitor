# The engine

`src/shared/engine/` builds a character from a compendium (the stacked rule
packs, `src/shared/rules/compendium.ts`) and a character record. It is pure
TypeScript (no Node APIs) and runs in the browser and on the server.

| File | What |
|---|---|
| `dice.ts` | parse/validate dice strings, totals from faces, mean/min/max, `averageStats` |
| `rng.ts` | `splitmix32`, `rollDie` (rejection sampling), `seededRoller`, `cryptoRoller` |
| `record.ts` | `CharacterRecord`, `Override`, `parseRecord`, `newRecord`, `cloneRecord` |
| `build.ts` | `build()`, the `Character` it returns, the log, pending choices |
| `reroll.ts` | `reroll()`, `clearDecisions()`, `isUnder()` |
| `diff.ts` | `diff()`: what changes for a character when the rules change |
| `balance.ts` | `powerScore()`, `simulate()`, `summarize()`, `label()` |

## The record

```ts
type CharacterRecord = {
  v: 1;
  packs: string[];                   // the pack stack it was built with
  name: string;
  archetype: string;                 // archetype id
  subtype: string;                   // subtype id
  dice: Record<string, number[]>;    // decision key → faces, one per die
  choices: Record<string, string[]>; // decision key → chosen ids
  overrides: Override[];
  rulesVersion?: string;             // the rules repo commit it was built against
};

type Override =
  | { op: "stat"; stat: Stat; value: number }               // set a stat's final value
  | { op: "add"; kind: ThingKind; id: string; qty?: number } // give a talent/exotic/item/mutation/power
  | { op: "remove"; kind: ThingKind; id: string }           // take one away
  | { op: "alignment"; value: Alignment }
  | { op: "choice"; key: string; value: string[] };         // force a choice, as-is
```

Characters store dice faces, never seeds. `parseRecord(x)` validates
untrusted JSON (saved characters, Luna's output).

## build()

```ts
build(compendium, record, {
  mode: "random" | "freeform",
  roll?: (sides) => 1..sides,             // default: crypto RNG
  pick?: (p: PendingChoice) => string[] | undefined,
}) → { character, record, pending, log, warnings }
```

- Decisions already in the record are reused. Stored faces that no longer
  fit the dice (the rules changed D10 to D6) are rolled again with a
  warning; stored choices that are no longer allowed are chosen again.
- Missing dice are always rolled, in both modes.
- Missing choices: `pick` is asked first (both modes). Otherwise random mode
  chooses uniformly with `roll`; freeform mode leaves them in `pending` and
  applies nothing for them (partial choices already stored are applied).
  A choice with exactly as many options as picks is made without asking.
- The returned `record` is the input plus every new decision, minus
  decisions this character no longer uses (an option's nested picks after
  choosing another option). Rebuilding it reproduces the character exactly
  and rolls nothing.
- Throws `BuildError` for an unknown archetype or subtype; everything else
  is a warning.

`pick` may be called twice for one key: when a condition on the alignment
is met before the alignment is chosen (gear's `alien: { alignment }` in the
Equipment row, the Alignment row last), the build runs a second pass knowing
the alignment, keeping the dice and the alignment choice from the first.

### Order

1. The subtype's stat line (`<archetype>/@stats:<Stat>`).
2. Each section's effects in book order. Effects of a granted talent,
   exotic, mutation, power or item run once, the first time the character
   gets it.
3. Stats: base → adds/sets in order → caps (`max`, `min`, `max: average` =
   the subtype's stat line with every die at its mean, rounded down) → the
   human cap of 100 (unless `archetype.human === false`) = `modified`.
4. Overrides last (they don't re-trigger rules) = `final`, flagged.

### The character

```ts
type Character = {
  name; archetype: { id, name }; subtype: { id, name }; alignment?;
  options: { id, name, text?, key, source }[];          // named options chosen
  stats: Record<Stat, { base, modified, final, overridden, mods, caps }>;
  talents, exotics, mutations, powers: Owned[];          // { kind, id, name, from: Origin[], overridden? }
  items: (Owned & { qty })[];
  rolls: { key, table, label, availability?, lost? }[]; // every table result (boons: table "boons")
  notes: { text, kind: "gameplay" | "gm" | "unfit", proposal?, source, section? }[];
  warnings: string[];
  overridden: { stats, alignment, added, removed, choices };
};
type Origin = { entry, key?, section?, override? }; // entry id, the decision that gave it, the archetype row
```

### The log

One entry per decision, in order: `{ key, parent?, type: "dice" | "choice",
label, faces?, total?, result, reused, forced?, rerolled? }`. `label` and
`result` are book text only: entry, table, stat, row, option and item
names. `parent` is the decision whose outcome led to this one (the pick
that chose the option, the table roll whose row holds the effect).
`rerolled` marks a result rolled again (a duplicate, or gear the character
can't have).

### Pending choices

`{ key, parent?, kind: "pick" | "pool" | "optional" | "alignment" |
"gear-item" | "power", label, count, options: { id, label }[], chosen,
source }`. The answer goes in `record.choices[key]` as option ids:

- named options: the option's `id`;
- effects in a `pick … from`: the effect's `id`, else `<kind>:<id>` for a
  grant (`talent:dodge`), else `#<n>` (1-based position);
- pools, gear, powers: the entry id; optional: `yes` / `no`; alignment: the
  alignment.

## Decision keys

Every die roll and choice has a key built from ids, never positions, so
adding or removing unrelated effects leaves every other key alone.

| Key | Decision |
|---|---|
| `<archetype>/@stats:<Stat>` | the stat line's dice |
| `<entry>/<effect id>` | a pick, optional, chance, roll, alignment, gear or powers effect, or a stat effect with an `id` and dice |
| `<entry>/@<Stat>[+<Stat>…]` | a stat effect with dice and no `id` (give it an `id` to be safe) |
| `<entry>/@<item id>` | a grant's dice quantity |
| `<key>:<Stat>` | a stat effect with `each: true`, per stat |
| `<key>:set` | a stat effect's dice `set` |
| `<key>:count` | dice for how many (`pick: D3`, `times`, gear and powers `count`) |
| `<key>#<n>` | the n-th repeat (1-based): `times` table rolls, gear slots, power slots |
| `<key>~<n>` | the n-th attempt (n ≥ 2) at a roll re-rolled as a duplicate or unusable gear |
| `<key>:avail` | a gear slot's availability roll |
| `<key>:item` | a gear slot's item choice |
| `<key>><entry>/<effect id>` | an effect inside a table row's (or a gear slot's) result: the row's entry is the table |
| `<key>*<n>` | the same effect met again in the same place (n ≥ 2); rare |

Effects inside an option of the same entry need no nesting: effect ids are
unique within an entry (`inquisitor-acolyte/deductor-stat`). Effects of a
granted ability use the ability's id (`extra-arm/arm-strength`), nested
under the table result when the grant came from one.

Examples: `hero/boons:count`, `hero/boons#2`, `hero/boons#2~2` (#2 was a
duplicate), `hero/boons#5>boons/again` (row "Roll again" in boon 5),
`hero/gear#3~2:avail>weapon-availability/legendary`.

A key is *nested under* another (`isUnder`) when it continues it with `#`,
`~`, `:` or `>`. `reroll(compendium, record, key)` clears the key, keys
nested under it, and every decision whose `parent` chain leads to it (a
chosen option's nested picks); the next build makes them again.

## Conventions the engine relies on

- **Table `equipment-generator`**: the equipment generator. `columns` are
  subtype ids (`fighter`, `marksman`, `scout`, `sage`, `psyker`); a gear
  effect rolls in the character's subtype column. Each row's `label` is a
  category: an item is a candidate when its `category` matches the label,
  ignoring case, punctuation, a plural `s` and armour/armor (`Armour` ↔
  `Armor`, `Grenade` ↔ `Grenades`). A row with effects other than prose (a
  roll on a sub-table, a grant) makes its gear through those effects
  instead; a row whose category has no items keeps the result in `rolls`
  with its availability and warns.
- **Table `weapon-availability`**: rolled per gear slot; the row label names
  the availability (`Common`, `Rare`, `Exotic*`, `Legendary weapon` all
  work). A row with a `roll` effect rolls on (the book's 6 → roll another
  D6: `weapon-availability-legendary`), and that table's availability wins.
- Gear: the availability is downgraded by `downgrade` steps (Common
  downgraded is lost); an availability not in the effect's list, or no
  item of that category and availability (also excluding alien items
  unless `alien` allows them and anything in `exclude`, matched against
  item id, kebab-cased group or category), re-rolls the slot. The item is
  chosen among the candidates (random: uniform; freeform: pending).
- Missing tables degrade: no generator → no gear, a warning; no
  availability table → any allowed availability.
- **Duplicates** (`rerollDuplicates` on the table or the roll): a row is a
  duplicate when it directly grants a talent, exotic ability, mutation or
  power the character already has; stat rows never are ("all stat
  increases are cumulative").
- **Pools** (`pick … pool`) and **powers** never offer what the character
  already has (items excepted). `filter.group`/`discipline` match the
  entry's `group`; a power's discipline is its `group`.
- **Powers**: `count` slots, one choice each, among powers with
  `difficulty ≤ maxDifficulty` in `disciplines`. With
  `crossDisciplinePenalty`, once the chosen powers span more than one
  discipline the count drops by the penalty; slots past it are dropped.
- **Optional** effects flip a coin in random mode.
- **Chance**: a D100 ≤ `chance`.
- Candidates are always in id order, so random picks don't depend on file
  order. A compendium is treated as immutable: the engine caches sorted
  entries per map; call `invalidateCompendium(c)` after changing its maps
  in place (or build a new one).

## diff()

`diff(oldCompendium, newCompendium, record, { mode? })` builds the record
against both (freeform by default; dice the record lacks are previewed at a
middle face) and returns `{ changed, stats (final, from → to), alignment?,
gained, lost (things, with qty for items), options { gained, lost }, rolls
{ gained, lost } (row labels), needsRolling (new dice keys), pending (new
choices), dropped (record keys no longer used), warnings (new ones) }`.

## Balance

- `powerScore(character, compendium)`: the sum of final stats plus the
  `points` (default 0) of every talent, exotic, mutation and power, and
  every item × qty.
- `simulate(compendium, archetype, subtype, n, seed)`: `n` random
  characters from one seeded roller → `{ archetype, subtype, n, seed, mean,
  median, sd, min, max, p10, p25, p75, p90 }`.
- `label(score, dist)`: `sigma = (score − median) / sd`, rounded to 0.1;
  `balanced` within ±1σ, else `overpowered` / `underpowered`.
- `npm run simulate [-- --n=10000 --seed=1 pack…]` loads the packs in
  `RULES_DIR` (stacked by `extends`) and writes `data/balance.json` (or
  `BALANCE_FILE`): `{ generated, packs, n, seed, distributions: {
  "<archetype>/<subtype>": Distribution }, failures }`.
