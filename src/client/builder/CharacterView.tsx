// One character: the sheet, and beside it what built it (open choices, the
// engine's log), the options chosen, the table results (boons...) and the
// book's prose for the character. With `edit` every part is editable;
// without, it's the read-only view of a share link.
import { BookOpen, Info, TriangleAlert } from "lucide-preact";
import { useMemo, useState } from "preact/hooks";
import type { BuildResult } from "../../shared/engine/build.ts";
import { cloneRecord, type CharacterRecord } from "../../shared/engine/record.ts";
import type { Compendium } from "../../shared/rules/compendium.ts";
import { sheetParts } from "../../shared/sheet-map.ts";
import { Sheet, type SheetEdits } from "../sheet/Sheet.tsx";
import { Decisions, Pending } from "./Decisions.tsx";
import { ICON, IconButton } from "./Icon.tsx";
import { L } from "./labels.ts";
import { view } from "./ops.ts";

export type ViewEdits = SheetEdits & {
  reroll(key: string): void;
  change(key: string): void;
  choose(key: string, ids: string[]): void;
  randomFill(keys?: string[]): void;
};

/** What an optional with no label of its own opens: the options of the choice behind it. */
function optionalHints(c: Compendium, rec: CharacterRecord, built: BuildResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of built.pending) {
    if (p.kind !== "optional" || p.options.find((o) => o.id === "yes")?.label) continue;
    const r = cloneRecord(rec);
    r.choices[p.key] = ["yes"];
    try {
      const after = view(c, r);
      const inner = after.pending.filter((x) => x.parent === p.key).flatMap((x) => x.options.map((o) => o.label));
      const names = (ch: BuildResult["character"]) =>
        [...ch.talents, ...ch.exotics, ...ch.mutations, ...ch.powers, ...ch.items].map((t) => `${t.kind}/${t.id}`);
      const had = new Set(names(built.character));
      const all = [...after.character.talents, ...after.character.exotics, ...after.character.mutations, ...after.character.powers, ...after.character.items];
      const things = all.filter((t) => !had.has(`${t.kind}/${t.id}`)).map((t) => t.name);
      const hint = [...inner, ...things].filter(Boolean).join(" / ");
      if (hint) out.set(p.key, hint);
    } catch {}
  }
  return out;
}

/** The book's name of an entry by id (notes name the entry they came from). */
function entryName(c: Compendium, id: string): string {
  for (const m of [c.items, c.talents, c.exotics, c.mutations, c.powers, c.tables, c.archetypes] as Map<string, { name: string }>[]) {
    const e = m.get(id);
    if (e) return e.name;
  }
  return "";
}

export function CharacterView({ c, record, built, edit }: { c: Compendium; record: CharacterRecord; built: BuildResult; edit?: ViewEdits }) {
  const ch = built.character;
  const parts = useMemo(() => sheetParts(ch, c), [ch, c]);
  const hints = useMemo(() => (edit ? optionalHints(c, record, built) : new Map<string, string>()), [c, record, built, !!edit]);
  const [showSource, setShowSource] = useState(false);
  const arch = c.archetypes.get(ch.archetype.id);

  const rollsByTable = useMemo(() => {
    const m = new Map<string, { label: string; lost?: boolean }[]>();
    for (const r of ch.rolls) {
      const name = c.tables.get(r.table)?.name ?? r.table;
      const list = m.get(name) ?? [];
      list.push({ label: r.availability ? `${r.availability} ${r.label}` : r.label, lost: r.lost });
      m.set(name, list);
    }
    return [...m.entries()];
  }, [ch, c]);

  const prose = ch.notes.filter((n) => n.kind !== "gameplay");

  return (
    <div class="char-view">
      <div class="char-sheet">
        <Sheet parts={parts} character={ch} edit={edit} />
      </div>
      <aside class="char-side">
        {edit && built.pending.length > 0 && <Pending pending={built.pending} hints={hints} edit={edit} />}

        {ch.options.length > 0 && (
          <ul class="side-block options">
            {ch.options.map((o) => (
              <li>
                <b>{o.name}</b>
                {o.text && <span class="b-prose"> {o.text}</span>}
              </li>
            ))}
          </ul>
        )}

        {rollsByTable.length > 0 && (
          <dl class="side-block rolls">
            {rollsByTable.map(([table, rows]) => (
              <div class="rolls-row">
                <dt>{table}</dt>
                <dd>
                  {rows.map((r, i) => (
                    <>
                      {i > 0 && ", "}
                      <span class={r.lost ? "lost" : undefined}>{r.label}</span>
                    </>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <Decisions log={built.log} record={record} edit={edit} />

        {prose.length > 0 && (
          <ul class="side-block notes">
            {prose.map((n) => (
              <li class={`b-note note-${n.kind}`}>
                {n.kind === "unfit" ? (
                  <TriangleAlert size={14} class="note-icon" aria-label={L.unfit} />
                ) : (
                  <Info size={14} class="note-icon" aria-label={L.gm} />
                )}
                {(n.section || entryName(c, n.source)) && <b>{n.section || entryName(c, n.source)}: </b>}
                {n.text}
              </li>
            ))}
          </ul>
        )}

        {arch?.source.text && (
          <div class="side-block source">
            <IconButton label={L.source} pressed={showSource} onClick={() => setShowSource(!showSource)}>
              <BookOpen size={ICON} />
            </IconButton>
            {showSource && (
              <blockquote class="source-text">
                <b>{arch.name}</b>
                {"\n"}
                {arch.source.text}
              </blockquote>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
