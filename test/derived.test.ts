import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStats } from '../src/shared/engine/derived.ts';

const base = { WS: 50, BS: 50, S: 50, T: 50, I: 50, Wp: 50, Sg: 50, Nv: 50, Ld: 50 };

test('Shyloque, the rulebook sample profile (InqLRBpart1.pdf p.15, p.40)', () => {
  const d = deriveStats({ WS: 76, BS: 80, S: 55, T: 62, I: 70, Wp: 81, Sg: 86, Nv: 80, Ld: 85 });
  // Stated by the book: "this gives Shyloque a Speed of 5 – (70/20)+1" (p.15)
  // and "Shyloque has Toughness 62, and so has a Base Injury value of 6" (p.40).
  assert.equal(d.Spd, 5);
  assert.equal(d.BIV, 6);
  // Not stated by the book; these follow from the formulas: 62/5 = 12.4,
  // 62/2 = 31, 55/10 = 5.5 (half or more rounds up).
  assert.equal(d.SS, 12);
  assert.equal(d.Cnc, 31);
  assert.equal(d.Kbk, 6);
});

test('rulebook rule examples: Initiative 76 gives Speed 5, Toughness 76 gives Base Injury 8', () => {
  // "a character with Initiative 76 has Speed 5 (76/20=4+1=5)" (InqLRBpart1.pdf p.15)
  assert.equal(deriveStats({ ...base, I: 76 }).Spd, 5);
  // "a character with Toughness 76 has a Base Injury value of 8" (InqLRBpart1.pdf p.40)
  assert.equal(deriveStats({ ...base, T: 76 }).BIV, 8);
});

test('Loyalist guide p.92, Curse of Thlezzloath: I 36 gives Spd 3, T 71 gives BIV 7', () => {
  const d = deriveStats({ ...base, WS: 52, BS: 13, S: 62, T: 71, I: 36 });
  assert.equal(d.Spd, 3);
  assert.equal(d.BIV, 7);
});

test('fractions of half or more round up, less than half round down (InqLRBpart1.pdf p.12)', () => {
  assert.equal(deriveStats({ ...base, T: 63 }).Cnc, 32); // 31.5
  assert.equal(deriveStats({ ...base, T: 63 }).SS, 13); // 12.6
  assert.equal(deriveStats({ ...base, T: 61 }).SS, 12); // 12.2
  assert.equal(deriveStats({ ...base, S: 54 }).Kbk, 5); // 5.4
  assert.equal(deriveStats({ ...base, T: 45 }).BIV, 5); // 4.5
  assert.equal(deriveStats({ ...base, I: 29 }).Spd, 2); // 1.45 -> 1, +1
  assert.equal(deriveStats({ ...base, I: 30 }).Spd, 3); // 1.5 -> 2, +1
});
