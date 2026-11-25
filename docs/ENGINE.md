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
| `derived.ts` | `deriveStats()`: Kbk, BIV, SS, Cnc, Spd (docs/DERIVED-STATS.md) |
| `warband.ts` | `warbandWarnings()`: the warband rules a set of characters breaks |

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
  Open picks (`pick: any`, `{ max: N }`) accept any number from `min` (0)
  to `count`; random mode takes `random` of them (none for `any`, 0..N for
  `max`, rolled as `D(N+1)-1` under `<key>:count`). Trades are declined in
  random mode (`no`) unless `pick` answers.
- The returned `record` is the input plus every new decision, minus
  decisions this character no longer uses (an option's nested picks after
  choosing another option). Rebuilding it reproduces the character exactly
  and rolls and asks nothing: a record holding decisions is first built
  without rolling or calling `pick` for real (a seeded stand-in roller,
  `pick` answering nothing), and that is the character when its last pass
  used nothing the record lacks (an earlier pass may need dice the record
  never kept: a row a restriction met later refuses); else it is built
  again, rolling and asking.
- Throws `BuildError` for an unknown archetype or subtype; everything else
  is a warning.

`pick` may be called twice for one key: the build runs another pass when a
pass meets something late, keeping the dice and the choices of the one
before (a choice the late restriction refuses is made again among what it
allows, so random builds keep the book's odds):

- a condition on the alignment before the alignment is chosen (gear's
  `alien: { alignment }` in the Equipment row, the Alignment row last).
  A replay knows the alignment from the record, so it needs no second pass.
- a `restrict`, `exclusive` or `access` effect met after the decisions it
  limits (the Armour row comes after the Equipment row's gear). Those stated
  outright in an archetype's sections are known before the first pass.
- a condition on an option before the pick offering it is made (Cherubim:
  the Equipment row's auspex isn't for the Seer, chosen under Cherubim
  Roles). Once the pick is made, the condition is whether it chose it.
- gear the finished character can't use: a `required` pick (a Chainblade's
  mount) with nothing to choose from once all the gear is made. The
  outermost roll or gear result that led to it is rolled again (`~n`); the
  decisions that made it stay in the record, so a replay finds the same.

At most six passes. The character's `restrictions` are the archetype's
own and those the last pass met.

### Order

1. The subtype's stat line (`<archetype>/@stats:<Stat>`); the subtype roll
   (`<archetype>/@subtype`) when the record has one, checked against the
   subtype.
2. Each section's effects in book order, with the effects of rules that
   `apply` (in rule id order) before or after the section they name, or
   after the last section. Effects of a granted talent, exotic, mutation,
   power or item run once, the first time the character gets it, except:
   a grant with `set`, `again` or a `quality` runs them again, and an
   item whose effects decide something (a pick, roll, chance or optional)
   runs them for every grant (each Bionic Organs rolls its own organ, each
   Executor Pistol chooses its own toxins), and so does a grant with
   `covers`. Picks among named options run again by `again` offer what the
   entry hasn't chosen yet (another prayer).
   Picks among what the character owns into something (`filter: { owned:
   true }` with `into`: Study Thy Weapon's weapon, a mount, an MIU's
   equipment) are made after the last section and rule, once all the gear
   is made, under the keys they had where they were met.
3. Stats: base (the rolled stat line, capped at 100 unless
   `archetype.human === false`: the book's cap applies to the roll, and
   later bonuses may pass it) → adds/sets in order → formula adds (`{ stat:
   S, divide: 10 }`, worked out from the stats after their adds/sets) → caps
   (`max`, `min`, `max: average` = the subtype's stat line with every die at
   its mean, rounded down) → multiplies (Power Armour's ×1.2, rounded off) =
   `modified`.
4. `remove` effects (Warp Disruptor) take things away.
5. Overrides last (they don't re-trigger rules) = `final`, flagged.
6. From the final stats: derived values (`deriveStats` with any `counts`,
   then adds, then sets), attributes, item profiles (`profileWhen`), armour
   per location.

### The character

```ts
type Character = {
  name; archetype: { id, name }; subtype: { id, name }; alignment?;
  options: { id, name, text?, key, source }[];          // named options chosen
  stats: Record<Stat, { base, modified, final, overridden, mods, caps }>;
  talents, exotics, mutations, powers: Owned[];          // { kind, id, name, from: Origin[], overridden? }
  items: (Owned & { qty })[];
  rolls: { key, table, label, availability?, lost? }[]; // every table result (boons: table "boons")
  eachGame: { key, table, text, source }[];             // rolls left for the start of each game (a roll's `eachGame`)
  empty: { key, name, variants, source }[];             // item picks a roll led to with nothing to choose from
  notes: { text, kind: "gameplay" | "gm" | "unfit", proposal?, source, section? }[];
  warnings: string[];
  overridden: { stats, alignment, added, removed, choices };
  // the rest of the GM sheet
  armour: Record<Location, { av, fields: string[], from: string[] }>; // per hit location
  armourPieces: { source, name, locations, av?, add?, field? }[];
  derived: Record<"Kbk" | "BIV" | "SS" | "Cnc" | "Spd", { base, value: number | "No", mods }>;
  attributes: { name, value, source }[];                // Warp Strength, Encumbrance Limit…
  weapons: { name, profile, qty, source }[];             // natural weapons (Barbed Tail)
  wielded: { source, name, effects: string[] }[];       // effects only while that item is wielded (labels)
  taken: { kind, id, name, by }[];                      // lost to a remove effect
  reloads: { add, multiply };                           // for every firearm
  psyker: boolean;
  companions: { archetype, subtype?, option?, source, key, parent? }[];   // see "Companions"
  locations: { source, location }[];                    // chosen, rolled or added hit locations
  restrictions: (Restriction & { source, exclusive? })[];
};
type Origin = { entry, key?, section?, override? }; // entry id, the decision that gave it, the archetype row
type Owned = { kind, id, name, from: Origin[], overridden?,
  variants?: string[][],   // per run of its own effects: option names and row labels it chose/rolled, its quality
  chosen?: { key, kind, id, name }[], // picks `into` it (a toxin, a power, a weapon)
  restricted? };           // breaks a restriction (an override)
type OwnedItem = Owned & { qty, implanted?, reloads?, alterations?,
  availability?,           // for this character (availabilityWhen, a step up per alteration)
  profile? };              // the profile for this wielder, when profileWhen changes it
```

StatMod gains `multiply` and `formula` (its `add` is filled in at the end).

### The log

One entry per decision, in order: `{ key, parent?, type: "dice" | "choice",
label, faces?, total?, result, reused, forced?, rerolled? }`. `label` and
`result` are book text only: entry, table, stat, row, option and item
names. `parent` is the decision whose outcome led to this one (the pick
that chose the option, the table roll whose row holds the effect).
`rerolled` marks a result rolled again (a duplicate, or gear the character
can't have). `eachGame` marks a roll the book makes at the start of each
game: no dice, and its result is the book's sentence.

A roll that leads to an item pick with nothing to choose from (Dead Or
Alive's Heavy weapon on a Common: the book has no Common heavy weapon)
leaves an `empty` result named by the table results that led to it,
outermost first (`{ name: "Heavy weapon", variants: ["Common"] }`), so the
character shows "Heavy weapon (Common)" and the GM sees the roll happened.

### Pending choices

`{ key, parent?, kind: "pick" | "pool" | "optional" | "alignment" |
"gear-item" | "power" | "trade" | "give" | "upgrade" | "location", label,
count, min?, options: { id, label }[], chosen, source }`. `min` is set on
open picks: any number from `min` to `count` answers it. The answer goes in
`record.choices[key]` as option ids:

- named options: the option's `id`;
- effects in a `pick … from`: the effect's `id`, else `<kind>:<id>` for a
  grant (`talent:dodge`), else `#<n>` (1-based position);
- pools, gear, powers: the entry id; optional and trade: `yes` / `no`;
  alignment: the alignment; location: the location (`Left Arm`);
- give (what a trade gives up): `<kind>:<id>` for `lose`, the gear
  result's key (`hero/gear#2`) for `downgrade`; upgrade: the gear result's
  key.

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
| `<key>~<n>` | the n-th attempt (n ≥ 2) at a roll re-rolled as a duplicate, unusable gear, or gear the finished character can't use |
| `<key>:avail` | a gear slot's availability roll |
| `<key>:item` | a gear slot's item choice |
| `<key>><entry>/<effect id>` | an effect inside a table row's (or a gear slot's) result: the row's entry is the table |
| `<key>*<n>` | the same effect met again in the same place (n ≥ 2): a grant's effects run again (`set`, `again`) |
| `<archetype>/@subtype` | the subtype roll (`subtypeDie`) |
| `<key>:qty` | a quantity: a pick's `qty` (`<entry>/<effect id>:qty`), a roll's `qty`, a gear result's qty by availability (`<slot>:qty`) |
| `<slot>:upgrade` | a bionic's chance of the next quality up |
| `<entry>/<id or @av>` / `…:add` / `<entry>/@locations` | armour dice and chosen locations |
| `<trade>#<n>` | the n-th time a trade is offered (yes/no) |
| `<trade>#<n>:give` | what it gives up |
| `<give>><slot>:item` | the item chosen again for a downgraded (or upgraded) gear result |
| `<trade>#<n>><entry>/<effect id>` | what the trade gets |
| `<parent>>@companion` (or `<entry>/@companion`) | a companion's key; its own decisions are `<that>><its key>` (see Companions) |

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
chosen option's nested picks); the next build makes them again. Re-rolling
a pick's random count (`<pick>:count`) clears the pick too.

## Conventions the engine relies on

- **Table `equipment-generator`**: the equipment generator. `columns` are
  subtype ids (`fighter`, `marksman`, `scout`, `sage`, `psyker`); a gear
  effect rolls in the character's subtype column. Each row's `label` is a
  category: an item is a candidate when its `category` is the label,
  exactly (`Armour`, `Close combat weapon`). A row with effects other than prose (a
  roll on a sub-table, a grant) makes its gear through those effects
  instead; a row whose category has no items keeps the result in `rolls`
  with its availability and warns. While a row's effects run, the condition
  `{ availability: [...] }` tests the result's availability (Armour rolls
  Common, Rare, Exotic or Legendary Armour by it), and a roll with
  `matchAvailability` re-rolls rows whose items are of another availability
  (an item with none, or `unrestricted`, fits any). Under a gear result an
  item whose `availabilityWhen` leaves it to the GM is never generated. A
  row whose rolls can't land on anything the character may have (Combat
  Stimms for a Tech-Priest, Special ammunition of an availability no
  ammunition has) re-rolls the slot, and so does one granting an item the
  gear effect's `alien` or `exclude` refuses (Teef from
  rare-miscellaneous-gear for a Puritan). Rows rolling a `column: { owned }`
  (Special ammunition: the column of a weapon the character carries) are
  made after the effect's other results. Item picks in a row's effects
  leave out what the gear effect's `alien` and `exclude` refuse too.
- **Table `weapon-availability`**: rolled per gear slot; the row label names
  the availability (`Common`, `Rare`, `Exotic*`, `Legendary weapon` all
  work). A row with a `roll` effect rolls on (the book's 6 → roll another
  D6: `weapon-availability-legendary`), and that table's availability wins.
- Gear: the availability is downgraded by `downgrade` steps (Common
  downgraded is lost); an availability not in the effect's list, or no
  item of that category and availability (also excluding alien items
  unless `alien` allows them and anything in `exclude`, matched exactly
  against item id, group, category, tags, product or `alien`), re-rolls the slot. The item is
  chosen among the candidates (random: uniform; freeform: pending).
- Missing tables degrade: no generator → no gear, a warning; no
  availability table → any allowed availability.
- **Duplicates** (`rerollDuplicates` on the table or the roll, inherited by
  every roll nested under it: boons → "Exotic ability" → the exotic
  table): a row is a duplicate when it grants (directly or in a `when`) a
  talent, exotic ability, mutation or power the character already has,
  other than only from its gear's own effects (the book makes boons, step B,
  before equipment, step C), or that its profile grants outright in a later
  section (step A comes first); stat rows never are ("all stat increases
  are cumulative"). Picks among grants under such a roll leave out the
  same. A row is also re-rolled when it grants anything a restriction
  refuses, fails the roll's `rerollUnless`, or rolls on a table none of
  whose rows it could use (checked through nested rolls; a roll on a table
  already being checked is a dead end). At most `MAX_REROLLS` (200)
  attempts.
- **Creating A Character**: the rule `creating-a-character` with `apply: {
  after: Talents }` rolls the boons (D3+3 on the subtype's column,
  duplicates re-rolled) for Fighter, Marksman, Scout, Sage and Psyker
  subtypes, after the profile's talents and exotic abilities (step A),
  under keys `creating-a-character/boons…`. The book lists a profile's
  Talents after its Equipment and boons such as Study Thy Weapon pick among
  the gear, so they run there; what only gear gave isn't a duplicate.
- **Table `bionics-table`**: `bionics` effects roll on it unless they name
  a `table` (`only`: just these row labels, others re-rolled: Skitarii's
  "random body part"). An equipment generator row's `quality` gives what it
  makes the quality of the rolled availability; an item granted with a
  quality answers its own `quality` pick (a pick's option id, `average`, or
  a roll's row label, `Average`) and lists the quality in its variants. Bionic Limb and
  Bionic sense roll Bionic Quality only when nothing gives one.
- **Variants**: a grant's `variant` (the limb or sense a Bionic Limbs row
  names) is listed first in that unit's variants; `covers` makes the item's
  armour cover those locations (or `choose` dice of them) for that grant.
- **Restrictions** apply to pools, gear candidates, powers, table results
  and from-picks among grants; an item's `requires` too. Pools, gear
  candidates, table results and from-picks also leave out an entry whose
  fixed grants a restriction refuses or whose own picks (not open ones,
  nor picks among what it owns into something unless `required` and met
  outside a roll or gear result) would have nothing to choose from
  (`takeable()`), and a named option whose effects are like that
  (`fulfils()`; when no option is left, all are offered). Availability
  filters and gear use an item's availability for this character
  (`availabilityWhen`; `unrestricted` items fit any).
- **Armour**: per location, the best piece (`av`/`as`) of everything the
  character has, plus every extra (`add` without `av`); force fields are
  listed. Pieces and other contributions of a thing taken away (trade,
  remove, override) go with it.
- **Trades** (`downgrade`): a downgraded gear result loses its item and
  chooses again one step down among the same category; Common is lost
  (`rolls[…].lost`). Only results whose items were chosen by category can
  be downgraded or upgraded (not sub-table rows).
- **Pools** (`pick … pool`) and **powers** never offer what the character
  already has (items excepted). `filter.group`/`discipline` are the
  entry's `group`, exactly; a power's discipline is its `group`.
- **Powers**: a powers effect with a count makes the character a psyker
  when it is met (the `psyker` condition), unless `wyrd`; a Wyrd's powers
  don't count as having powers there, and `access` doesn't widen it.
  `count` slots, one choice each, among powers with
  `difficulty ≤ maxDifficulty` in `disciplines` (plus any `access` power
  groups). A formula difficulty (`TT/2`, `Wp/2`, `Wt`) counts as within any
  maximum (`difficultyWithin()`); a power with no difficulty never does. With
  `crossDisciplinePenalty`, once the chosen powers span more than one
  discipline the count drops by the penalty; slots past it are dropped.
  With a `table` (p82: Starting Powers for each Discipline for a maximum
  difficulty of 10, Random Psychic Power otherwise, a Wyrd's discipline
  column) only powers the table can give are candidates, and a slot with no
  stored choice is rolled on the table (random mode, or a record that holds
  the slot's dice) under the slot's key: rows giving a power the slot
  doesn't allow (taken, restricted, past the maximum) or no power at all
  ("Re-roll") are rolled again. Freeform offers the table itself as an
  option (`ROLL_OPTION`, labelled with the table's name; `randomPick`
  answers it), which rolls instead of storing a choice. Disciplines opened
  by `access` aren't on the tables: with any, slots are chosen among every
  candidate evenly.
- **Optional** effects flip a coin in random mode.
- **Chance**: a D100 ≤ `chance`.
- Candidates are always in id order, so random picks don't depend on file
  order. A compendium is treated as immutable: the engine caches sorted
  entries per map; call `invalidateCompendium(c)` after changing its maps
  in place (or build a new one).

## Companions

A `companion` effect ("May be accompanied by a Technical Servitor") gives
the character a model of its own. build() lists it in `companions` with a
key: `<parent>>@companion`, the decision that gave it (the optional) plus
`>@companion`, or `<entry>/@companion` when nothing did.
`buildAll()` (src/shared/engine/companions.ts) is build() plus each
companion built as a character: its archetype and subtype, with the
companion's `option` chosen (the pick offering it, and the optionals
leading there, `findOption()`), named by the book ("Technical" +
"Servitor"). It is rolled with the character, and its dice and choices are
kept in the character's record under `<companion key>>` (
`enginseers/technical-servitor>@companion>servitors/@stats:WS`), so
replaying the record rebuilds both. The choices that make its option are
the effect's, made every build: not in the record, the log or the open
choices. Its log and open choices join the character's (keys prefixed, its
top ones under the decision that gave it), so re-rolling and choosing work
as for any decision; re-rolling the optional clears all of it (nested by
spelling). The builder, print and the Word export show each companion's
card and sheet after the character's; the character's own sheet names it
under Other Equipment/Bionics/Etc.

## The sheet

`src/shared/sheet-map.ts` (outside the engine, shared by the builder, the
print view and the Word export) turns a built character into the GM
sheet's block (`SheetCharacter`, src/shared/sheet.ts): `toSheetCharacter()`,
or `sheetParts()` for the sheet plus what each line shows. Every cell is
the book's text:

- **Armour row** per sheet location (`L. Leg` … `Head`): the AV, plus
  force field dice (`6+D10`, `armourCell()`), blank for none.
- **Firearm rows**: items (and natural weapons) whose profile has a range
  (`Rng`/`Range`) and damage: `Type Rng Mode Acc Dam→Damage Shots Rld
  Wt→Enc`, `# Rld` from the item's `reloads` and the character's `reloads`
  (blank for none), Special = grenades' `Area`/`Blast`, the item's text,
  alterations and effects that apply while it is wielded. Multi-line cells
  join with " / ".
- **Melee rows**: profiles with `Reach`: `Reach Damage Parry Penalty`, the
  item's text; natural weapons.
- **Other Equipment/Bionics/Etc**: every other item, then any `empty`
  result ("Heavy weapon (Common)"), then each companion by its book name
  ("Technical Servitor"; its own sheet follows: `characterSheets()`).
- Every item and ability shows its variants (one group per unit, joined by
  "; ") and what was picked into it in brackets, and `×qty`.
- **Starting row**: final stats and the derived values.
- **Abilities**: talents, exotic abilities, mutations, powers, as
  "Name (variants)" and the entry's text ("Word of the Emperor (Curse Of
  Undoing; Litany Of Spite)").
- **Name line**: archetype, subtype, the archetype's own options and those
  a rule chose (p. 83's Chaos discipline, "Chaos Undivided"), alignment.
- **Game Notes**: attributes ("Warp Strength 5") and gameplay prose; then
  for each roll made at the start of each game (`eachGame`), the book's
  sentence, the table's name and its rows unrolled ("1-10 The gods are
  angry; …"), for the GM to roll at the table.

Profiles follow `profileWhen` for this character's final stats.

## Warbands

`warbandWarnings(compendium, characters)` lists the `warband` effects (in
rules and archetypes) a set of characters breaks: `{ source, max,
archetype, count }`. Warnings, never blocks.

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
- `label(score, dist)`: the character's percentile rank among the
  distribution's sorted `scores`, counting itself as one more random
  character: `top` = (scores ≥ it + 1) / (n + 1), `bottom` likewise. The top
  or bottom 5% (`BALANCE_TAIL`) is `overpowered` / `underpowered`; else
  `balanced`. `labelText` words it: "This character is in the top 1.5% of
  randomly-rolled Inquisitor Fighters."
- `npm run simulate [-- --n=10000 --seed=1 pack…]` loads the packs in
  `RULES_DIR` (stacked by `extends`) and writes `data/balance.json` (or
  `BALANCE_FILE`): `{ generated, packs, n, seed, distributions: {
  "<archetype>/<subtype>": Distribution }, failures }`.
