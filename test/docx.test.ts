import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { renderSheetDocx } from '../src/client/export/docx.ts';
import { SHEET_LOCATIONS, SHEET_STATS, type SheetCharacter } from '../src/shared/sheet.ts';

const root = new URL('../', import.meta.url);
const templatePath = new URL('src/client/export/sheet-template.docx', root);
const samplePath = new URL('data/source/sample-sheet.docx', root);

// Made-up characters; every value is distinct so each can be found in its block.
function sample(n: number, name: string, tagLine: string): SheetCharacter {
  const starting = Object.fromEntries(SHEET_STATS.map((s, i) => [s, String(40 + n * 14 + i)]));
  const armour = Object.fromEntries(SHEET_LOCATIONS.map((l, i) => [l, `${n}${i}`]));
  return {
    name,
    tagLine,
    starting: starting as SheetCharacter['starting'],
    gameNotes: [`Note ${n}a`, `Note ${n}b`],
    abilities: [
      { name: `Gift ${n}`, effect: `Rerolls one test ${n}.` },
      { name: `Oath ${n}`, effect: '' },
    ],
    armour: armour as SheetCharacter['armour'],
    firearms: [{
      name: `Bolt Pistol ${n}`, type: 'Pistol', rng: `${10 + n}`, mode: 'Single', acc: `+${n}`,
      damage: `2D6+${n}`, shots: `${6 + n}`, rld: '1', enc: `${n}`, reloads: `${n + 1}`, special: `Fancy ${n}`,
    }],
    melee: [
      { name: `Chainsword ${n}`, rch: '2', dam: `D10+${n}`, pp: `${n}`, special: `Rending ${n}` },
      { name: `Knife ${n}`, rch: '1', dam: `D3+${n}`, pp: '0', special: '' },
    ],
    other: [`Rosarius ${n}`, `Bionic eye ${n}`],
  };
}

const characters = [
  sample(1, 'Malachai Venn', 'Inquisitor, Puritan, Leader, Ordo Hereticus'),
  sample(2, 'Sister Ottilie & <Co>', 'Adepta Sororitas, Battle Sister, Fighter, Loyalist'),
  sample(3, 'Varro Kesh', 'Guardsman, Veteran, Fighter, Loyalist'),
  sample(4, 'Ix-9', 'Tech-Priest, Enginseer, Specialist, Loyalist'),
];

// Every text of an empty block, in reading order: the sheet's own headings.
const SHEET_HEADINGS = [
  ...SHEET_STATS, 'Game Notes', 'Starting', 'Progress', 'Current', 'Abilities:',
  'Location', ...SHEET_LOCATIONS, 'Injury \nTotal',
  '1 - 15', '16 - 30', '31-35', '36-50', '51-65', '66-80', '81-95', '96-00',
  'Armour', 'Injury Lvl',
  'Firearm', 'Type', 'Rng', 'Mode', 'Acc', 'Damage', 'Shots', 'Rld', 'Enc', '# Rld', 'Special',
  'Melee', 'Rch', 'Dam', 'PP', 'Special', 'Other Equipment/Bionics/Etc',
];

// The smallest zip reader that gets word/document.xml out of a .docx.
function unzipEntry(zip: Uint8Array, name: string): string {
  const buf = Buffer.from(zip);
  let eocd = buf.length - 22;
  while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    p += 46 + nameLen + extra;
  }
  throw new Error(`${name} not in zip`);
}

const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textOf = (xml: string) =>
  unescape([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\/>|<\/w:p>/g)]
    .map((m) => (m[0] === '<w:br/>' || m[0] === '</w:p>' ? '\n' : m[1])).join('')).trim();

/** The body's blocks: each name paragraph with the table after it, split into rows of cell texts. */
function blocks(xml: string) {
  const body = xml.slice(xml.indexOf('<w:body>'), xml.indexOf('</w:body>'));
  const parts = body.split(/(?=<w:tbl>)|(?<=<\/w:tbl>)/);
  const out: { name: string; pageBreak: boolean; rows: string[][] }[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith('<w:tbl>')) continue;
    const paras = parts[i - 1].match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
    const nameP = paras.findLast((p) => /<w:t[ >]/.test(p) || p.includes('pageBreakBefore')) ?? paras.at(-1) ?? '';
    const rows = (parts[i].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? []).map((r) =>
      (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map(textOf));
    out.push({ name: textOf(nameP), pageBreak: nameP.includes('<w:pageBreakBefore/>'), rows });
  }
  return out;
}

test('renderSheetDocx: four characters fill two pages, each value in its own block', async () => {
  const template = readFileSync(templatePath);
  const docx = await renderSheetDocx(characters, template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength));
  if (existsSync(new URL('data/source/', root))) writeFileSync(samplePath, docx);
  const xml = unzipEntry(docx, 'word/document.xml');
  assert.ok(!xml.includes('{{'), 'no command is left in the output');

  const bs = blocks(xml);
  assert.equal(bs.length, 6, 'two pages of three blocks');
  assert.deepEqual(bs.map((b) => b.pageBreak), [false, false, false, true, false, false], 'the second page starts on a new page');

  characters.forEach((c, i) => {
    const b = bs[i];
    assert.equal(b.name, `${c.name} (${c.tagLine})`);
    const row = (label: string) => b.rows.find((r) => r[0] === label)!;
    // Starting row: 14 stat cells, then Game Notes (one line each).
    assert.deepEqual(row('Starting').slice(1, 15), SHEET_STATS.map((s) => c.starting[s]));
    assert.equal(row('Starting')[15], c.gameNotes.join('\n'));
    assert.deepEqual(row('Progress').slice(1, 15), SHEET_STATS.map(() => ''), 'Progress stays blank');
    assert.deepEqual(row('Current').slice(1, 15), SHEET_STATS.map(() => ''), 'Current stays blank');
    const abilities = b.rows.find((r) => r[0].startsWith('Abilities: '))![0];
    assert.deepEqual(abilities.split('\n'), [
      `Abilities: ${c.abilities[0].name} (${c.abilities[0].effect})`,
      c.abilities[1].name,
    ]);
    assert.deepEqual(row('Armour').slice(1, 9), SHEET_LOCATIONS.map((l) => c.armour[l]));
    assert.deepEqual(row('Injury Lvl').slice(1, 9), SHEET_LOCATIONS.map(() => ''), 'Injury Lvl stays blank');
    // Firearm rows: the sheet's two, the second blank.
    const fh = b.rows.findIndex((r) => r[0] === 'Firearm');
    const f = c.firearms[0];
    assert.deepEqual(b.rows[fh + 1], [f.name, f.type, f.rng, f.mode, f.acc, f.damage, f.shots, '', f.rld, f.enc, '', `/ ${f.reloads}`, f.special, '']);
    assert.deepEqual(b.rows[fh + 2], ['', '', '', '', '', '', '', '', '', '', '', '/', '', '']);
    // Melee rows, with Other Equipment/Bionics/Etc in the merged cell.
    const mh = b.rows.findIndex((r) => r[0] === 'Melee');
    assert.equal(b.rows.length, mh + 3, 'the sheet\'s two melee rows');
    c.melee.forEach((m, j) => assert.deepEqual(b.rows[mh + 1 + j].slice(0, 5), [m.name, m.rch, m.dam, m.pp, m.special]));
    assert.equal(b.rows[mh + 1][5], c.other.join('\n'));
  });

  // The rest of the second page: two empty blocks with the sheet's headings.
  for (const b of bs.slice(4)) {
    assert.equal(b.name, '');
    const filled = b.rows.flat().filter((t) => t !== '' && t !== '/');
    assert.deepEqual(filled, SHEET_HEADINGS);
  }
});

test('renderSheetDocx: more rows than the sheet has add rows; no characters gives one empty page', async () => {
  const template = readFileSync(templatePath);
  const ab = template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength);
  const c = sample(5, 'Many Arms', '');
  c.firearms = [1, 2, 3].map((k) => ({ ...c.firearms[0], name: `Gun ${k}` }));
  c.melee = [1, 2, 3, 4].map((k) => ({ ...c.melee[0], name: `Blade ${k}` }));
  const bs = blocks(unzipEntry(await renderSheetDocx([c], ab), 'word/document.xml'));
  assert.equal(bs.length, 3);
  assert.equal(bs[0].name, 'Many Arms', 'no brackets without a tag line');
  const names = bs[0].rows.map((r) => r[0]);
  assert.deepEqual(names.filter((n) => n.startsWith('Gun ')), ['Gun 1', 'Gun 2', 'Gun 3']);
  assert.deepEqual(names.filter((n) => n.startsWith('Blade ')), ['Blade 1', 'Blade 2', 'Blade 3', 'Blade 4']);
  assert.equal(bs[1].name, '');

  const empty = blocks(unzipEntry(await renderSheetDocx([], ab), 'word/document.xml'));
  assert.equal(empty.length, 3);
});
