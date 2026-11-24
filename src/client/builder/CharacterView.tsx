// One character, as the 2023 site showed it: a card with the name line, then
// sections (Occupation, Stats, Talents, Boons, the rest of what the
// character has, what built it), and below it the GM's sheet. With `edit`
// every part is editable; without, it's the read-only view of a share link.
import { BookOpen, Dices, Info, TriangleAlert } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { BuildResult, Owned } from "../../shared/engine/build.ts";
import { cloneRecord, type CharacterRecord, type ThingKind } from "../../shared/engine/record.ts";
import type { Compendium } from "../../shared/rules/compendium.ts";
import { STATS, type Stat } from "../../shared/rules/schema.ts";
import { sheetParts } from "../../shared/sheet-map.ts";
import { InlineInput, NameLine, Sheet, type SheetEdits } from "../sheet/Sheet.tsx";
import { abilityText } from "./ability-text.ts";
import { Decisions, Pending } from "./Decisions.tsx";
import { ICON, IconButton } from "./Icon.tsx";
import { L, T } from "./labels.ts";
import { archetypeName } from "./NewCharacter.tsx";
import { choiceOptions, view } from "./ops.ts";

export type ViewEdits = SheetEdits & {
  reroll(key: string | string[]): void;
  change(key: string): void;
  choose(key: string, ids: string[]): void;
  randomFill(keys?: string[]): void;
  /** A new random build of this character as another archetype/subtype. */
  rebuild(archetype: string, subtype: string): void;
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

const BOON = /^(.*\/boons)(#\d+|:count)$/;
const fromBoons = (t: Owned) => t.from.some((o) => !!o.key && BOON.test(o.key.split(">")[0]));

/** A section of the card: its title (and a button), then the content. */
function Section(p: { title?: string; action?: ComponentChildren; wide?: boolean; children: ComponentChildren; class?: string }) {
  return (
    <section class={`csec${p.wide ? " wide" : ""}${p.class ? ` ${p.class}` : ""}`}>
      {(p.title || p.action) && (
        <h3 class="csec-title">
          <span>{p.title}</span>
          {p.action}
        </h3>
      )}
      {p.children}
    </section>
  );
}

function Things({ c, list }: { c: Compendium; list: Owned[] }) {
  return (
    <ul class="csec-list">
      {list.map((t) => {
        const v = t.variants?.flat().filter(Boolean) ?? [];
        const text = abilityText(c, t.kind, t.id, v);
        return (
          <li>
            <b>{t.name}</b>
            {v.length > 0 && ` (${v.join(", ")})`}
            {text && <>: {text}</>}
          </li>
        );
      })}
    </ul>
  );
}

/** Archetype, Subtype, and the archetype's own picks (an Inquisitor's Belief Faction…). */
function Occupation({ c, record, built, edit }: { c: Compendium; record: CharacterRecord; built: BuildResult; edit?: ViewEdits }) {
  const ch = built.character;
  const archetypes = useMemo(() => [...c.archetypes.values()].sort((a, b) => a.source.page - b.source.page || a.name.localeCompare(b.name)), [c]);
  const arch = c.archetypes.get(ch.archetype.id);
  const picks = useMemo(() => {
    if (!edit) return [];
    const out: { key: string; label: string; options: { id: string; label: string }[]; value: string }[] = [];
    for (const e of built.log) {
      if (e.type !== "choice" || e.parent || !e.key.startsWith(`${ch.archetype.id}/`)) continue;
      const p = choiceOptions(c, record, e.key);
      if (!p || p.kind !== "pick" || p.count !== 1 || p.options.length < 2) continue;
      // A pick named only by the archetype (its role: an Inquisitor's belief faction…) is the old site's "Role".
      const label = e.label === arch?.name || e.label === ch.archetype.name ? T.role : e.label;
      out.push({ key: e.key, label, options: p.options, value: record.choices[e.key]?.[0] ?? "" });
    }
    return out;
  }, [c, record, built, !!edit]);
  const row = (label: string, control: ComponentChildren) => (
    <div class="occ-row">
      <span class="occ-label">{label}</span>
      {control}
    </div>
  );
  return (
    <Section title={T.occupation}>
      <div class="occ">
        {row(
          T.archetype,
          edit ? (
            <select class="occ-select" aria-label={T.archetype} value={ch.archetype.id} onChange={(e) => edit.rebuild(e.currentTarget.value, c.archetypes.get(e.currentTarget.value)?.subtypes[0]?.id ?? "")}>
              {archetypes.map((a) => (
                <option value={a.id}>
                  {archetypeName(a)}
                  {a.gmApproval ? "*" : ""}
                </option>
              ))}
            </select>
          ) : (
            <span>{ch.archetype.name}</span>
          ),
        )}
        {(arch?.subtypes.length ?? 0) > 1 &&
          row(
            T.subtype,
            edit ? (
              <select class="occ-select" aria-label={T.subtype} value={ch.subtype.id} onChange={(e) => edit.rebuild(ch.archetype.id, e.currentTarget.value)}>
                {arch!.subtypes.map((s) => (
                  <option value={s.id}>{s.name}</option>
                ))}
              </select>
            ) : (
              <span>{ch.subtype.name}</span>
            ),
          )}
        {picks.map((p) =>
          row(
            p.label,
            <select class="occ-select" aria-label={p.label} value={p.value} onChange={(e) => edit!.choose(p.key, [e.currentTarget.value])}>
              {!p.value && <option value="">–</option>}
              {p.options.map((o) => (
                <option value={o.id}>{o.label || "–"}</option>
              ))}
            </select>,
          ),
        )}
        {!edit && ch.options.length > 0 && row(T.role, <span>{ch.options.map((o) => o.name).join(", ")}</span>)}
      </div>
    </Section>
  );
}

/** Base (the roll; tap to change), Boon (everything added to it), Total. */
function Stats({ built, edit }: { built: BuildResult; edit?: ViewEdits }) {
  const ch = built.character;
  const [editing, setEditing] = useState<Stat | null>(null);
  const keys = built.log.filter((e) => e.type === "dice" && /\/@stats:/.test(e.key)).map((e) => e.key);
  return (
    <Section
      title={T.stats}
      action={
        edit &&
        keys.length > 0 && (
          <button type="button" class="text-btn" onClick={() => edit.reroll(keys)}>
            {T.reroll}
          </button>
        )
      }
    >
      <table class="cstats">
        <colgroup>
          <col class="cstats-stat" />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th />
            <th scope="col">{T.base}</th>
            <th scope="col">{T.boon}</th>
            <th scope="col">{T.total}</th>
          </tr>
        </thead>
        <tbody>
          {STATS.map((s) => {
            const line = ch.stats[s];
            const boon = line.modified - line.base;
            return (
              <tr class={line.overridden ? "ovr" : undefined}>
                <th scope="row">{s}</th>
                <td class="cstats-base">
                  {edit && editing === s ? (
                    <InlineInput
                      value={String(line.base)}
                      type="number"
                      label={`${T.base} ${s}`}
                      onDone={(v) => {
                        setEditing(null);
                        if (v === null || v.trim() === "") return;
                        const n = Math.round(Number(v));
                        if (Number.isFinite(n) && n !== line.base) edit.stat(s, n + boon);
                      }}
                    />
                  ) : edit ? (
                    <button type="button" class="cstats-edit" aria-label={`${T.base} ${s} ${line.base}`} title={`${T.base} ${s}`} onClick={() => setEditing(s)}>
                      {line.base}
                    </button>
                  ) : (
                    line.base
                  )}
                </td>
                <td>{boon ? (boon > 0 ? `+${boon}` : `−${-boon}`) : "-"}</td>
                <td class="cstats-total">{line.final}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

/** The boons rolled (each with what it gave), as the 2023 site listed them. */
function Boons({ c, built, edit }: { c: Compendium; built: BuildResult; edit?: ViewEdits }) {
  const ch = built.character;
  const tops = built.log.filter((e) => BOON.test(e.key) && e.key.includes("#"));
  if (!tops.length) return null;
  const keys = built.log.filter((e) => BOON.test(e.key.split(">")[0])).map((e) => e.key).filter((k) => !k.includes(">"));
  const things = [...ch.talents, ...ch.exotics, ...ch.mutations, ...ch.powers, ...ch.items];
  return (
    <Section
      title={T.boons}
      action={
        edit && (
          <button type="button" class="text-btn" onClick={() => edit.reroll(keys)}>
            {T.reroll}
          </button>
        )
      }
    >
      <ul class="csec-list">
        {tops.map((e) => {
          const got = things.filter((t) => t.from.some((o) => o.key === e.key || o.key?.startsWith(`${e.key}>`)));
          const inner = built.log.filter((x) => x.parent === e.key && x.type === "dice").flatMap((x) => x.result);
          const label = [e.result.join(", "), ...inner].filter(Boolean).join(": ");
          return (
            <li>
              {got.length ? (
                got.map((t) => {
                  const text = abilityText(c, t.kind, t.id, t.variants?.flat().filter(Boolean) ?? []);
                  return (
                    <span class="boon-thing">
                      <b>{t.name}</b>
                      {text && <>: {text}</>}
                    </span>
                  );
                })
              ) : (
                <b>{label}</b>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function CharacterView({
  c,
  record,
  built,
  edit,
  balance,
  footer,
}: {
  c: Compendium;
  record: CharacterRecord;
  built: BuildResult;
  edit?: ViewEdits;
  /** The balance label, under the name line. */
  balance?: ComponentChildren;
  /** The card's footer (Download Docx). */
  footer?: ComponentChildren;
}) {
  const ch = built.character;
  const parts = useMemo(() => sheetParts(ch, c), [ch, c]);
  const hints = useMemo(() => (edit ? optionalHints(c, record, built) : new Map<string, string>()), [c, record, built, !!edit]);
  const [showSource, setShowSource] = useState(false);
  const [showRolls, setShowRolls] = useState(false);
  const arch = c.archetypes.get(ch.archetype.id);
  const prose = ch.notes.filter((n) => n.kind !== "gameplay");
  const talents = ch.talents.filter((t) => !fromBoons(t));
  const items = ch.items;
  // A roll that came to nothing to choose from ("Heavy weapon (Common)"): shown, so the GM sees it happened.
  const empty = ch.empty ?? [];

  return (
    <div class="char-view">
      <article class="ccard">
        <header class="ccard-head">
          <NameLine parts={parts} character={ch} edit={edit} />
          {arch?.gmApproval && <p class="gm-approval">{T.gmApproval}</p>}
          {balance && <div class="balance-line">{balance}</div>}
        </header>

        <div class="ccard-inner">
          {edit && built.pending.length > 0 && (
            <Section wide class="csec-pending">
              <Pending pending={built.pending} hints={hints} edit={edit} />
            </Section>
          )}
          <Occupation c={c} record={record} built={built} edit={edit} />
          <Stats built={built} edit={edit} />
          {talents.length > 0 && (
            <Section title={T.talents}>
              <Things c={c} list={talents} />
            </Section>
          )}
          <Boons c={c} built={built} edit={edit} />
          {ch.exotics.filter((t) => !fromBoons(t)).length > 0 && (
            <Section title={arch?.sections.find((s) => /exotic/i.test(s.name))?.name ?? "Exotic Abilities"}>
              <Things c={c} list={ch.exotics.filter((t) => !fromBoons(t))} />
            </Section>
          )}
          {ch.powers.length > 0 && (
            <Section title={arch?.sections.find((s) => /psychic/i.test(s.name))?.name ?? "Psychic Abilities"}>
              <Things c={c} list={ch.powers} />
            </Section>
          )}
          {ch.mutations.length > 0 && (
            <Section title="Mutations">
              <Things c={c} list={ch.mutations} />
            </Section>
          )}
          {items.length + empty.length > 0 && (
            <Section title="Equipment">
              <ul class="csec-list">
                {items.map((t) => {
                  const v = t.variants?.flat().filter(Boolean) ?? [];
                  return (
                    <li>
                      <b>{t.name}</b>
                      {v.length > 0 && ` (${v.join(", ")})`}
                      {t.qty > 1 && ` ×${t.qty}`}
                    </li>
                  );
                })}
                {empty.map((e) => (
                  <li class="empty-result">
                    <b>{e.name}</b>
                    {e.variants.length > 0 && ` (${e.variants.join(", ")})`}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section wide class={`csec-log${showRolls ? "" : " collapsed"}`}>
            <IconButton label={L.rolls} pressed={showRolls} onClick={() => setShowRolls(!showRolls)}>
              <Dices size={ICON} />
            </IconButton>
            {showRolls && <Decisions log={built.log} rolls={ch.rolls} record={record} edit={edit} alias={arch ? { [arch.name]: ch.archetype.name } : undefined} />}
          </Section>

          {prose.length > 0 && (
            <Section wide>
              <ul class="csec-list notes">
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
            </Section>
          )}

          {arch?.source.text && (
            <Section wide class="csec-source">
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
            </Section>
          )}
        </div>
        {footer && <footer class="ccard-foot">{footer}</footer>}
      </article>

      <div class="char-sheet">
        <Sheet parts={parts} character={ch} edit={edit} hideName />
      </div>
    </div>
  );
}

