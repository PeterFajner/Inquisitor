# The rules format

The rules are YAML files, one per entry, in a rule pack:

```
data/rules/<pack>/pack.yaml
data/rules/<pack>/archetypes/<id>.yaml
data/rules/<pack>/talents/<id>.yaml     # kind: talent
data/rules/<pack>/exotics/<id>.yaml     # kind: exotic
data/rules/<pack>/mutations/<id>.yaml   # kind: mutation
data/rules/<pack>/powers/<id>.yaml      # kind: power (psychic powers)
data/rules/<pack>/items/<id>.yaml       # kind: item (all equipment)
data/rules/<pack>/tables/<id>.yaml      # kind: table (anything rolled on)
data/rules/<pack>/rules/<id>.yaml       # kind: rule (prose-only rules)
```

The schema is `src/shared/rules/schema.ts` (the source of truth; this file
explains it). `npm run rules:check` validates every file and every
cross-reference. `data/rules` is its own git repository (the rules
database), not part of the code repo.

`pack.yaml` names the pack (`id`, `name`) and the packs it builds on
(`extends: [loyalist]`). Every pack applies to every character; a pack is
stacked after the packs it extends, and its entries replace theirs with the
same kind and id. The book is `loyalist`; each article the book defers to is
its own pack (`data/source/articles/<pack>.pdf`, its `source.page` counting
the article's pages). An article pack overrides a book entry only to fill in
what the book defers to the article; anything else it adds has new ids, and
optional rules it offers are options, not replacements.

## Principles

1. **Book text is sacred.** Every visible word in the app comes from the
   book, so names, labels, option names and prose are the book's own
   wording, verbatim, with only spelling, grammar and punctuation fixed (`Exoitc` → `Exotic`, "Character’s can’t" → "Characters can’t", list dashes dropped,
   `Sorotitas` → `Sororitas`, `Engineseers` → `Enginseers`, `Repnetais` →
   `Repentias`). Never paraphrase, summarise or invent wording.
2. **Structure what affects the character's build; prose for the rest.**
   Anything that changes stats, grants talents/abilities/items/powers/
   mutations, involves a roll or a choice during creation, or restricts
   what the character can have, should be effects. What only matters
   during play (how a talent works in a game) is prose.
3. **When the vocabulary can't express something, say so**: use
   `{ prose: <book text>, kind: unfit, proposal: <the effect that would> }`.
   Don't contort a clause into effects that mean something else.
4. **ids** are kebab-case, derived from the book name (`study-thy-weapon`),
   unique per kind, and permanent. Effect ids (on rolls and choices) are
   unique within their entry and named for what they decide (`type`,
   `wyrd`, `boons`, `gear`).
5. `source.page` is the PDF page (1–98). `source.text` holds the book's
   full wording of the entry (for archetypes: the whole profile below the
   stat table, sections joined with blank lines), verbatim.

## Entries

### archetype

```yaml
id: adeptus-astartes
kind: archetype
name: Adeptus Astartes
gmApproval: true            # asterisked in the book
characters: Adeptus Astartes # one character: the name the app shows ("Inquisitor", not the heading "Inquisitors"); the stat table header without "Characters" where it has one
human: false                # rolled stats may exceed 100 (default true: "Human characters' stats can't surpass 100" caps the roll; later bonuses may exceed it)
source: { page: 6, text: "…" }
subtypes:                    # the stat table rows; one row → one subtype
  - id: space-marine
    name: Space Marine
    stats: { WS: 65+2D10, BS: 65+2D10, S: 185+4D10, T: 125+4D10, I: 70+3D10, Wp: 60+3D10, Sg: 60+3D10, Nv: 85+2D6, Ld: 70+2D6 }
sections:                    # the profile rows, in book order, with the book's row names
  - name: Options
    effects: [ … ]
  - name: Equipment
    effects: [ … ]
  - name: Armor
    effects: [ … ]
  - name: Psychic Abilities
    effects: [ … ]           # an empty list for "N/A"
  - name: Exotic Abilities
    effects: [ { exotic: spit-acid } ]
  - name: Talents
    effects:
      - { talent: ambidextrous }
      - { talent: awareness }
      - { talent: nerves-of-steel }
      - when: { option: [grey-knight] }
        then: [ { talent: deny-the-witch }, { talent: channel-the-mind }, { talent: force-of-will } ]
  - name: Mutations
    effects: []
  - name: Alignment
    effects: [ … ]
```

Cherubim-style fixed stat lines use numbers: `stats: { WS: 10, BS: 0, … }`.

A subtype chosen by a roll ("Roll a D10. On a 1-3: they're a Rookie…")
gives the archetype a `subtypeDie` and each subtype a `range`; the builder
rolls it with `rollSubtype()` (key `<archetype>/@subtype`):

```yaml
subtypeDie: D10
subtypes:
  - { id: rookie, name: Rookie, range: [1, 3], stats: { … } }
  - { id: tracker, name: Tracker, range: [4, 8], stats: { … } }
```

### talent / exotic / mutation / power

```yaml
id: academic
kind: talent                # talent | exotic | mutation | power
name: Academic
group: Psyker Talents       # optional: the book's sub-heading (Psyker Talents, a discipline…)
difficulty: 10              # psychic powers only; a formula is a string: "TT/2", "Wp/2"
source: { page: 24 }
text: This character can re-roll failed Sagacity Tests.
effects: []                 # only for build effects, e.g. a mutation's "+10 Initiative"
```

### item

```yaml
id: needle-pistol
kind: item
name: Needle Pistol
group: Ranged Weapons       # the book's section
category: Pistol            # the equipment generator category it belongs to
availability: Rare
alien: false
source: { page: 40 }
profile:                    # the book's table columns, verbatim header → cell
  Type: Pistol
  Rng: "…"
  Mode: "…"
text: "…"                   # Special Qualities / description
effects: []                 # what having it does: armour, stats, picks into it…
```

Optional item fields:

```yaml
tags: [power-weapon, bladed]   # names for filters and restrictions (not shown)
product: Chaos                 # "Chaos Product." / Radical / Xenos (matched as chaos, radical, xenos)
unrestricted: true             # "Combat Stimms don't have availability restrictions"
availabilityWhen:              # "only counts as Rare for characters that are part of … the Ecclesiarchy.
  when: { archetype: [ecclesiarchy, adepta-sororitas] }   #  Otherwise, the GM will say"
  else: gm                     # an availability, or gm (none: never generated or offered by availability)
  # then: Rare                 # (default: the item's availability)
requires: { archetype: [ecclesiarchy] }   # "Only characters who are part of … may take this weapon."
profileWhen:                   # cells that change with the wielder (final stats); the first that holds
  - when: { stat: S, below: 75 }
    profile: { Damage: 3D10+2, Parry Penalty: "-35" }
```

Profiles keep the book's column names: ranged weapons `Type Rng Mode Acc
Dam Shots Rld Wt`, grenades `Type Range Area Blast Dam Weight`, melee
`Reach Damage Parry Penalty` (+ `Weight`). The GM sheet reads them as they
are (docs/ENGINE.md, "The sheet").

### table

Anything rolled on: boons, random exotic abilities, mutations, the
equipment generator, availability, bionics, psychic discipline tables…

```yaml
id: boons
kind: table
name: Boons
die: D100
columns: [fighter, marksman, scout, sage, psyker]   # multi-column tables only
rerollDuplicates: true
source: { page: 22 }
rows:
  - ranges: { fighter: [1, 7], marksman: [1, 3], scout: [1, 5] }   # a missing column = "–"
    label: +10 WS
    effects: [ { stat: WS, add: 10 } ]
  - ranges: { fighter: [97, 100], marksman: [91, 100] }
    label: Roll again on Fighter table
    effects: [ { id: again, roll: boons, column: fighter } ]
  # single-column tables use range: [lo, hi]; "00" is 100
```

A row of the equipment generator may say how many of the chosen item the
character gets, by its availability ("For grenades, the character has D3 of
a Common type, or one of a less available type"):

```yaml
  - ranges: { fighter: [71, 78], … }
    label: Grenade
    qty: { Common: D3 }
    effects: []
```

and the bionic quality of what it makes, by the rolled availability
("Crude Quality Bionics are Common, Average Bionics are Rare, and Advanced
Bionics are Exotic"):

```yaml
  - ranges: { … }
    label: Bionics and implants
    quality: { Common: Crude, Rare: Average, Exotic: Advanced }
    effects: [{ id: bionics, roll: bionics-table }]
```

### rule

Prose-only material (the warband steps, the house rule) as
`kind: rule` with `text`. A rule whose effects apply to every character
says where they run among the archetype's sections with `apply`:

```yaml
id: creating-a-character
kind: rule
apply: { after: Talents }       # or { before: Equipment }; `apply: true` = after the last section
effects:
  - when: { subtype: [fighter, marksman, scout, sage, psyker] }
    then:
      - { id: boons, roll: boons, times: D3+3, column: $subtype, rerollDuplicates: true }
```

Step B of Creating A Character ("they generate D3+3 Boons … Reroll any
duplicates of Talents or Exotic Abilities") comes after step A's profile
talents and exotic abilities, so it is `after: Talents`. Rules without
`apply` only show their text.

## Effects (the chips)

| Effect | Meaning |
|---|---|
| `{ stat: WS, add: 10 }` | change a stat; `stat` may be a list or `all`; `add` may be dice (`-D10`), rolled once and applied to every listed stat (or per stat with `each: true`) |
| `{ stat: WS, set: 0 }` / `{ stat: [WS, BS, S, T], max: average }` | set, or clamp (`max: average` = can't be higher than the subtype's average) |
| `{ talent: dodge }`, `{ exotic: fearsome }`, `{ item: medikit, qty: 5 }`, `{ mutation: … }`, `{ power: … }` | grant a specific thing |
| `{ id, pick: 2, from: [ … ] }` | "Pick 2": choose among effects or named options `{ id, name, text?, effects }` |
| `{ id, pick: 3, pool: talent }` | "any three Talents" (optional `filter: { group, availability, discipline, maxDifficulty }`) |
| `{ id, optional: [ … ] }` | "May have …" |
| `{ id, chance: 5, then: [ … ], else: [ … ] }` | "5% chance of …" |
| `{ id, roll: boons, times: D3+3, column: $subtype }` | roll on a table |
| `{ when: <condition>, then: [ … ], else: [ … ] }` | conditional |
| `{ id, alignment: [Puritan, Radical] }` | allowed alignments |
| `{ id, gear: { count: D6+3, availability: [Common, Rare], alien: { alignment: [Radical] }, downgrade: 1, exclude: [power-weapon] } }` | generate equipment |
| `{ id, powers: { count: D6, maxDifficulty: 10, crossDisciplinePenalty: 1, table: starting-powers-for-each-discipline } }` | generate psychic powers (`table`, `column`: the book's generation table, rolled in random mode; see ENGINE.md) |
| `{ prose: "…", kind: gameplay \| gm \| unfit, proposal: "…" }` | uninterpreted book text |

The extended vocabulary (below) adds `armour`, `restrict`, `exclusive`,
`derived`, `attribute`, `wielded`, `remove`, `reloads`, `trade`,
`upgrade`, `bionics`, `weapon`, `access`, `psyker`, `companion`,
`warband` and `location`, and new fields on picks, grants, chances, rolls
and gear.

Conditions: `{ alignment: [Radical] }`, `{ subtype: [psyker, sage] }`,
`{ option: [deductor] }`, `{ archetype: [...] }`,
`{ has: { talent: leader } }`, `{ not: … }`, `{ any: [ … ] }`, `{ all: [ … ] }`,
and:

| Condition | True when |
|---|---|
| `{ stat: S, below: 75 }` / `{ stat: WS, above: 90 }` | the stat's value so far (final values in `profileWhen`) |
| `{ rolled: [random-armor-types] }` | the character has a result on any of these tables ("If a character generates at least one piece of armor from the table above") |
| `{ psyker: true }` | it has powers, the psyker subtype or a `{ psyker: true }` effect |
| `{ generates: [Rare] }` | a gear effect so far may generate any of these availabilities ("Pick a quality you can generate") |
| `{ availability: [Common] }` | in an equipment generator row's effects: the result being made is of one of these (Armour: "Common Armor" for a Common result) |

Dice: integers and `[N]D<M>` terms joined by `+`/`-`: `60+2D10`, `D3+3`,
`-D10`, `D100`. A dice term may be multiplied: `D6x10` ("+ [D6 x 10]
Strength"), `D3x20`.

Hit locations are the core rulebook's: `Head`, `Chest`, `Abdomen`,
`Groin`, `Left Arm`, `Right Arm`, `Left Leg`, `Right Leg`, and the groups
`all`, `non-head`, `arms`, `legs`.

Names in filters, restrictions and `exclude` lists match an entry's id, its
group or category in kebab case (`Melee Weapons` → `melee-weapons`,
`Close combat weapon` → `close-combat-weapon`; armour = armor, plurals
ignored), its `tags`, its `product` (`chaos`, `radical`, `xenos`) and
`alien` for alien items.

## The extended vocabulary

Each addition is small and in the book's terms. Every shape below is
exact; `id` is required wherever the effect rolls or asks.

### Armour

```yaml
- { armour: { av: 5, locations: [Chest, Abdomen] } }        # Breastplate: a piece
- { armour: { av: 2, locations: non-head } }                 # Robes of Office
- { armour: { av: 1, locations: [arms, Groin, legs] } }      # "the arms, groin, and legs"
- { armour: { as: carapace-armor } }                         # "This counts as Carapace Armor"
- { armour: { as: power-armor, add: 3 } }                    # Daemonic Armor: PA with +3
- { armour: { as: power-armor, av: 14 } }                    # Pre-Heresy Terminator: "AV of 14"
- { id: cover, armour: { av: 2, choose: 3, locations: [Left Arm, Right Arm, Chest, Abdomen, Head] } }  # Light Shield
- { id: av, armour: { add: D3+1 } }                          # Chitinous Hide: extra AV everywhere
- { armour: { add: 2, locations: non-head } }                # Culexus: "+2 on all non-head hit locations"
- { armour: { field: D10 } }                                 # Warpshield: a D10 force field
- { id: plating, armour: { av: D6+1, locations: [Head] } }   # dice need an id
```

A piece (`av` or `as`) covers `locations` (default `all`); per location
the best piece counts. An effect with only `add` is extra AV on top of
whatever is worn. `field` is a force field's dice, shown, not rolled.
`choose: N` lets the player choose N of the listed locations. Items' armour
counts while the character has them; abilities' always.

### Restrictions

```yaml
- { restrict: { pool: item, group: [Armour], only: [power-armor] } }      # "Battle Sisters only wear Power Armor."
- { restrict: { pool: item, group: [Armour], except: [power-armor] } }    # "any kind of armor except for Power Armor"
- { restrict: { pool: item, group: [Armour], maxAV: 3 } }                 # "Flak Armor or lighter"
- { restrict: { pool: item, alien: false } }                               # "can never use alien technology"
- { restrict: { pool: item, except: [combat-stimms] } }                    # Kroot: "never use combat drugs"
- { restrict: { pool: item, tag: [power-weapon, bolt-weapon], only: [power-maul] } }  # Enforcers
- { restrict: { pool: power, only: [telepathy] } }                         # Puppetmaster (a discipline is a power's group)
- { restrict: { pool: power, only: [the-lidless-stare, warp-gaze, temporal-distortion, inertia] } }  # The Third Eye
- { exclusive: { pool: talent, group: [Psyker Talents] } }                 # Natural Psyker
- when: { not: { alignment: [Radical] } }                                  # "Only radical Inquisitors can wield heretical crafts."
  then: [{ restrict: { pool: item, except: [chaos, xenos], alien: false } }]
```

`pool` and `group`/`category`/`tag` say which entries it is about (all of
that kind when none is given); of those, `only` allows just these names,
`except` none of these, `maxAV` only armour whose best AV is at most that,
`alien: false` no alien ones. `exclusive`: while the character has the
entry the effect belongs to, it can't have any other entry in that scope.
Pools, gear, powers and table results never give what a restriction
refuses (table results are re-rolled); anything breaking one anyway (an
override, a fixed grant) is flagged and warned. A restriction in a later
row (Armor after Equipment) still applies to the gear generated before it.

### Picks

New fields on `pick`:

```yaml
- { id: pistol, pick: 1, pool: item, filter: { category: [Pistol] } }                      # "any pistol of your choice"
- { id: weapon, pick: 1, pool: item, filter: { tag: [power-weapon], availability: [Common, Rare, Exotic] } }  # "non-Legendary power weapon"
- { id: blade, pick: 1, pool: item, filter: { group: [Melee Weapons], tag: [bladed] } }    # "a bladed melee weapon"
- { id: exotic, pick: 1, pool: exotic, filter: { exclude: [daemonic, possession] } }       # "except Daemonic or Possession"
- { id: ammo, pick: 1, pool: item, filter: { group: [Special Ammo] }, qty: 10 }            # "ten rounds of special ammunition"
- { id: implant, pick: 1, pool: item, filter: { group: [Melee Weapons] }, implanted: true } # "any implanted close combat weapon"
- { id: grenades, pick: 1, pool: item, filter: { owned: true, category: [Grenade] }, qty: D3 }  # "D3 extra grenades"
- { id: toxin, pick: 1, pool: item, filter: { group: [Gases, Toxins, And Viral Effects] }, into: self }  # needle weapons
- { id: power, pick: 1, pool: power, filter: { maxDifficulty: 10 }, into: self }          # Archeotech
- { id: weapon, pick: 1, pool: item, filter: { owned: true, group: [Ranged Weapons, Melee Weapons] }, into: self }  # Study Thy Weapon
- { id: gear, pick: any, pool: item, filter: { availability: [Common] } }                  # "any Common gear of their choosing"
- { id: powers, pick: { max: 2 }, pool: power }                                            # "can have up to 2 psychic powers"
- { id: gear, pick: any, pool: item, filter: { availability: [Common] }, random: D6 }      # open pick, D6 of them in random mode
```

`filter` gains `category` (the generator's categories), `tag`, `exclude`
and `owned` (true: only what the character has; false: only what it
hasn't). `qty` gives each picked item that many; `implanted` marks them.
`into: self` (or an item id the character has) puts the choice on that
item or ability instead of the character. `pick: any` / `pick: { max: N }`
let the player take as many as they like; random mode takes `random` of
them (default: none for `any`, 0 to N for `max`).

Named options may carry `when`: the option is offered only when it holds
(Bionic Organs: "Pick a quality you can generate"):

```yaml
- { id: average, name: Average, when: { generates: [Rare] } }
```

Inside a roll that re-rolls duplicates (boons), picks among grants don't
offer what the character already has (an expansion talent instead of
"Roll again on another subtype's table").

### Grants

Every grant may carry `set` (answers for the granted entry's own decisions,
by effect id: option ids for a pick, a row label for a roll, `then`/`else`
for a chance, `yes`/`no` for an optional; its effects run again for this
grant) and `again: true` (its effects run once more: another choice).
Items also take `quality`, `implanted`, `reloads` and `alterations`:

```yaml
- { item: bionic-organs, set: { quality: [advanced], organ: [Heart] } }   # "Advanced Secondary Bionic Heart"
- { item: bionic-organs, set: { quality: [advanced], organ: [Lungs] } }
- { exotic: word-of-the-emperor, again: true }                            # an additional variant (another prayer)
- { item: bionic-eye, quality: Crude }                                    # "a Bionic Eye of crude … quality"
- { item: bolt-pistol, implanted: true }
- { item: executor-pistol, reloads: 4 }                                   # "with four Bolt Weapon Reloads"
- { item: power-sword, alterations: [master-crafted-weaponry] }           # a step more available per alteration
- { item: bionic-limb, variant: Left arm }                                # shown with it: "Bionic Limb (Left arm, Average)"
- { item: flak-armor, covers: { locations: non-head } }                   # "Flak (All non-head locations)"
- { item: padded-clothing, covers: { choose: D6 } }                       # "Padded Clothing (D6 locations)"
```

`variant` is listed with that one (like its quality). `covers` makes the
item's armour cover these locations instead of its own, or `choose` (dice)
of them, for this grant only.

An item granted with a `quality` answers its own `quality` pick with that
quality (lower-case option id: `crude`, `average`, `advanced`).

### Rolls, chances, gear

```yaml
- { id: legendary, chance: { die: D6, on: [6] }, then: [ … ] }            # "Roll a D6. On a 6, …"
- { id: type, roll: type-of-stimm, qty: D10 }                             # "Inhaler (D10 doses)"
- { id: type, roll: type-of-stimm, rerollUnless: { profile: Allowed Dispenser Types, includes: Inhaler } }
- { id: implant, roll: random-other-implant, matchAvailability: true }   # p61's Scarcity: from a gear result, only its availability
- id: ammo                                                                # "Random Special Ammunition By Weapon Type"
  roll: random-special-ammunition-by-weapon-type
  matchAvailability: true
  column: { owned: { bolter: [bolt-pistol, storm-bolter, …], shotgun: [shotgun, …] }, else: other-weapons }
- id: gear-downgraded                                                     # "downgrade the availability of all other weapons generated"
  gear: { count: D6+3, availability: [Common, Rare], downgrade: { steps: 1, only: [Close combat weapon, Pistol, Basic weapon, Heavy weapon, Grenade] } }
- id: gear                                                                # Elucidators: "at least one melee and ranged weapon, and one piece of armor"
  gear: { count: D6+3, availability: [Common, Rare], require: [[Close combat weapon], [Pistol, Basic weapon, Heavy weapon], [Armour]] }
```

`downgrade` stays a number for every result. `only` and `require` name
generator rows. `matchAvailability`: under a gear result, rows whose items
are of another availability are rolled again (items with none fit any).
`column: { owned, else }`: the column whose names match an item the
character has (chosen among several), else `else`; a gear result rolling
one is made after the gear effect's other results. A gear effect without `availability` uses the previous gear
effect's (for "roll again on the equipment table").

### Trades

"May downgrade the availability of an item generated to take …", "May
replace one of the Talents they generate with …":

```yaml
- id: rare-weapon                                   # Rogue Trader
  trade:
    give: { downgrade: 1 }                          # one generated gear result, a step down (Common: lost)
    get: [{ id: weapon, pick: 1, pool: item, filter: { availability: [Rare], group: [Melee Weapons] } }]
- id: wards                                         # Ecclesiarchy: "any kind of Wards … for each ward"
  trade:
    give: { downgrade: 1 }
    get: [{ id: ward, pick: 1, pool: item, filter: { group: [Wards] } }]
    times: any
- id: detection                                     # Imperial Guard
  trade: { give: { lose: talent, generated: true }, get: [{ talent: detection }] }
- id: reroll                                        # p.38: "lose two items … to roll again on the equipment table"
  trade: { give: { lose: item, count: 2 }, get: [{ id: again, gear: { count: 1 } }], times: any }
- id: upgrade                                       # p.38: "downgrade … two of your items … to choose one … one step higher"
  trade: { give: { downgrade: 1, count: 2 }, get: [{ id: up, upgrade: 1 }], times: any }
- id: squig                                         # familiar swap
  trade: { give: { lose: item, filter: { group: [Cyber Creatures & Familiars] } }, get: [{ item: attack-squig }] }
- id: word                                          # house rule: "trade in … Talents or Exotic Abilities … for additional variants"
  trade: { give: { lose: [talent, exotic], generated: true }, get: [{ exotic: word-of-the-emperor, again: true }], times: any }
```

`give` is `lose` (kinds, `count`, `filter`, `generated: true` = only what
came from a roll or a choice) or `downgrade` (steps, `count` results; the
downgraded result's item is chosen again). `{ id, upgrade: N }` raises one
generated result N steps and chooses its item. Random mode never trades.

### Derived values and attributes

```yaml
- { derived: BIV, add: 1 }                              # Scales; Rotting Flesh -1
- { derived: BIV, counts: { T: 20 } }                   # Autosanguination: "counts their Toughness as 20 higher"
- { derived: SS, counts: { T: -10 } }                   # Electro-grafts
- { derived: Spd, add: 1 }                              # Glavian Bio-circuitry
- { derived: Cnc, add: 5 }                              # Piloting Suit
- { derived: [Spd, BIV, SS, Cnc], set: [3, 7, "No", "No"] }   # Curse of Thlezzloath
- { stat: Ld, add: { stat: S, divide: 10 } }            # Bigga Is Betta: "[Strength/10]"
- { stat: S, multiply: 1.2 }                            # Power Armor: "increase their Strength by 1/5th"
- { stat: I, multiply: 0.5 }                            # Servo-harness
- { id: bulk, stat: T, add: D6x10 }                     # Superhuman Endurance
- { attribute: Warp Strength, set: -50 }                # Daemonhosts
- { attribute: Encumbrance Limit, set: { stat: S, add: 50 } }   # "Strength + 50"
```

Derived values are Kbk, BIV, SS, Cnc, Spd. A formula is `{ stat, times?,
divide?, add? }`, rounded off.

### Item behaviour, reloads, natural weapons

```yaml
- { wielded: [{ talent: butcherman }, { stat: Wp, add: -20 }] }   # Axe of Khorne: only while wielded (listed, not applied)
- { remove: { talent: [nerves-of-steel, force-of-will, heroic, leadership] } }   # Warp Disruptor
- { reloads: { add: 2 } }                                         # Truants: "two extra clips of ammunition"
- { reloads: { multiply: 2 } }                                    # Skitarii: "double the starting ammunition"
- { weapon: { profile: { Reach: "4", Damage: D6+3 } } }           # Barbed Tail (name: the entry's)
- { weapon: { name: Choking Pseudopod, profile: { Reach: "…", Damage: "…" }, qty: 1 } }
```

A mounted item ("Must be mounted onto a Basic weapon") is a pick into it:
`{ id: mount, pick: 1, pool: item, filter: { owned: true, category: [Basic weapon] }, into: self }`.

### Bionics

```yaml
- { id: bionics, bionics: { count: D6+1, quality: Crude, upgrade: 50 } }   # Servitors
- { id: bionic, bionics: { count: 1, quality: Average } }                  # Skitarii
```

Rolls `count` times on `bionics-table` (or `table:`); each bionic is of
`quality` (`Crude`, `Average`, `Advanced`), with an `upgrade`% chance of
the next quality up. `only: [Bionic Limb, Bionic sense]` re-rolls rows not
named ("A random body part is replaced …").

### Access, psykers, companions, warbands, hit locations

```yaml
- { access: { pool: talent, group: [Space Marine Talents] } }   # Strong: in every talent pool
- { access: { pool: power, group: [Chaos Undivided] } }         # in every power pool and powers effect
- { psyker: true }                                              # "All Navigator Characters are psykers"
- { companion: { archetype: servitors, option: technical-servitor } }   # "May be accompanied by a Technical Servitor"
- { warband: { max: 1, archetype: [inquisitor] } }              # "never have more than one Inquisitor" (a warning)
- { id: hand, location: { from: [Left Arm, Right Arm] } }       # Club Hand: "Choose one of the character's hands"
- { id: limb, location: { from: [Left Arm, Right Arm, Left Leg, Right Leg], random: true } }  # Atrophied Limb
- { location: { add: Arm } }                                    # Extra Arm
```

### Still prose

What the check report keeps for the GM stays `prose` with `kind: gm`:
"deep ties to the Ecclesiarchy" beyond the archetype list (use
`availabilityWhen` with `else: gm`), gear by purpose, GM approval, things
the GM invents, the house rules as campaign toggles, play-time effects
(Variable Profile's time of day), and anything the book doesn't define.

## Example: an Acolyte type (page 5)

> -Deductor (You get -20 WS & BS and -10 S & T. After generating stats,
> choose to increase either Sg or Ld by 10. Then roll a D100. *On a 1-50,
> increase the chosen stat by 15 instead of 10.)

```yaml
- id: type
  pick: 1
  from:
    - id: deductor
      name: Deductor
      effects:
        - { stat: [WS, BS], add: -20 }
        - { stat: [S, T], add: -10 }
        - id: deductor-stat
          pick: 1
          from:
            - id: deductor-sg
              name: Sg
              effects:
                - { id: deductor-sg-roll, chance: 50, then: [{ stat: Sg, add: 15 }], else: [{ stat: Sg, add: 10 }] }
            - id: deductor-ld
              name: Ld
              effects:
                - { id: deductor-ld-roll, chance: 50, then: [{ stat: Ld, add: 15 }], else: [{ stat: Ld, add: 10 }] }
```

Effects for one option often come from several profile rows (Type,
Equipment, Talents…). Define the option once, in the row that introduces
it, and put the other effects in the row where the book states them,
guarded by `when`, so each section keeps the book's order:

```yaml
- name: Equipment
  effects:
    - when: { option: [deductor] }
      then:
        - { item: pict-recorder }
        - { item: arco-stylus }
        - { item: data-slate }
        - { prose: "Each game they have a 50% chance of having an Enforcer character join the Warrior Band for that game.", kind: gameplay }
- name: Talents          # the book prints this under the Talents row
  effects:
    - when: { option: [deductor] }
      then: [ { talent: hunter } ]
```
