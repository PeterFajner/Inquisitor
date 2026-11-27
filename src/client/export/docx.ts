// Word export of the GM's sheet: fills sheet-template.docx (the GM's
// BETTER_3_CHARACTERSPER_PAGE.doc with docx-templates commands, served at
// /static/sheet-template.docx) with SheetCharacters, three blocks per page;
// a block never splits across pages (scripts/sheet-keep-together.py).
//
// Uses docx-templates' browser bundle, which carries its own polyfills, so
// the app needs no Node Buffer polyfill; it also runs under Node (tests).
// The template's commands are ours, so they run without the sandbox (the
// sandbox would need an iframe).

// @ts-expect-error -- the browser bundle ships no .d.ts; typed from the main entry below.
import { createReport as createReportUntyped } from 'docx-templates/lib/browser.js';
import type { createReport as CreateReport } from 'docx-templates';
import {
  SHEET_BLOCKS_PER_PAGE,
  blankSheetCharacter,
  type SheetCharacter,
  type SheetFirearm,
  type SheetMelee,
} from '../../shared/sheet.ts';

const createReport = createReportUntyped as typeof CreateReport;

export const SHEET_TEMPLATE_URL = '/static/sheet-template.docx';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// The sheet has two Firearm rows and two Melee rows; fewer are padded with
// blank rows, more add rows to the block.
const SHEET_ROWS = 2;
// The Abilities cell is three lines tall on the sheet.
const ABILITY_LINES = 3;

const blankFirearm: SheetFirearm = {
  name: '', type: '', rng: '', mode: '', acc: '', damage: '',
  shots: '', rld: '', enc: '', reloads: '', special: '',
};
const blankMelee: SheetMelee = { name: '', rch: '', dam: '', pp: '', special: '' };

function pad<T>(rows: T[], blank: T, length: number): T[] {
  const out = rows.slice();
  while (out.length < length) out.push(blank);
  return out;
}

// What the template's commands read for one block (see the template:
// $page.a/b/c are the page's three blocks).
function slot(c: SheetCharacter) {
  const firearms = pad(c.firearms, blankFirearm, SHEET_ROWS);
  const melee = pad(c.melee, blankMelee, SHEET_ROWS);
  const abilities = pad(
    c.abilities.map((a) => ({ name: a.name, rest: a.effect ? ` (${a.effect})` : '' })),
    { name: '', rest: '' },
    ABILITY_LINES,
  );
  return {
    name: c.name,
    open: c.tagLine ? ' (' : '',
    tagLine: c.tagLine,
    close: c.tagLine ? ')' : '',
    starting: c.starting,
    gameNotes: c.gameNotes.join('\n'),
    ability1: abilities[0],
    abilitiesRest: abilities.slice(1),
    armour: c.armour,
    firearm1: firearms[0],
    firearmsRest: firearms.slice(1),
    melee1: melee[0],
    meleeRest: melee.slice(1),
    other: c.other.join('\n'),
  };
}

function pages(characters: SheetCharacter[]) {
  const out = [];
  const count = Math.max(1, Math.ceil(characters.length / SHEET_BLOCKS_PER_PAGE));
  for (let p = 0; p < count; p++) {
    const block = (i: number) => slot(characters[p * SHEET_BLOCKS_PER_PAGE + i] ?? blankSheetCharacter());
    out.push({ first: p === 0, a: block(0), b: block(1), c: block(2) });
  }
  return out;
}

// docx-templates writes text between this delimiter as raw XML (its
// default, "||", can be typed into a name). A private-use character no
// value may contain: every string is stripped of it.
const LITERAL_XML = '\uE000';
const noLiteralXml = (x: unknown): unknown =>
  typeof x === 'string'
    ? x.replaceAll(LITERAL_XML, '')
    : Array.isArray(x)
      ? x.map(noLiteralXml)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, noLiteralXml(v)]))
        : x;

/** Fills the sheet template with `characters`, three per page (a partly used last page keeps its other blocks empty). */
export async function renderSheetDocx(characters: SheetCharacter[], template: ArrayBuffer): Promise<Uint8Array> {
  return createReport({
    template: new Uint8Array(template),
    data: noLiteralXml({ pages: pages(characters) }) as { pages: ReturnType<typeof pages> },
    cmdDelimiter: ['{{', '}}'],
    literalXmlDelimiter: LITERAL_XML,
    noSandbox: true,
    processLineBreaks: true,
    processLineBreaksAsNewText: true,
    rejectNullish: true,
    failFast: true,
    indentXml: false,
    preserveSpace: true,
  });
}

/** Fetches the template, fills it and saves the .docx, named `name`, or after the characters. */
export async function downloadSheetDocx(characters: SheetCharacter[], name?: string): Promise<void> {
  const res = await fetch(SHEET_TEMPLATE_URL);
  if (!res.ok) throw new Error(`${SHEET_TEMPLATE_URL}: ${res.status}`);
  const docx = await renderSheetDocx(characters, await res.arrayBuffer());
  const names = name?.trim() || characters.map((c) => c.name.trim()).filter(Boolean).join(', ');
  const fileName = `${(names || 'sheet').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120)}.docx`;
  const url = URL.createObjectURL(new Blob([docx as Uint8Array<ArrayBuffer>], { type: DOCX_TYPE }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
