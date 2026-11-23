// Characters (their head versions) as the GM's sheet (src/shared/sheet.ts),
// for the Word export and the print view. Each is built under the rules it
// was made with when this browser has them, else the current ones, like
// the builder shows it.
import type { Version } from "../../shared/api.ts";
import { toSheetCharacter } from "../../shared/sheet-map.ts";
import type { SheetCharacter } from "../../shared/sheet.ts";
import { engineRecord, view } from "../builder/ops.ts";
import type { BuildResult } from "../../shared/engine/build.ts";
import { loadRules, rulesAt, type Rules } from "../lib/rules.ts";

export type SheetSource = { name: string; head: Version };

/** A head version built for showing: under its own rules when this browser has them, else `current`; null when it can't be built. */
export async function buildRow(r: SheetSource, current: Rules): Promise<{ rules: Rules; result: BuildResult } | null> {
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
    const sheet = toSheetCharacter(b.result.character, b.rules.compendium);
    if (!sheet.name) sheet.name = r.name;
    out.push(sheet);
  }
  return out;
}

/** Saves the GM's Word sheet for these characters (three per page). */
export async function exportWord(rows: SheetSource[], name?: string): Promise<void> {
  const [sheets, docx] = await Promise.all([sheetsOf(rows), import("./docx.ts")]);
  if (sheets.length) await docx.downloadSheetDocx(sheets, name);
}

/** Opens the print view for these characters (three per page) and the browser's print dialog. */
export async function exportPrint(rows: SheetSource[], opts: { print?: boolean; onWord?: () => void } = {}): Promise<void> {
  const [sheets, print] = await Promise.all([sheetsOf(rows), import("../print/open.tsx")]);
  if (sheets.length) print.openPrintView(sheets, { print: opts.print ?? true, onWord: opts.onWord });
}
