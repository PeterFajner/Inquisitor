// The derived values on the GM's sheet (Kbk, BIV, SS, Cnc, Spd), from the
// Inquisitor core rulebook (the 2004 Games Workshop PDF, "Living Rulebook",
// hosted by Dreadquill as InqLRBpart1.pdf and InqLRBpart2.pdf). The PDF pages
// carry no printed page numbers, so citations give the file, its PDF page and
// the section. Quotes and sources: docs/DERIVED-STATS.md.

export type Characteristic = 'WS' | 'BS' | 'S' | 'T' | 'I' | 'Wp' | 'Sg' | 'Nv' | 'Ld';

export interface DerivedStats {
  Kbk: number;
  BIV: number;
  SS: number;
  Cnc: number;
  Spd: number;
}

// "Fractions: All fractions are mathematically rounded off. This means that
// fractions of less than half are rounded down to the nearest whole number,
// while fractions of half or more are rounded up." (InqLRBpart1.pdf p.12,
// The Basics > Other conventions). The book's own examples agree: Initiative
// 76 gives 76/20 = 3.8 -> 4, Speed 5; Initiative 70 gives 3.5 -> 4, Speed 5;
// Toughness 76 gives Base Injury 7.6 -> 8.
function roundOff(x: number): number {
  return Math.floor(x + 0.5);
}

export function deriveStats(stats: Record<Characteristic, number>): DerivedStats {
  return {
    // Knockback: "equal to one tenth of his Strength characteristic"
    // (InqLRBpart2.pdf p.42, Additional Rules > Knockback; the book's own
    // cross-reference calls this "the Additional Rules section on page 180").
    Kbk: roundOff(stats.S / 10),
    // Base Injury value: "equal to the character's Toughness divided by 10"
    // (InqLRBpart1.pdf p.40, Injuries & Recovery > Location injury; repeated
    // in the Injuries/Recovery Summary, p.43).
    BIV: roundOff(stats.T / 10),
    // System Shock value: "Divide the character's Toughness by 5"
    // (InqLRBpart1.pdf p.40, Injuries & Recovery > System shock; summary p.43).
    SS: roundOff(stats.T / 5),
    // Consciousness value: "equal to half his Toughness value"
    // (InqLRBpart1.pdf p.41, Injuries & Recovery > Consciousness; summary p.43).
    Cnc: roundOff(stats.T / 2),
    // Speed: "equal to the character's Initiative divided by 20, plus 1"
    // (InqLRBpart1.pdf p.15, Characters > Other details).
    Spd: roundOff(stats.I / 20) + 1,
  };
}
