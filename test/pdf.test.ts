import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { renderSheetPdf, winAnsi } from '../src/client/export/pdf.ts';
import { SHEET_LOCATIONS, SHEET_STATS, type SheetCharacter } from '../src/shared/sheet.ts';

// Made-up characters; every value is distinct so each can be found.
function sample(n: number, name: string, tagLine: string, more = 0): SheetCharacter {
  const starting = Object.fromEntries(SHEET_STATS.map((s, i) => [s, String(40 + n * 14 + i)]));
  const armour = Object.fromEntries(SHEET_LOCATIONS.map((l, i) => [l, `${n}${i}`]));
  const firearm = (k: number) => ({
    name: `Bolt Pistol ${n}.${k}`, type: 'Pistol', rng: `${10 + n}`, mode: 'Single / Semi', acc: `+${n}`,
    damage: `2D6+${n}`, shots: `${6 + n}`, rld: '1', enc: `${n}`, reloads: `${n + 1}`, special: `Fancy ${n}.${k}`,
  });
  return {
    name,
    tagLine,
    starting: starting as SheetCharacter['starting'],
    gameNotes: [`Note ${n}a`, `Note ${n}b`, ...Array.from({ length: more }, (_, k) => `A long game note ${n}.${k} that wraps over several lines of the narrow column`)],
    abilities: [
      { name: `Gift ${n}`, effect: `Rerolls one test ${n}.` },
      { name: `Oath ${n}`, effect: '' },
      ...Array.from({ length: more }, (_, k) => ({ name: `Talent ${n}.${k}`, effect: 'This character may reroll any failed Pinning test – once per turn, and counts its Initiative as double for Awareness tests.' })),
    ],
    armour: armour as SheetCharacter['armour'],
    firearms: [firearm(0), ...Array.from({ length: more }, (_, k) => firearm(k + 1))],
    melee: [
      { name: `Chainsword ${n}`, rch: '2', dam: `D10+${n}`, pp: `${n}`, special: `Rending ${n}` },
      { name: `Knife ${n}`, rch: '1', dam: `D3+${n}`, pp: '0', special: '' },
    ],
    other: [`Rosarius ${n}`, `Frag Grenade ×${n + 1}`, `“Lucky” charm ${n}`],
  };
}

const HEADINGS = [
  ...SHEET_STATS, 'Game Notes', 'Starting', 'Progress', 'Current', 'Abilities:',
  'Location', ...SHEET_LOCATIONS, 'Injury', 'Total',
  '1 - 15', '16 - 30', '31-35', '36-50', '51-65', '66-80', '81-95', '96-00',
  'Armour', 'Injury Lvl',
  'Firearm', 'Type', 'Rng', 'Mode', 'Acc', 'Damage', 'Shots', 'Rld', 'Enc', '# Rld', 'Special',
  'Melee', 'Rch', 'Dam', 'PP', 'Other Equipment/Bionics/Etc',
];

// WinAnsi's 0x80–0x9F.
const CP1252 = '€\0‚ƒ„…†‡ˆ‰Š‹Œ\0Ž\0\0‘’“”•–—˜™š›œ\0žŸ';
const decode = (bytes: string) =>
  bytes.replace(/[\x80-\x9f]/g, (c) => CP1252[c.charCodeAt(0) - 0x80]);
const unescape = (s: string) =>
  s.replace(/\\([0-7]{1,3}|.)/g, (_, e: string) =>
    /^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[e] ?? e);

/** The smallest PDF reader for what jsPDF writes: each page's content stream, its strings drawn in order. */
function readPdf(pdf: Uint8Array) {
  const raw = Buffer.from(pdf).toString('latin1');
  assert.ok(raw.startsWith('%PDF-'), 'a PDF header');
  assert.match(raw, /startxref\s+\d+\s+%%EOF\s*$/, 'a trailer');
  const xref = Number(raw.match(/startxref\s+(\d+)/)![1]);
  assert.ok(raw.startsWith('xref', xref), 'startxref points at the xref table');
  const objects = new Map<number, string>();
  for (const m of raw.matchAll(/(?:^|\n)(\d+) 0 obj([\s\S]*?)endobj/g)) objects.set(Number(m[1]), m[2]);
  const pages = [...objects.values()].filter((o) => /\/Type \/Page\b(?!s)/.test(o));
  const texts = pages.map((p) => {
    const ref = Number(p.match(/\/Contents (\d+) 0 R/)![1]);
    const obj = objects.get(ref)!;
    let stream = Buffer.from(obj.slice(obj.indexOf('stream') + 6).replace(/^\r?\n/, '').replace(/\r?\n?$/, ''), 'latin1');
    if (obj.includes('/FlateDecode')) stream = inflateSync(stream);
    const content = stream.toString('latin1');
    return [...content.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => decode(unescape(m[1])));
  });
  return { pages: texts };
}

test('renderSheetPdf: three blocks to an A4 page, every heading and value as text', () => {
  const characters = [
    sample(1, 'Malachai Venn', 'Inquisitor, Puritan, Leader, Ordo Hereticus'),
    sample(2, 'Sister Ottilie & (Co)', 'Adepta Sororitas, Battle Sister, Fighter, Loyalist'),
    sample(3, 'Varro Kesh', 'Guardsman, Veteran, Fighter, Loyalist'),
    sample(4, 'Ix-9', 'Tech-Priest, Enginseer, Specialist, Loyalist'),
  ];
  const { pages } = readPdf(renderSheetPdf(characters));
  assert.equal(pages.length, 2, 'two pages');
  assert.deepEqual(pages.map((p) => p.filter((t) => characters.some((c) => c.name === t))), [
    ['Malachai Venn', 'Sister Ottilie & (Co)', 'Varro Kesh'],
    ['Ix-9'],
  ]);
  for (const p of pages) for (const h of HEADINGS) assert.ok(p.some((t) => t.trim() === h), `page has "${h}"`);
  const all = pages.flat().join('\n');
  for (const c of characters) {
    assert.ok(all.includes(` (${c.tagLine})`));
    for (const s of SHEET_STATS) assert.ok(pages.flat().includes(c.starting[s]));
    for (const v of [...c.gameNotes, ...c.other, c.melee[0].name, c.firearms[0].name, c.abilities[0].name, ` (${c.abilities[0].effect})`])
      assert.ok(all.includes(v), v);
  }
  assert.ok(all.includes('Frag Grenade ×2') && all.includes('“Lucky” charm 1'), 'WinAnsi characters come out as written');
});

test('renderSheetPdf: a taller block (many firearms, abilities, long notes) adds rows and moves whole to the next page', () => {
  const characters = [
    sample(1, 'Malachai Venn', 'Inquisitor, Puritan, Leader, Ordo Hereticus'),
    sample(2, 'Sister Ottilie', 'Adepta Sororitas, Battle Sister, Fighter, Loyalist'),
    sample(5, 'Ordo Big', 'Inquisitor, Radical, Leader, Ordo Malleus', 6),
  ];
  const { pages } = readPdf(renderSheetPdf(characters));
  assert.equal(pages.length, 2, 'the tall block starts page two');
  assert.ok(!pages[0].includes('Ordo Big') && pages[1].includes('Ordo Big'));
  const second = pages[1].join(' ');
  for (let k = 0; k <= 6; k++) assert.ok(second.includes(`Bolt Pistol 5.${k}`), `firearm row ${k}`);
  for (let k = 0; k < 6; k++) assert.ok(second.includes(`Talent 5.${k}`), `ability ${k}`);
  assert.ok(second.includes('–'), 'an en dash');
  // Long notes wrap over lines of the column (no line is the whole note).
  assert.ok(!pages[1].some((t) => t.includes('that wraps over several lines of the narrow column')));
  assert.ok(second.includes('A long game note 5.0'));
});

test('renderSheetPdf: one empty block is still a page', () => {
  assert.equal(readPdf(renderSheetPdf([])).pages.length, 1);
});

test('winAnsi: characters outside the standard fonts are spelt with ones inside', () => {
  assert.equal(winAnsi('A – B × “C” ‘d’ … é'), 'A – B × “C” ‘d’ … é');
  assert.equal(winAnsi('Move ➔ 3 − 1 ⌊100⌋'), 'Move -> 3 - 1 100');
  assert.equal(winAnsi('Ł'), '?');
});
