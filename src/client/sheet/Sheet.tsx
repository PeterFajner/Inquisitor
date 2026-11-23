// The GM's sheet on screen (data/source/BETTER_3_CHARACTERSPER_PAGE.doc):
// one block, laid out as the sheet's tables, filled from SheetParts
// (src/shared/sheet-map.ts). Editable, it is the builder: tap a value to
// override it, the name to rename, the alignment to change it; icons add
// and remove abilities and equipment. Overridden values carry a mark.
// Read-only (share links), it is the sheet alone.
import { Plus, RotateCcw, X } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Character } from "../../shared/engine/build.ts";
import type { SheetParts, SheetRef } from "../../shared/sheet-map.ts";
import { SHEET_LOCATIONS, SHEET_STATS, type SheetStat } from "../../shared/sheet.ts";
import { ALIGNMENTS, STATS, type Alignment, type Stat } from "../../shared/rules/schema.ts";
import { ICON_SM, IconButton } from "../builder/Icon.tsx";
import { L, T } from "../builder/labels.ts";
import "./sheet.css";

export type SheetEdits = {
  rename(name: string): void;
  stat(stat: Stat, value: number | null): void;
  alignment(value: Alignment | null): void;
  remove(ref: SheetRef): void;
  /** Opens the picker for abilities (talents, exotic abilities, mutations, powers) or equipment. */
  add(what: "abilities" | "items"): void;
};

type Props = {
  parts: SheetParts;
  character: Character;
  /** Absent: read-only. */
  edit?: SheetEdits;
  /** The name line is shown elsewhere (the builder's card). */
  hideName?: boolean;
};

// The Location table's hit ranges (the sheet's own small print).
const RANGES = ["1 - 15", "16 - 30", "31-35", "36-50", "51-65", "66-80", "81-95", "96-00"];
const BASE: readonly string[] = STATS;
const DERIVED = SHEET_STATS.filter((s) => !BASE.includes(s));

function Mark() {
  return <span class="ovr-mark" role="img" aria-label={L.overridden} title={L.overridden} />;
}

/** The name line: the name (an input, as the 2023 site's) and the tag line
 * "(Archetype, Subtype, Role, Alignment)", the alignment a one-tap select. */
export function NameLine({ parts, character, edit }: Pick<Props, "parts" | "character" | "edit">) {
  const { sheet } = parts;
  const align = character.alignment;
  const pieces = sheet.tagLine ? sheet.tagLine.split(", ") : [];
  const lead = align && pieces[pieces.length - 1] === align ? pieces.slice(0, -1) : pieces;

  const nameEl = edit ? (
    <input
      key={sheet.name}
      class="sheet-name-input"
      aria-label={L.rename}
      placeholder={T.characterName}
      defaultValue={sheet.name}
      maxLength={200}
      size={Math.max(T.characterName.length, sheet.name.length) + 1}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = sheet.name;
          e.currentTarget.blur();
        }
      }}
      onInput={(e) => (e.currentTarget.size = Math.max(T.characterName.length, e.currentTarget.value.length) + 1)}
      onBlur={(e) => {
        const v = e.currentTarget.value.trim();
        if (v !== sheet.name) edit.rename(v);
      }}
    />
  ) : (
    sheet.name
  );

  // A real select, styled as the tag line's word: one tap opens it.
  const alignEl = edit ? (
    <span class="sheet-align">
      <select
        class="sheet-align-select"
        aria-label={L.alignment}
        title={L.alignment}
        value={align ?? ""}
        onChange={(e) => {
          const v = e.currentTarget.value;
          edit.alignment(v === "" ? null : (v as Alignment));
        }}
      >
        {!align && <option value="">–</option>}
        {character.overridden.alignment && <option value="">↺</option>}
        {ALIGNMENTS.map((a) => (
          <option value={a}>{a}</option>
        ))}
      </select>
      {character.overridden.alignment && <Mark />}
    </span>
  ) : (
    align
  );

  return (
    <h2 class="sheet-nameline">
      <span class="sheet-name">{nameEl}</span>
      {(lead.length > 0 || alignEl) && (
        <span class="sheet-tag">
          {" ("}
          {lead.join(", ")}
          {alignEl && (lead.length ? ", " : "")}
          {alignEl}
          {")"}
        </span>
      )}
    </h2>
  );
}

export function InlineInput(p: { value: string; label: string; type?: "text" | "number"; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    p.onDone(v);
  };
  return (
    <input
      ref={ref}
      class={`sheet-input${p.type === "number" ? " num" : ""}`}
      type="text"
      inputMode={p.type === "number" ? "numeric" : undefined}
      pattern={p.type === "number" ? "-?[0-9]*" : undefined}
      aria-label={p.label}
      title={p.label}
      defaultValue={p.value}
      maxLength={200}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function StatCell({ stat, value, character, edit }: { stat: SheetStat; value: string; character: Character; edit?: SheetEdits }) {
  const [editing, setEditing] = useState(false);
  const base = (BASE as string[]).includes(stat) ? (stat as Stat) : null;
  const line = base ? character.stats[base] : null;
  if (!edit || !base || !line) return <td class={line?.overridden ? "ovr" : undefined}>{value}</td>;
  if (editing)
    return (
      <td class="editing">
        <InlineInput
          value={value}
          type="number"
          label={stat}
          onDone={(v) => {
            setEditing(false);
            if (v === null || v.trim() === "") return;
            const n = Math.round(Number(v));
            if (Number.isFinite(n) && String(n) !== value) edit.stat(base, n);
          }}
        />
      </td>
    );
  return (
    <td class={line.overridden ? "ovr" : undefined}>
      <button type="button" class="cell-btn" aria-label={`${stat} ${value}`} title={`${stat} ${value}`} onClick={() => setEditing(true)}>
        {value}
      </button>
      {line.overridden && (
        <button type="button" class="restore" aria-label={`${L.restore}: ${stat} ${line.modified}`} title={`${L.restore}: ${stat} ${line.modified}`} onClick={() => edit.stat(base, null)}>
          <RotateCcw size={12} />
        </button>
      )}
    </td>
  );
}

function StatTable({ stats, parts, character, edit, cls }: Props & { stats: readonly SheetStat[]; cls: string }) {
  return (
    <table class={`sheet-table sheet-stats ${cls}`}>
      <thead>
        <tr>
          <th />
          {stats.map((s) => (
            <th scope="col">{s}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Starting</th>
          {stats.map((s) => (
            <StatCell stat={s} value={parts.sheet.starting[s]} character={character} edit={edit} />
          ))}
        </tr>
        {["Progress", "Current"].map((row) => (
          <tr>
            <th scope="row">{row}</th>
            {stats.map((s) => (
              <td class={DERIVED.includes(s) ? "shade" : undefined} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Remove({ r, name, edit }: { r: SheetRef; name: string; edit?: SheetEdits }) {
  if (!edit || r.fixed) return r.overridden ? <Mark /> : null;
  return (
    <>
      {r.overridden && <Mark />}
      <button type="button" class="line-x" aria-label={`${L.take}: ${name}`} title={`${L.take}: ${name}`} onClick={() => edit.remove(r)}>
        <X size={14} />
      </button>
    </>
  );
}

function AddBtn({ what, edit }: { what: "abilities" | "items"; edit?: SheetEdits }) {
  if (!edit) return null;
  return (
    <IconButton small class="sheet-add" label={L.add} onClick={() => edit.add(what)}>
      <Plus size={ICON_SM} />
    </IconButton>
  );
}

/** A table that may be wider than the screen: a focusable scroll box whose
 * edges fade while there's more to see that way. */
function ScrollX({ label, children }: { label: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, []);
  const scrolls = more.left || more.right;
  return (
    <div class={`scroll-wrap${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`}>
      <div class="scroll-x" ref={ref} tabIndex={scrolls ? 0 : undefined} role={scrolls ? "region" : undefined} aria-label={scrolls ? label : undefined}>
        {children}
      </div>
    </div>
  );
}

export function Sheet(props: Props) {
  const { parts, character, edit } = props;
  const { sheet, refs } = parts;
  const firearms = sheet.firearms.length ? sheet.firearms : [null];
  const melee = sheet.melee.length ? sheet.melee : [null];
  return (
    <article class={`sheet${edit ? " sheet-edit" : ""}`}>
      {!props.hideName && <NameLine {...props} />}
      <div class="sheet-grid">
        <div class="sheet-main">
          <StatTable {...props} stats={SHEET_STATS} cls="stats-wide" />
          <StatTable {...props} stats={BASE as SheetStat[]} cls="stats-narrow" />
          <StatTable {...props} stats={DERIVED} cls="stats-narrow" />

          <div class="sheet-abilities">
            <span class="sheet-label">Abilities:</span>
            <AddBtn what="abilities" edit={edit} />
            <ul>
              {sheet.abilities.map((a, i) => (
                <li class={refs.abilities[i]?.overridden ? "ovr" : undefined}>
                  <b class="ability-name">{a.name}</b>
                  {a.effect && <span class="ability-effect"> ({a.effect})</span>}
                  <Remove r={refs.abilities[i]} name={a.name} edit={edit} />
                </li>
              ))}
            </ul>
          </div>

          <ScrollX label="Location">
            <table class="sheet-table sheet-loc">
              <thead>
                <tr>
                  <th scope="col">Location</th>
                  {SHEET_LOCATIONS.map((l) => (
                    <th scope="col">{l}</th>
                  ))}
                  <th scope="col" rowSpan={2}>
                    Injury Total
                  </th>
                </tr>
                <tr class="ranges">
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
                  <td rowSpan={2} class="injury-total">
                    /
                  </td>
                </tr>
                <tr>
                  <th scope="row">Injury Lvl</th>
                  {SHEET_LOCATIONS.map((_, i) => (
                    <td class={i % 2 ? "shade" : undefined} />
                  ))}
                </tr>
              </tbody>
            </table>
          </ScrollX>

          <ScrollX label="Firearm">
            <table class="sheet-table sheet-firearm">
              <thead>
                <tr>
                  {["Firearm", "Type", "Rng", "Mode", "Acc", "Damage", "Shots", "Rld", "Enc", "# Rld", "Special"].map((h) => (
                    <th scope="col">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {firearms.map((f, i) => (
                  <tr class={f && refs.firearms[i]?.overridden ? "ovr" : undefined}>
                    <td class="wname">
                      {f?.name}
                      {f && <Remove r={refs.firearms[i]} name={f.name} edit={edit} />}
                    </td>
                    <td>{f?.type}</td>
                    <td>{f?.rng}</td>
                    <td>{f?.mode}</td>
                    <td>{f?.acc}</td>
                    <td>{f?.damage}</td>
                    <td>{f?.shots}</td>
                    <td>{f?.rld}</td>
                    <td>{f?.enc}</td>
                    <td class="nowrap">/ {f?.reloads}</td>
                    <td class="special">{f?.special}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>

          <div class="sheet-bottom">
            <ScrollX label="Melee">
              <table class="sheet-table sheet-melee">
                <thead>
                  <tr>
                    {["Melee", "Rch", "Dam", "PP", "Special"].map((h) => (
                      <th scope="col">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {melee.map((m, i) => (
                    <tr class={m && refs.melee[i]?.overridden ? "ovr" : undefined}>
                      <td class="wname">
                        {m?.name}
                        {m && <Remove r={refs.melee[i]} name={m.name} edit={edit} />}
                      </td>
                      <td>{m?.rch}</td>
                      <td>{m?.dam}</td>
                      <td>{m?.pp}</td>
                      <td class="special">{m?.special}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
            <div class="sheet-other">
              <div class="sheet-th">
                Other Equipment/Bionics/Etc
                <AddBtn what="items" edit={edit} />
              </div>
              <ul>
                {sheet.other.map((o, i) => (
                  <li class={refs.other[i]?.overridden ? "ovr" : undefined}>
                    {o}
                    <Remove r={refs.other[i]} name={o} edit={edit} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <aside class="sheet-notes">
          <div class="sheet-th">Game Notes</div>
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
