// Characters (their head versions) as the GM's sheet (src/shared/sheet.ts),
// for the Word and PDF exports and the print view, each followed by its companions. Each is built under the rules it
// was made with when this browser has them, else the current ones, like
// the builder shows it.
import type { Version } from "../../shared/api.ts";
import { characterSheets } from "../../shared/sheet-map.ts";
import type { SheetCharacter } from "../../shared/sheet.ts";
import { engineRecord, view } from "../builder/ops.ts";
import type { FullBuild } from "../../shared/engine/companions.ts";
import { loadRules, rulesAt, type Rules } from "../lib/rules.ts";

export type SheetSource = { name: string; head: Version };

/** A head version built for showing: under its own rules when this browser has them, else `current`; null when it can't be built. */
export async function buildRow(r: SheetSource, current: Rules): Promise<{ rules: Rules; result: FullBuild } | null> {
  const rec = engineRecord(r.head.record);
  if (!rec) return null;
  const rules = (r.head.rules_version && r.head.rules_version !== current.version ? await rulesAt(r.head.rules_version) : null) ?? current;
  try {
    return { rules, result: view(rules.compendium, rec) };
  } catch {
    // A record the rules can't build (an archetype since removed).
    return null;
  }
}

export async function sheetsOf(rows: SheetSource[]): Promise<SheetCharacter[]> {
  const current = await loadRules();
  const out: SheetCharacter[] = [];
  for (const r of rows) {
    const b = await buildRow(r, current);
    if (!b) continue;
    // Its companions' sheets (a Technical Servitor's) after its own.
    const [sheet, ...companions] = characterSheets(b.result, b.rules.compendium);
    if (!sheet.name) sheet.name = r.name;
    out.push(sheet, ...companions);
  }
  return out;
}

/** Saves the GM's Word sheet for these characters (three per page). */
export async function exportWord(rows: SheetSource[], name?: string): Promise<void> {
  const [sheets, docx] = await Promise.all([sheetsOf(rows), import("./docx.ts")]);
  if (sheets.length) await docx.downloadSheetDocx(sheets, name);
}

/** Saves the GM's sheet for these characters as a PDF (three per page). */
export async function exportPdf(rows: SheetSource[], name?: string): Promise<void> {
  const [sheets, pdf] = await Promise.all([sheetsOf(rows), import("./pdf.ts")]);
  if (sheets.length) await pdf.downloadSheetPdf(sheets, name);
}
