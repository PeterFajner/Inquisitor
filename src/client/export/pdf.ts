// PDF export of the GM's sheet: the print view's layout (src/client/print/
// PrintSheets.tsx and print.css) drawn as vector text and lines with jsPDF,
// three blocks to an A4 page, black on white. A block never splits across
// pages: one that doesn't fit what is left of a page starts the next.
// Lengths are in mm, font sizes in pt.
//
// The standard fonts (Helvetica) are WinAnsi-encoded, which covers the
// sheet's "–", "×", "—", curly quotes and Latin-1; anything else is mapped
// to its nearest WinAnsi spelling (winAnsi()).
import { jsPDF } from "jspdf";
import { SHEET_LOCATIONS, SHEET_STATS, type SheetCharacter } from "../../shared/sheet.ts";
import { saveFile } from "./save.ts";

type RGB = [number, number, number];
const INK: RGB = [0, 0, 0];
const INK_2: RGB = [85, 85, 85];
const LINE: RGB = [160, 160, 160];
const SHADE: RGB = [228, 228, 228];
const RED: RGB = [190, 0, 0];

const PAGE_H = 297;
const MARGIN = 8;
const WIDTH = 194;
const NOTES_W = 36;
const MAIN_W = WIDTH - NOTES_W;
const BLOCK_MIN_H = 80;
const BLOCK_GAP = 3;

const SIZE = 7.5;
const SMALL = 6.5;
const RANGE_SIZE = 6;
const NAME_SIZE = 11;
const MIN_SIZE = 4.5;
const ROW_H = 3.8;
const WEAPON_ROW_H = 4.6;
const PAD_X = 0.8;
const PT = 25.4 / 72;
const LEADING = 1.25;

// The Location table's hit ranges (the sheet's own small print).
const RANGES = ["1 - 15", "16 - 30", "31-35", "36-50", "51-65", "66-80", "81-95", "96-00"];
const DERIVED = new Set<string>(["Kbk", "BIV", "SS", "Cnc", "Spd"]);
// The sheet has two Firearm and two Melee rows; more add rows.
const ROWS = 2;

// Column widths. Stats: the row heading then 14 equal columns. Location:
// the row heading, 8 locations, Injury Total.
const HEAD_W = 14.2;
const STAT_W = (MAIN_W - HEAD_W) / SHEET_STATS.length;
const LOC_W = (MAIN_W - 2 * HEAD_W) / SHEET_LOCATIONS.length;
type Col<T> = { head: string; w: number; get: (r: T) => string; wrap?: boolean; size?: number };
type Firearm = SheetCharacter["firearms"][number];
type Melee = SheetCharacter["melee"][number];
const FIREARM_COLS: Col<Firearm>[] = [
  { head: "Firearm", w: 24, get: (f) => f.name, wrap: true },
  { head: "Type", w: 11, get: (f) => f.type },
  { head: "Rng", w: 8, get: (f) => f.rng },
  { head: "Mode", w: 15, get: (f) => f.mode },
  { head: "Acc", w: 8, get: (f) => f.acc },
  { head: "Damage", w: 13, get: (f) => f.damage },
  { head: "Shots", w: 9, get: (f) => f.shots },
  { head: "Rld", w: 7, get: (f) => f.rld },
  { head: "Enc", w: 7, get: (f) => f.enc },
  { head: "# Rld", w: 9, get: (f) => `/ ${f.reloads}` },
  { head: "Special", w: 47, get: (f) => f.special, wrap: true, size: SMALL },
];
// The bottom row: Melee 1.25fr, Other Equipment 1fr.
const MELEE_W = (MAIN_W * 1.25) / 2.25;
const OTHER_W = MAIN_W - MELEE_W;
const MELEE_COLS: Col<Melee>[] = [
  { head: "Melee", w: 24, get: (m) => m.name, wrap: true },
  { head: "Rch", w: 8, get: (m) => m.rch },
  { head: "Dam", w: 11, get: (m) => m.dam },
  { head: "PP", w: 8, get: (m) => m.pp },
  { head: "Special", w: MELEE_W - 51, get: (m) => m.special, wrap: true, size: SMALL },
];

// WinAnsi's characters above Latin-1 (cp1252's 0x80–0x9F).
const CP1252 = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const SPELLINGS: Record<string, string> = { "−": "-", "‐": "-", "‑": "-", "➔": "->", "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "⌊": "", "⌋": "", "​": "" };

/** `s` in characters the standard fonts can draw. */
export function winAnsi(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    if (ch.codePointAt(0)! < 256 || CP1252.has(ch)) out += ch;
    else if (ch in SPELLINGS) out += SPELLINGS[ch];
    else out += ch.normalize("NFKD").replace(/[^\u0000-ÿ]/g, "") || "?";
  }
  return out;
}

type Run = { text: string; bold?: boolean; color?: RGB };
type Piece = Run & { w: number };
type Line = { pieces: Piece[]; w: number };
type Para = { lines: Line[]; size: number; h: number };

class Sheet {
  doc: jsPDF;
  constructor() {
    this.doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    this.doc.setLineJoin("miter");
  }

  width(text: string, size: number, bold?: boolean): number {
    this.doc.setFont("helvetica", bold ? "bold" : "normal");
    return this.doc.getStringUnitWidth(text) * size * PT;
  }

  /** `runs` set as one paragraph, wrapped to `w` (unless `wrap` is false); words longer than a line are broken. */
  lay(runs: Run[], w: number, size: number, wrap = true): Para {
    const measure = (text: string, bold?: boolean) => this.width(text, size, bold);
    const lines: Line[] = [{ pieces: [], w: 0 }];
    const push = (r: Run, text: string) => {
      const line = lines.at(-1)!;
      const last = line.pieces.at(-1);
      const pw = this.width(text, size, r.bold);
      if (last && last.bold === r.bold && last.color === r.color) {
        last.text += text;
        last.w += pw;
      } else line.pieces.push({ ...r, text, w: pw });
      line.w += pw;
    };
    for (const r of runs) {
      for (const word of winAnsi(r.text).match(/\S+\s*|\s+/g) ?? []) {
        const ww = this.width(word.trimEnd(), size, r.bold);
        const line = lines.at(-1)!;
        if (wrap && line.w > 0 && line.w + ww > w) {
          trimLine(line);
          lines.push({ pieces: [], w: 0 });
        }
        if (wrap && ww > w) {
          // Too long for any line: break it by characters.
          let part = "";
          for (const ch of word) {
            if (part && lines.at(-1)!.w + this.width(part + ch, size, r.bold) > w) {
              push(r, part);
              lines.push({ pieces: [], w: 0 });
              part = "";
            }
            part += ch;
          }
          push(r, part);
        } else push(r, word);
      }
    }
    lines.forEach((l) => trimLine(l));
    return { lines, size, h: lines.length * size * PT * LEADING };

    // A line's trailing space takes no room.
    function trimLine(line: Line) {
      const last = line.pieces.at(-1);
      if (!last || last.text === last.text.trimEnd()) return;
      last.text = last.text.trimEnd();
      line.w -= last.w;
      last.w = measure(last.text, last.bold);
      line.w += last.w;
    }
  }

  /** `runs` set in `w` by `h` at `size`, smaller (to MIN_SIZE) until it fits: wrapping when `wrap`, else on one line. */
  fit(runs: Run[], w: number, h: number, size: number, wrap: boolean): Para {
    let p = this.lay(runs, w, size, wrap);
    while (p.size > MIN_SIZE && (p.h > h + 0.01 || (!wrap && p.lines[0].w > w))) {
      p = this.lay(runs, w, Math.max(MIN_SIZE, p.size - 0.25), wrap);
    }
    return p;
  }

  /** Draws a paragraph in the box, centred vertically unless `top`. */
  draw(p: Para, x: number, y: number, w: number, h: number, align: "left" | "center", top = false) {
    const lh = p.size * PT * LEADING;
    let line0 = top ? y : y + (h - p.h) / 2;
    for (const line of p.lines) {
      // The baseline: a cap height's worth (0.72 em) below the middle of the line box, halved.
      const base = line0 + lh / 2 + p.size * PT * 0.35;
      let px = align === "center" ? x + (w - line.w) / 2 : x;
      for (const piece of line.pieces) {
        this.doc.setFont("helvetica", piece.bold ? "bold" : "normal");
        this.doc.setFontSize(p.size);
        this.doc.setTextColor(...(piece.color ?? INK));
        this.doc.text(piece.text, px, base);
        px += piece.w;
      }
      line0 += lh;
    }
  }

  fill(x: number, y: number, w: number, h: number, color = SHADE) {
    this.doc.setFillColor(...color);
    this.doc.rect(x, y, w, h, "F");
  }

  box(x: number, y: number, w: number, h: number, color = LINE, lw = 0.15) {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(lw);
    this.doc.rect(x, y, w, h, "S");
  }

  hline(x: number, y: number, w: number, color = LINE, lw = 0.15) {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(lw);
    this.doc.line(x, y, x + w, y);
  }

  /** A table cell: shading, border, then its text. */
  cell(text: string, x: number, y: number, w: number, h: number, o: { bold?: boolean; size?: number; shade?: boolean; align?: "left" | "center"; wrap?: boolean; color?: RGB } = {}) {
    if (o.shade) this.fill(x, y, w, h);
    this.box(x, y, w, h);
    if (!text) return;
    const p = this.fit([{ text, bold: o.bold, color: o.color }], w - 2 * PAD_X, h - 0.4, o.size ?? SIZE, o.wrap ?? false);
    this.draw(p, x + PAD_X, y, w - 2 * PAD_X, h, o.align ?? "center");
  }
}

/** A paragraph's height in a cell of a wrapping column: its lines and the padding, at least `min`. */
function rowHeight(s: Sheet, cols: Col<any>[], row: unknown, min: number): number {
  let h = min;
  for (const c of cols) {
    if (!c.wrap) continue;
    const text = row ? c.get(row) : "";
    if (!text) continue;
    h = Math.max(h, s.lay([{ text }], c.w - 2 * PAD_X, c.size ?? SIZE).h + 0.8);
  }
  return h;
}

/** One character's block, laid out; `draw` puts it at `y`. */
function block(s: Sheet, c: SheetCharacter) {
  // The name line: the name bold red, then "(Archtype, Subtype, Role, Alignment)".
  const nameRuns: Run[] = [{ text: c.name, bold: true, color: RED }];
  if (c.tagLine) nameRuns.push({ text: ` (${c.tagLine})` });
  const nameP = s.fit(nameRuns, WIDTH, NAME_SIZE * PT * LEADING, NAME_SIZE, false);
  const nameH = NAME_SIZE * PT * LEADING + 1;

  // Abilities: "Abilities:" then one ability a line, its name bold red.
  const abilityRuns: Run[][] = c.abilities.length
    ? c.abilities.map((a, i) => [
        ...(i === 0 ? [{ text: "Abilities: ", bold: true }] : []),
        { text: a.name, bold: true, color: RED },
        ...(a.effect ? [{ text: ` (${a.effect})` }] : []),
      ])
    : [[{ text: "Abilities:", bold: true }]];
  const abilityW = MAIN_W - 4;
  const abilityPs = abilityRuns.map((r) => s.lay(r, abilityW, SIZE));
  const abilitiesNat = Math.max(8, abilityPs.reduce((h, p) => h + p.h, 0) + 0.3 * (abilityPs.length - 1) + 2);

  const statsH = 4 * ROW_H;
  const rangesH = 2.8;
  const locH = 3 * ROW_H + rangesH;
  const firearms = padded(c.firearms);
  const melee = padded(c.melee);
  const firearmHs = firearms.map((f) => rowHeight(s, FIREARM_COLS, f, WEAPON_ROW_H));
  const meleeHs = melee.map((m) => rowHeight(s, MELEE_COLS, m, WEAPON_ROW_H));
  const firearmH = ROW_H + sum(firearmHs);
  const meleeH = ROW_H + sum(meleeHs);
  const otherPs = c.other.map((o) => s.lay([{ text: o }], OTHER_W - 2, SIZE));
  const otherH = Math.max(meleeH, ROW_H + 2 + sum(otherPs.map((p) => p.h)));
  const notesPs = c.gameNotes.map((n) => s.lay([{ text: n, bold: true, color: RED }], NOTES_W - 3, SIZE));
  const notesH = ROW_H + 2 + sum(notesPs.map((p) => p.h));

  const rest = statsH + locH + firearmH + otherH;
  const gridH = Math.max(rest + abilitiesNat, notesH, BLOCK_MIN_H - nameH);
  const abilitiesH = gridH - rest;

  return {
    h: nameH + gridH,
    draw(y: number) {
      const x = MARGIN;
      s.draw(nameP, x, y, WIDTH, nameH - 1, "left");
      let gy = y + nameH;
      const top = gy;

      // Stats: the stat headings, then Starting, Progress, Current (the derived columns shaded for play).
      s.cell("", x, gy, HEAD_W, ROW_H, { shade: true });
      SHEET_STATS.forEach((st, i) => s.cell(st, x + HEAD_W + i * STAT_W, gy, STAT_W, ROW_H, { bold: true, shade: true }));
      gy += ROW_H;
      for (const row of ["Starting", "Progress", "Current"]) {
        s.cell(row, x, gy, HEAD_W, ROW_H, { bold: true, align: "left" });
        SHEET_STATS.forEach((st, i) =>
          s.cell(row === "Starting" ? c.starting[st] : "", x + HEAD_W + i * STAT_W, gy, STAT_W, ROW_H, { shade: row !== "Starting" && DERIVED.has(st) }),
        );
        gy += ROW_H;
      }

      // Abilities, from the top of their cell.
      let ay = gy + 1;
      for (const p of abilityPs) {
        s.draw(p, x + 2, ay, abilityW, p.h, "center", true);
        ay += p.h + 0.3;
      }
      gy += abilitiesH;
      s.hline(x, gy, MAIN_W);

      // Location: the headings over their hit ranges (one cell each), Armour, Injury Lvl; Injury Total spans two rows each side.
      const headH = ROW_H + rangesH;
      s.fill(x, gy, MAIN_W, ROW_H);
      s.box(x, gy, HEAD_W, headH);
      s.draw(s.fit([{ text: "Location", bold: true }], HEAD_W - 2 * PAD_X, ROW_H, SIZE, false), x + PAD_X, gy, HEAD_W - 2 * PAD_X, ROW_H, "center");
      SHEET_LOCATIONS.forEach((l, i) => {
        const lx = x + HEAD_W + i * LOC_W;
        s.box(lx, gy, LOC_W, headH);
        s.draw(s.fit([{ text: l, bold: true }], LOC_W - 2 * PAD_X, ROW_H, SIZE, false), lx + PAD_X, gy, LOC_W - 2 * PAD_X, ROW_H, "center");
        s.draw(s.fit([{ text: RANGES[i], color: INK_2 }], LOC_W - 2 * PAD_X, rangesH, RANGE_SIZE, false), lx + PAD_X, gy + ROW_H - 0.3, LOC_W - 2 * PAD_X, rangesH, "center");
      });
      const ix = x + MAIN_W - HEAD_W;
      s.cell("Injury Total", ix, gy, HEAD_W, headH, { bold: true, shade: true, wrap: true });
      gy += headH;
      s.cell("Armour", x, gy, HEAD_W, ROW_H, { bold: true, align: "left" });
      SHEET_LOCATIONS.forEach((l, i) => s.cell(c.armour[l], x + HEAD_W + i * LOC_W, gy, LOC_W, ROW_H));
      s.cell("/", ix, gy, HEAD_W, 2 * ROW_H, { size: 10 });
      gy += ROW_H;
      s.cell("Injury Lvl", x, gy, HEAD_W, ROW_H, { bold: true, align: "left" });
      SHEET_LOCATIONS.forEach((_, i) => s.cell("", x + HEAD_W + i * LOC_W, gy, LOC_W, ROW_H, { shade: i % 2 === 1 }));
      gy += ROW_H;

      gy = weaponTable(s, FIREARM_COLS, firearms, firearmHs, x, gy);

      // Melee beside Other Equipment/Bionics/Etc.
      weaponTable(s, MELEE_COLS, melee, meleeHs, x, gy);
      const ox = x + MELEE_W;
      s.cell("Other Equipment/Bionics/Etc", ox, gy, OTHER_W, ROW_H, { bold: true, shade: true });
      let oy = gy + ROW_H + 1;
      for (const p of otherPs) {
        s.draw(p, ox + 1, oy, OTHER_W - 2, p.h, "center", true);
        oy += p.h;
      }
      s.doc.setDrawColor(...INK_2);
      s.doc.setLineWidth(0.25);
      s.doc.line(ox, gy, ox, top + gridH);

      // Game Notes, the whole height.
      const nx = x + MAIN_W;
      s.fill(nx, top, NOTES_W, ROW_H);
      s.draw(s.fit([{ text: "Game Notes", bold: true }], NOTES_W - 2, ROW_H, SIZE, false), nx + 1, top, NOTES_W - 2, ROW_H, "center");
      s.hline(nx, top + ROW_H, NOTES_W, INK_2, 0.25);
      let ny = top + ROW_H + 1;
      for (const p of notesPs) {
        s.draw(p, nx + 1.5, ny, NOTES_W - 3, p.h, "center", true);
        ny += p.h;
      }
      s.doc.setDrawColor(...INK_2);
      s.doc.setLineWidth(0.25);
      s.doc.line(nx, top, nx, top + gridH);
      s.box(x, top, WIDTH, gridH, INK_2, 0.25);
    },
  };
}

function weaponTable<T>(s: Sheet, cols: Col<T>[], rows: (T | null)[], hs: number[], x: number, y: number): number {
  let cx = x;
  for (const c of cols) {
    s.cell(c.head, cx, y, c.w, ROW_H, { bold: true, shade: true, size: SMALL });
    cx += c.w;
  }
  y += ROW_H;
  rows.forEach((r, i) => {
    let cx = x;
    for (const c of cols) {
      s.cell(r ? c.get(r) : "", cx, y, c.w, hs[i], { wrap: c.wrap, size: c.size, align: c.wrap ? "left" : "center" });
      cx += c.w;
    }
    y += hs[i];
  });
  return y;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function padded<T>(rows: T[]): (T | null)[] {
  const out: (T | null)[] = rows.slice();
  while (out.length < ROWS) out.push(null);
  return out;
}

/** The sheet for `characters` as a PDF: blocks flow down A4 pages, three to a page, none split across pages. */
export function renderSheetPdf(characters: SheetCharacter[]): Uint8Array {
  const s = new Sheet();
  let y = MARGIN;
  for (const c of characters) {
    const b = block(s, c);
    if (y > MARGIN && y + b.h > PAGE_H - MARGIN) {
      s.doc.addPage();
      y = MARGIN;
    }
    b.draw(y);
    y += b.h + BLOCK_GAP;
  }
  return new Uint8Array(s.doc.output("arraybuffer"));
}

/** Saves the sheet as a PDF, named `name` (a warband's) or after the characters. */
export async function downloadSheetPdf(characters: SheetCharacter[], name?: string): Promise<void> {
  saveFile(renderSheetPdf(characters), "application/pdf", "pdf", characters.map((c) => c.name), name);
}
