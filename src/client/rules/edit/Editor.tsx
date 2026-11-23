// The editor: the selected card with its chips as editable controls, in a
// panel beside the canvas (a sheet over it on a phone). Every change is
// checked against the rules schema in the browser; saving sends the entry
// with the commit it was based on. A save against a stale base comes back
// with the newer version: it shows next to mine, field by field (keep
// theirs, keep mine, or re-apply my changes to theirs). Deleting asks twice.
import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import {
  ArrowDown, ArrowUp, Asterisk, BookOpen, Check, Coins, Dices, GitMerge, Hash, Layers, ListPlus, Package, Plus, Quote, RotateCcw, Tag, Trash2, TriangleAlert, UserRound,
  X,
} from "lucide-preact";
import type { EntryMeta, RulesIssue } from "../../../shared/api.ts";
import { AVAILABILITIES, Entry as EntrySchema, STATS, type Effect, type Entry } from "../../../shared/rules/schema.ts";
import { walkEffects, effectLists } from "../../../shared/rules/compendium.ts";
import { useStore } from "../../lib/store.ts";
import { Body, StatsGrid } from "../Card.tsx";
import { Effects, KIND_ICON, KIND_LABEL } from "../chips/index.ts";
import { ctxOf, type Names, type RefKind } from "../ctx.ts";
import { conflictFields, fieldValue, merge, type Choice } from "../diff.ts";
import { L } from "../labels.ts";
import { deleteEntry, keyOf, rules, saveEntry, type Key } from "../model.ts";
import { blankStats, idsIn, kebab } from "./blank.ts";
import { BoolToggle, DiceInput, Fld, LongText, NumInput, TextInput } from "./controls.tsx";
import { EffectList, Fields, pathStr, setIn, type Ed, type Path } from "./effects.tsx";
import type { Field } from "./fields.ts";

export type EditTarget = { key: Key | null; pack: string; entry: Entry; base: string | null; isNew: boolean };

type Conflict = { theirs: Entry | null; meta: EntryMeta | null; original: Entry | null };

const ENTRY_FIELDS: Partial<Record<Entry["kind"], Field[]>> = {
  talent: [
    { at: ["group"], f: { k: "text" }, label: L.group, icon: Layers },
    { at: ["text"], f: { k: "long" }, label: L.text, icon: BookOpen, req: true },
  ],
  item: [
    { at: ["group"], f: { k: "text" }, label: L.group, icon: Layers, req: true },
    { at: ["category"], f: { k: "text" }, label: L.category, icon: Tag },
    { at: ["availability"], f: { k: "enum", of: AVAILABILITIES }, label: L.availability, icon: Coins },
    { at: ["product"], f: { k: "enum", of: ["Chaos", "Radical", "Xenos"] }, label: L.product, icon: Tag },
    { at: ["alien"], f: { k: "bool" }, label: L.alien, icon: Asterisk },
    { at: ["unrestricted"], f: { k: "bool" }, label: L.unrestricted, icon: Coins },
    { at: ["tags"], f: { k: "strings" }, label: L.tags, icon: Tag },
    { at: ["profile"], f: { k: "record" }, label: L.weapon, icon: Package },
    { at: ["profileWhen"], f: { k: "json" }, label: L.weapon, icon: Package },
    { at: ["availabilityWhen"], f: { k: "json" }, label: L.availability, icon: Coins },
    { at: ["requires"], f: { k: "json" }, label: L.if, icon: Tag },
    { at: ["text"], f: { k: "long" }, label: L.text, icon: BookOpen },
  ],
  table: [
    { at: ["die"], f: { k: "dice" }, label: L.die, icon: Dices, req: true },
    { at: ["columns"], f: { k: "strings" }, label: L.column, icon: Hash },
    { at: ["rerollDuplicates"], f: { k: "bool" }, label: L.random, icon: RotateCcw },
  ],
  rule: [
    { at: ["text"], f: { k: "long" }, label: L.text, icon: BookOpen, req: true },
    { at: ["apply"], f: { k: "json" }, label: L.effects, icon: Plus },
  ],
};
ENTRY_FIELDS.exotic = ENTRY_FIELDS.talent;
ENTRY_FIELDS.mutation = ENTRY_FIELDS.talent;
ENTRY_FIELDS.power = [
  { at: ["group"], f: { k: "text" }, label: L.group, icon: Layers },
  { at: ["difficulty"], f: { k: "dice" }, label: L.difficulty, icon: Hash },
  { at: ["text"], f: { k: "long" }, label: L.text, icon: BookOpen, req: true },
];

/** The entry as it will be saved: ids filled in from names where they were left empty. */
function prepared(e: Entry, autoId: boolean): Entry {
  let out = e;
  if (autoId) out = { ...out, id: kebab(out.name) };
  if (out.kind === "archetype") out = { ...out, subtypes: out.subtypes.map((s) => (s.id ? s : { ...s, id: kebab(s.name) })) };
  return out;
}

/** References to entries that don't exist (the picker only offers existing ones, but data may be old). */
function refProblems(e: Entry, names: Names): RulesIssue[] {
  const out: RulesIssue[] = [];
  const refs: RefKind[] = ["talent", "exotic", "item", "mutation", "power"];
  for (const { effects } of effectLists(e))
    walkEffects(effects, (x) => {
      for (const k of refs) {
        const v = (x as Record<string, unknown>)[k];
        if (typeof v === "string" && v && !names.has(k, v)) out.push({ path: "", message: `${k} ${v}` });
      }
      if ("roll" in x && x.roll && !names.has("table", x.roll)) out.push({ path: "", message: `table ${x.roll}` });
    });
  return out;
}

export function Editor(p: { target: EditTarget; names: Names; onClose: () => void; onSaved: (key: Key) => void }) {
  const { target, names } = p;
  const [draft, setDraft] = useState<Entry>(() => structuredClone(target.entry));
  const [base, setBase] = useState(target.base);
  const [original, setOriginal] = useState<Entry | null>(target.isNew ? null : target.entry);
  const [autoId, setAutoId] = useState(target.isNew);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<RulesIssue[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const s = useStore(rules);

  const out = useMemo(() => prepared(draft, autoId), [draft, autoId]);
  const issues = useMemo(() => {
    const m = new Map<string, string>();
    const r = EntrySchema.safeParse(out);
    if (!r.success) for (const i of r.error.issues) m.set(i.path.join("."), i.message);
    if (!out.id) m.set("id", "id");
    for (const i of serverIssues) m.set(i.path, i.message);
    for (const i of refProblems(out, names)) m.set(i.path, i.message);
    return m;
  }, [out, serverIssues, names]);
  const general = issues.get("") ?? null;

  const live = target.key ? s.items.get(target.key) : undefined;
  const newer = !!(target.key && live && live.meta?.commit && base && live.meta.commit !== base);

  const ctx = useMemo(() => ctxOf(draft, names), [draft, names]);
  const ed: Ed = {
    names,
    ctx,
    set: (path: Path, v: unknown) => {
      setDraft((d) => setIn(d, path, v));
      setServerIssues([]);
      setError(null);
    },
    issues,
    used: () => idsIn(draft),
    isOpen: (ps) => open.has(ps),
    toggle: (ps, force) =>
      setOpen((o) => {
        const n = new Set(o);
        if (force ?? !n.has(ps)) n.add(ps);
        else n.delete(ps);
        return n;
      }),
  };

  const save = async () => {
    if (issues.size || busy) return;
    setBusy(true);
    setError(null);
    const r = await saveEntry(target.pack, out, base);
    setBusy(false);
    if (r.ok) {
      p.onSaved(keyOf(target.pack, out.kind, out.id));
      return;
    }
    if ("conflict" in r) setConflict({ theirs: r.conflict.entry, meta: r.conflict.meta, original });
    else if ("invalid" in r) setServerIssues(r.invalid.length ? r.invalid : [{ path: "", message: "invalid" }]);
    else setError(r.error);
  };

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const r = await deleteEntry(target.pack, draft.kind, draft.id, base);
    setBusy(false);
    setConfirmDelete(false);
    if (r.ok) return p.onClose();
    if ("conflict" in r) setConflict({ theirs: r.conflict.entry, meta: r.conflict.meta, original });
    else if ("invalid" in r) setServerIssues(r.invalid);
    else setError(r.error);
  };

  const KindIcon = KIND_ICON[draft.kind];
  const bad = (k: string) => [...issues.keys()].some((x) => x === k || x.startsWith(`${k}.`));

  return (
    <aside class="rules-panel editor" aria-modal="false" aria-label={`${L.edit}: ${KIND_LABEL[draft.kind]}`}>
      <header class="panel-head">
        <span class="kind-ic" role="img" aria-label={KIND_LABEL[draft.kind]} title={KIND_LABEL[draft.kind]}>
          <KindIcon size={18} aria-hidden="true" />
        </span>
        <input
          class={`in grow name-in${bad("name") ? " bad" : ""}`}
          aria-label={L.name}
          value={draft.name}
          onInput={(e) => ed.set(["name"], (e.currentTarget as HTMLInputElement).value)}
        />
        {(newer || conflict) && (
          <span class="bad-mark" role="img" aria-label={L.newer} title={L.newer}>
            <GitMerge size={16} aria-hidden="true" />
          </span>
        )}
        {(general || error) && (
          <span class="bad-mark" role="img" aria-label={`${L.error}: ${general ?? error}`} title={general ?? error ?? ""}>
            <TriangleAlert size={16} aria-hidden="true" />
          </span>
        )}
        <button type="button" class="icon-btn save" aria-label={L.save} title={L.save} disabled={busy || issues.size > 0 || !!conflict} aria-busy={busy} onClick={save}>
          <Check size={20} aria-hidden="true" />
        </button>
        {!target.isNew && (
          <button
            type="button"
            class={`icon-btn${confirmDelete ? " danger" : ""}`}
            aria-label={confirmDelete ? L.confirmRemove : L.remove}
            title={confirmDelete ? L.confirmRemove : L.remove}
            disabled={busy}
            onClick={remove}
            onBlur={() => setConfirmDelete(false)}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        )}
        <button type="button" class="icon-btn" aria-label={L.cancel} title={L.cancel} onClick={p.onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div class="panel-body">
        {conflict && (
          <ConflictView
            conflict={conflict}
            mine={draft}
            names={names}
            onResolve={(merged) => {
              setDraft(merged);
              setBase(conflict.meta?.commit ?? null);
              setOriginal(conflict.theirs);
              setConflict(null);
            }}
          />
        )}
        <div class="fld-row">
          {/* the id is the rules' own key, not the book's words: only asked for a new entry */}
          {target.isNew && (
            <Fld icon={Hash} label={L.id} invalid={bad("id")}>
              <TextInput
                label={L.id}
                req
                class="mono"
                value={out.id}
                set={(v) => {
                  setAutoId(!v);
                  ed.set(["id"], v ?? "");
                }}
              />
            </Fld>
          )}
          <Fld icon={BookOpen} label={L.page} invalid={bad("source.page")}>
            <NumInput label={L.page} int req value={draft.source.page} set={(v) => ed.set(["source", "page"], v)} />
          </Fld>
          <Fld icon={Coins} label={L.points} invalid={bad("points")}>
            <NumInput label={L.points} value={draft.points} set={(v) => ed.set(["points"], v)} />
          </Fld>
        </div>
        {draft.kind === "archetype" ? (
          <ArchetypeFields d={draft} ed={ed} bad={bad} />
        ) : (
          <>
            {ENTRY_FIELDS[draft.kind] && <Fields fields={ENTRY_FIELDS[draft.kind]!} value={draft} path={[]} ed={ed} />}
            {draft.kind === "table" ? (
              <RowsEditor d={draft} ed={ed} />
            ) : (
              <div class="fld-block">
                <span class="fld-ic" role="img" aria-label={L.effects} title={L.effects}>
                  <Plus size={14} aria-hidden="true" />
                </span>
                <EffectList effects={(draft as { effects?: Effect[] }).effects} path={["effects"]} ed={ed} />
              </div>
            )}
          </>
        )}
        <Fld icon={Quote} label={L.quote} wide>
          <LongText label={L.quote} value={draft.source.text} set={(v) => ed.set(["source", "text"], v)} />
        </Fld>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Archetypes: flags, the stat table, the sections
// ---------------------------------------------------------------------------

function Tools(p: { onUp?: () => void; onDown?: () => void; onRemove?: () => void }) {
  return (
    <span class="ed-tools">
      <button type="button" class="icon-btn icon-xs" aria-label={L.up} title={L.up} disabled={!p.onUp} onClick={p.onUp}>
        <ArrowUp size={14} aria-hidden="true" />
      </button>
      <button type="button" class="icon-btn icon-xs" aria-label={L.down} title={L.down} disabled={!p.onDown} onClick={p.onDown}>
        <ArrowDown size={14} aria-hidden="true" />
      </button>
      <button type="button" class="icon-btn icon-xs" aria-label={L.take} title={L.take} disabled={!p.onRemove} onClick={p.onRemove}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

const move = <T,>(a: T[], i: number, j: number): T[] => {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
};

function ArchetypeFields({ d, ed, bad }: { d: Extract<Entry, { kind: "archetype" }>; ed: Ed; bad: (k: string) => boolean }) {
  const subs = d.subtypes;
  const secs = d.sections;
  return (
    <>
      <div class="fld-row">
        <BoolToggle label={L.gmApproval} icon={Asterisk} value={d.gmApproval} set={(v) => ed.set(["gmApproval"], v)} />
        <BoolToggle label={L.alien} icon={UserRound} value={d.human === false} set={(v) => ed.set(["human"], v ? false : undefined)} />
        <Fld icon={Dices} label={L.die}>
          <DiceInput label={L.die} value={d.subtypeDie} set={(v) => ed.set(["subtypeDie"], v)} />
        </Fld>
      </div>
      <div class="rc-scroll">
        <table class="stats ed-stats">
          <thead>
            <tr>
              <th />
              {STATS.map((s) => (
                <th>{s}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {subs.map((st, i) => (
              <tr class={bad(`subtypes.${i}`) ? "invalid" : undefined}>
                <th>
                  <input class="in sub-name" aria-label={L.subtype} value={st.name} onInput={(e) => ed.set(["subtypes", i, "name"], (e.currentTarget as HTMLInputElement).value)} />
                </th>
                {STATS.map((s) => (
                  <td>
                    <DiceInput label={s} value={st.stats[s]} set={(v) => ed.set(["subtypes", i, "stats", s], v)} />
                  </td>
                ))}
                <td>
                  <button type="button" class="icon-btn icon-xs" aria-label={L.take} title={L.take} disabled={subs.length < 2} onClick={() => ed.set(["subtypes"], subs.filter((_, j) => j !== i))}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" class="icon-btn icon-xs add" aria-label={L.addSubtype} title={L.addSubtype} onClick={() => ed.set(["subtypes"], [...subs, { id: "", name: "", stats: blankStats() }])}>
        <Plus size={15} aria-hidden="true" />
      </button>
      {secs.map((sec, i) => (
        <section class={`ed-sec${bad(`sections.${i}`) ? " invalid" : ""}`}>
          <div class="ed-row">
            <input class="in grow sec-name" aria-label={L.section} value={sec.name} onInput={(e) => ed.set(["sections", i, "name"], (e.currentTarget as HTMLInputElement).value)} />
            <Tools
              onUp={i > 0 ? () => ed.set(["sections"], move(secs, i, i - 1)) : undefined}
              onDown={i < secs.length - 1 ? () => ed.set(["sections"], move(secs, i, i + 1)) : undefined}
              onRemove={() => ed.set(["sections"], secs.filter((_, j) => j !== i))}
            />
          </div>
          <EffectList effects={sec.effects} path={["sections", i, "effects"]} ed={ed} />
        </section>
      ))}
      <button type="button" class="icon-btn icon-xs add" aria-label={L.addSection} title={L.addSection} onClick={() => ed.set(["sections"], [...secs, { name: "", effects: [] }])}>
        <ListPlus size={15} aria-hidden="true" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tables: rows
// ---------------------------------------------------------------------------

function RowsEditor({ d, ed }: { d: Extract<Entry, { kind: "table" }>; ed: Ed }) {
  const rows = d.rows;
  const cols = d.columns;
  const range = (r: [number, number] | undefined, at: Path) => (
    <span class="range-ed">
      <NumInput label={L.range} int value={r?.[0]} set={(v) => ed.set(at, v === undefined ? undefined : [v, r?.[1] ?? v])} />
      <span aria-hidden="true">–</span>
      <NumInput label={L.range} int value={r?.[1]} set={(v) => ed.set(at, v === undefined ? undefined : [r?.[0] ?? v, v])} />
    </span>
  );
  return (
    <ol class="ed-rows">
      {rows.map((r, i) => (
        <li class={`ed-tr${[...ed.issues.keys()].some((k) => k.startsWith(`rows.${i}`)) ? " invalid" : ""}`}>
          <div class="ed-row">
            {cols ? (
              cols.map((c) => (
                <Fld icon={Dices} label={c}>
                  {range(r.ranges?.[c], ["rows", i, "ranges", c])}
                </Fld>
              ))
            ) : (
              <Fld icon={Dices} label={L.range}>
                {range(r.range, ["rows", i, "range"])}
              </Fld>
            )}
            <Tools
              onUp={i > 0 ? () => ed.set(["rows"], move(rows, i, i - 1)) : undefined}
              onDown={i < rows.length - 1 ? () => ed.set(["rows"], move(rows, i, i + 1)) : undefined}
              onRemove={rows.length > 1 ? () => ed.set(["rows"], rows.filter((_, j) => j !== i)) : undefined}
            />
          </div>
          <Fld icon={Tag} label={L.label} wide>
            <TextInput label={L.label} req value={r.label} set={(v) => ed.set(["rows", i, "label"], v ?? "")} />
          </Fld>
          <EffectList effects={r.effects} path={["rows", i, "effects"]} ed={ed} />
        </li>
      ))}
      <li>
        <button
          type="button"
          class="icon-btn icon-xs add"
          aria-label={L.addRow}
          title={L.addRow}
          onClick={() => {
            const last = rows[rows.length - 1];
            const next = cols ? { ranges: {}, label: "", effects: [] } : { range: [(last?.range?.[1] ?? 0) + 1, (last?.range?.[1] ?? 0) + 1], label: "", effects: [] };
            ed.set(["rows"], [...rows, next]);
          }}
        >
          <ListPlus size={15} aria-hidden="true" />
        </button>
      </li>
    </ol>
  );
}

// ---------------------------------------------------------------------------
// A conflict: the newer version next to mine, field by field
// ---------------------------------------------------------------------------

function FieldView({ field, e, names }: { field: string; e: Entry | null; names: Names }): ComponentChildren {
  if (!e) return <span class="dim">–</span>;
  const v = fieldValue(e, field);
  const ctx = ctxOf(e, names);
  if (v === undefined) return <span class="dim">–</span>;
  if (field === "effects") return <div class="flow-col"><Effects effects={v as Effect[]} ctx={ctx} /></div>;
  if (field === "sections" && e.kind === "archetype")
    return (
      <div class="flow-col">
        {e.sections.map((s) => (
          <section class="sec">
            <h4>{s.name}</h4>
            <div class="sec-body">
              <Effects effects={s.effects} ctx={ctx} />
            </div>
          </section>
        ))}
      </div>
    );
  if (field === "subtypes" && e.kind === "archetype") return <StatsGrid e={e} />;
  if (field === "rows" && e.kind === "table") return <Body e={e} ctx={ctx} />;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return <span class="val">{String(v)}</span>;
  return <code class="val mono">{JSON.stringify(v)}</code>;
}

function ConflictView(p: { conflict: Conflict; mine: Entry; names: Names; onResolve: (e: Entry) => void }) {
  const { theirs, original } = p.conflict;
  const fields = useMemo(() => conflictFields(original, theirs, p.mine), [original, theirs, p.mine]);
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(fields.map((f) => [f.field, f.auto])));
  return (
    <section class="conflict" aria-label={L.conflict}>
      <header class="conflict-head">
        <span class="bad-mark" role="img" aria-label={L.conflict} title={L.conflict}>
          <GitMerge size={16} aria-hidden="true" />
        </span>
        <span class="sp" />
        <button type="button" class="icon-btn icon-sm" aria-label={L.reapply} title={L.reapply} onClick={() => p.onResolve(merge(theirs, p.mine, Object.fromEntries(fields.map((f) => [f.field, f.auto]))))}>
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button type="button" class="icon-btn icon-sm" aria-label={L.apply} title={L.apply} onClick={() => p.onResolve(merge(theirs, p.mine, choices))}>
          <Check size={16} aria-hidden="true" />
        </button>
      </header>
      {fields.map((f) => (
        <div class={`cf-row${f.both ? " both" : ""}`}>
          {(["theirs", "mine"] as const).map((side) => (
            <div class={`cf-side${choices[f.field] === side ? " chosen" : ""}`}>
              <button
                type="button"
                class="tg"
                aria-pressed={choices[f.field] === side}
                aria-label={side === "theirs" ? L.theirs : L.mine}
                title={side === "theirs" ? L.theirs : L.mine}
                onClick={() => setChoices({ ...choices, [f.field]: side })}
              >
                {side === "theirs" ? <GitMerge size={14} aria-hidden="true" /> : <UserRound size={14} aria-hidden="true" />}
              </button>
              <div class="cf-val">
                <FieldView field={f.field} e={side === "theirs" ? theirs : p.mine} names={p.names} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

export { pathStr };
