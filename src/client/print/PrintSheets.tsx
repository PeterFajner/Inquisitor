// The GM's sheet for print (data/source/BETTER_3_CHARACTERSPER_PAGE.doc's
// layout): one block per character, three to an A4 or Letter page, the same
// cells the Word export fills (src/client/export/docx.ts). Read-only; on
// screen it is the online read-only format of the sheet. print.css lays it
// out (A4 and Letter: a block is a third of the shorter page).
import { SHEET_LOCATIONS, SHEET_STATS, type SheetCharacter } from "../../shared/sheet.ts";
import "./print.css";

// The Location table's hit ranges (the sheet's own small print).
const RANGES = ["1 - 15", "16 - 30", "31-35", "36-50", "51-65", "66-80", "81-95", "96-00"];
const DERIVED = new Set(["Kbk", "BIV", "SS", "Cnc", "Spd"]);
const FIREARM_HEADS = ["Firearm", "Type", "Rng", "Mode", "Acc", "Damage", "Shots", "Rld", "Enc", "# Rld", "Special"];
const MELEE_HEADS = ["Melee", "Rch", "Dam", "PP", "Special"];
// The sheet has two Firearm and two Melee rows; more add rows.
const ROWS = 2;

function pad<T>(rows: T[], n: number): (T | null)[] {
  const out: (T | null)[] = rows.slice();
  while (out.length < n) out.push(null);
  return out;
}

export function PrintBlock({ sheet }: { sheet: SheetCharacter }) {
  const firearms = pad(sheet.firearms, ROWS);
  const melee = pad(sheet.melee, ROWS);
  return (
    <article class="pb">
      <h2 class="pb-nameline">
        <span class="pb-name">{sheet.name}</span>
        {sheet.tagLine && <span class="pb-tag"> ({sheet.tagLine})</span>}
      </h2>
      <div class="pb-grid">
        <div class="pb-main">
          <table class="pb-table pb-stats">
            <thead>
              <tr>
                <th class="pb-corner" />
                {SHEET_STATS.map((s) => (
                  <th scope="col">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Starting</th>
                {SHEET_STATS.map((s) => (
                  <td>{sheet.starting[s]}</td>
                ))}
              </tr>
              {["Progress", "Current"].map((row) => (
                <tr>
                  <th scope="row">{row}</th>
                  {SHEET_STATS.map((s) => (
                    <td class={DERIVED.has(s) ? "pb-shade" : undefined} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div class="pb-abilities">
            {sheet.abilities.length ? (
              sheet.abilities.map((a, i) => (
                <div class="pb-ability">
                  {i === 0 && <b class="pb-label">Abilities: </b>}
                  <b class="pb-ability-name">{a.name}</b>
                  {a.effect && <span> ({a.effect})</span>}
                </div>
              ))
            ) : (
              <div class="pb-ability">
                <b class="pb-label">Abilities:</b>
              </div>
            )}
          </div>

          <table class="pb-table pb-loc">
            <thead>
              <tr>
                <th scope="col">Location</th>
                {SHEET_LOCATIONS.map((l) => (
                  <th scope="col">{l}</th>
                ))}
                <th scope="col" rowSpan={2} class="pb-injury-head">
                  Injury Total
                </th>
              </tr>
              <tr class="pb-ranges">
                <td />
                {RANGES.map((r) => (
                  <td>{r}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Armour</th>
                {SHEET_LOCATIONS.map((l) => (
                  <td>{sheet.armour[l]}</td>
                ))}
                <td rowSpan={2} class="pb-injury">
                  /
                </td>
              </tr>
              <tr>
                <th scope="row">Injury Lvl</th>
                {SHEET_LOCATIONS.map((_, i) => (
                  <td class={i % 2 ? "pb-shade" : undefined} />
                ))}
              </tr>
            </tbody>
          </table>

          <table class="pb-table pb-firearm">
            <thead>
              <tr>
                {FIREARM_HEADS.map((h) => (
                  <th scope="col">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {firearms.map((f) => (
                <tr>
                  <td class="pb-wname">{f?.name}</td>
                  <td>{f?.type}</td>
                  <td>{f?.rng}</td>
                  <td>{f?.mode}</td>
                  <td>{f?.acc}</td>
                  <td>{f?.damage}</td>
                  <td>{f?.shots}</td>
                  <td>{f?.rld}</td>
                  <td>{f?.enc}</td>
                  <td class="pb-nowrap">/ {f?.reloads}</td>
                  <td class="pb-special">{f?.special}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div class="pb-bottom">
            <table class="pb-table pb-melee">
              <thead>
                <tr>
                  {MELEE_HEADS.map((h) => (
                    <th scope="col">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {melee.map((m) => (
                  <tr>
                    <td class="pb-wname">{m?.name}</td>
                    <td>{m?.rch}</td>
                    <td>{m?.dam}</td>
                    <td>{m?.pp}</td>
                    <td class="pb-special">{m?.special}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div class="pb-other">
              <div class="pb-th">Other Equipment/Bionics/Etc</div>
              <ul>
                {sheet.other.map((o) => (
                  <li>{o}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <aside class="pb-notes">
          <div class="pb-th">Game Notes</div>
          <ul>
            {sheet.gameNotes.map((n) => (
              <li>{n}</li>
            ))}
          </ul>
        </aside>
      </div>
    </article>
  );
}

/** Every character's block, in order: three fit a page; a taller block moves to the next page whole. */
export function PrintSheets({ sheets }: { sheets: SheetCharacter[] }) {
  return (
    <div class="pb-paper">
      {sheets.map((s) => (
        <PrintBlock sheet={s} />
      ))}
    </div>
  );
}
