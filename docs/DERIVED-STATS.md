# Derived stats

The GM's sheet has five values worked out from the characteristics: **Kbk**
(Knockback), **BIV** (Base Injury Value), **SS** (System Shock), **Cnc**
(Consciousness) and **Spd** (Speed). `src/shared/engine/derived.ts`
(`deriveStats`) computes them; `test/derived.test.ts` checks them against the
book's worked examples.

## Source

The Inquisitor core rulebook: the free PDF Games Workshop released in 2004
(the "Living Rulebook"), hosted by Dreadquill at
<https://dreadquill.com/home/resources/inquisitor-rulebook-pdf/> in two parts:

- `https://dreadquill.com/wp-content/uploads/2020/01/InqLRBpart1.pdf` (81 pages)
- `https://dreadquill.com/wp-content/uploads/2020/01/InqLRBpart2.pdf` (45 pages)

Local copies and their `pdftotext -layout` text are in `data/source/core/`.
The pages carry no printed page numbers, so references give the file and its
PDF page (1-based) and the section heading.

## Rounding

> **Fractions:** All fractions are mathematically rounded off. This means that
> fractions of less than half are rounded down to the nearest whole number,
> while fractions of half or more are rounded up.

— InqLRBpart1.pdf p.12, The Basics, "Other conventions"

None of the five rules gives its own rounding, so this one applies. The
book's examples agree with it: Initiative 76 gives 76/20 = 3.8, shown as 4;
Initiative 70 gives 3.5, shown as Speed 5; Toughness 76 gives 7.6, shown as
Base Injury 8.

## Spd: Speed = Initiative / 20, plus 1

> **Speed:** Each character has a Speed value, which determines when they can
> act in a turn and how quickly. Speed is equal to the character's Initiative
> divided by 20, plus 1. For example a character with Initiative 76 has Speed 5
> (76/20=4+1=5). A character's speed can change quite a lot during a game; most
> usually it goes down due to injuries.

— InqLRBpart1.pdf p.15, Characters, "Other details"

> As he has an Initiative of 70, this gives Shyloque a Speed of 5 – (70/20)+1.

— InqLRBpart1.pdf p.15, "Sample profile" (Shyloque: WS 76, BS 80, S 55, T 62,
I 70, Wp 81, Sg 86, Nv 80, Ld 85)

## BIV: Base Injury value = Toughness / 10

> A character can sustain a certain amount of injury to a location before his
> abilities are impaired. The amount of damage he can withstand is based upon
> his Toughness, and is known as his Base Injury value. This value is equal to
> the character's Toughness divided by 10, so a character with Toughness 76 has
> a Base Injury value of 8.

— InqLRBpart1.pdf p.40, Injuries & Recovery, "Location injury"

> Example: Shyloque has Toughness 62, and so has a Base Injury value of 6.

— InqLRBpart1.pdf p.40

> **Location injury:** Character's base injury value is his Toughness divided
> by 10.

— InqLRBpart1.pdf p.43, "Injuries/Recovery Summary"

## SS: System Shock value = Toughness / 5

> Divide the character's Toughness by 5. The result is his System Shock value.
> If he suffers a number of Damage points from one hit equal to or greater than
> his System Shock value, he must pass a Toughness test or be taken out of
> action for the remainder of the game.

— InqLRBpart1.pdf p.40, Injuries & Recovery, "Effects of injuries: System shock"

> System shock value is Toughness divided by 5.

— InqLRBpart1.pdf p.43, "Injuries/Recovery Summary"

## Cnc: Consciousness value = Toughness / 2

> A character's Consciousness value is equal to half his Toughness value. If
> the character's injury total exceeds his Consciousness value, then he passes
> out and is taken out of action.

— InqLRBpart1.pdf p.41, Injuries & Recovery, "Consciousness"

> **Consciousness:** If injury total is equal to half a character's Toughness
> then he is out of action.

— InqLRBpart1.pdf p.43, "Injuries/Recovery Summary" (the summary says "equal
to" where the main rule says "exceeds"; this changes when a character passes
out, not the value on the sheet)

## Kbk: Knockback value = Strength / 10

> A character who is hit may be physically knocked back by the force of the
> shot or blow. Each character has a Knockback value which is equal to one
> tenth of his Strength characteristic.

— InqLRBpart2.pdf p.42, Additional Rules, "Knockback" (the book's own
cross-references put it on page 180: "the Additional Rules section on page
180", InqLRBpart1.pdf p.52, and "see page 180", p.66)

## Modifiers

The formulas take the characteristics as they stand, so anything that changes
a characteristic (bionics, mutations, psychic powers, injuries) changes the
derived value with it. The book also adjusts the derived values directly, and
these are rules in the data, not part of `deriveStats`:

- Speed: injuries ("Persistent – Character is at -1 Speed", Location Injury
  tables, InqLRBpart1.pdf p.42) and encumbrance ("For every 25 points, or part,
  that their equipment is more than their Encumbrance value they are at -1
  Speed (minimum 1)", InqLRBpart2.pdf p.42).
- Base Injury value: the Loyalist guide's mutations "Scales" ("+1 Base Injury
  Value") and "Rotting Flesh" ("-1 to its Base Injury Value"), guide p.92.

## Worked examples

| Source | Characteristics | Book's value | `deriveStats` |
|---|---|---|---|
| Rulebook p.15 | I 76 | Spd 5 | 5 |
| Rulebook p.15 (Shyloque) | I 70 | Spd 5 | 5 |
| Rulebook p.40 | T 76 | BIV 8 | 8 |
| Rulebook p.40 (Shyloque) | T 62 | BIV 6 | 6 |
| Loyalist guide p.92 (Curse of Thlezzloath) | I 36, T 71 | Spd 3, BIV 7 | 3, 7 |

The rulebook gives no worked SS, Cnc or Kbk values. For Shyloque the formulas
give SS 12 (62/5 = 12.4), Cnc 31 and Kbk 6 (55/10 = 5.5, rounded up).
