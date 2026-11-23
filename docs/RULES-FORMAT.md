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

## Principles

1. **Book text is sacred.** Every visible word in the app comes from the
   book, so names, labels, option names and prose are the book's own
   wording, verbatim, with only spelling fixed (`Exoitc` → `Exotic`,
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
human: false                # stats may exceed 100 (default true: "Human characters' stats can't surpass 100")
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

### talent / exotic / mutation / power

```yaml
id: academic
kind: talent                # talent | exotic | mutation | power
name: Academic
group: Psyker Talents       # optional: the book's sub-heading (Psyker Talents, a discipline…)
difficulty: 10              # psychic powers only
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
```

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

### rule

Prose-only material (the warband steps, the house rule) as
`kind: rule` with `text`.

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
| `{ id, powers: { count: D6, maxDifficulty: 10, crossDisciplinePenalty: 1 } }` | generate psychic powers |
| `{ prose: "…", kind: gameplay \| gm \| unfit, proposal: "…" }` | uninterpreted book text |

Conditions: `{ alignment: [Radical] }`, `{ subtype: [psyker, sage] }`,
`{ option: [deductor] }`, `{ archetype: [...] }`,
`{ has: { talent: leader } }`, `{ not: … }`, `{ any: [ … ] }`, `{ all: [ … ] }`.

Dice: integers and `[N]D<M>` terms joined by `+`/`-`: `60+2D10`, `D3+3`,
`-D10`, `D100`.

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
