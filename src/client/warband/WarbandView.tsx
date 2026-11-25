// One warband (/w/<id>, shown in the builder's main column): its name, the book's warband rules it breaks (as
// warnings: an icon and the book's sentence), its characters in order
// (open, move, take out), and below them their sheets. Icons add
// characters, duplicate it (with copies of its characters), share it, save
// the Word sheet, print, and delete it (tap twice; its characters stay);
// they go in the bar's second row (`tools`, from the builder).
import { ArrowDown, ArrowUp, CopyPlus, Trash2, TriangleAlert, UserPlus, Users, X } from "lucide-preact";
import { createPortal } from "preact/compat";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Warband } from "../../shared/api.ts";
import type { FullBuild } from "../../shared/engine/companions.ts";
import { sheetParts } from "../../shared/sheet-map.ts";
import { BalanceLabel } from "../builder/Builder.tsx";
import { ICON, ICON_SM, IconButton } from "../builder/Icon.tsx";
import { Picker } from "../builder/Picker.tsx";
import { ExportButtons } from "../export/ExportButtons.tsx";
import { buildRow } from "../export/sheets.ts";
import type { ListRow } from "../lib/characters.ts";
import type { Rules } from "../lib/rules.ts";
import { Sheet } from "../sheet/Sheet.tsx";
import { W } from "./labels.ts";
import { ShareButton } from "./ShareButton.tsx";
import { moved, type WarbandBackend } from "./store.ts";
import { shareWarband } from "./share.ts";
import { warbandWarnings, type WarbandWarning } from "./warnings.ts";
import "./warband.css";

export type BuiltMember = { row: ListRow; rules: Rules; result: FullBuild };

/** The members built for showing (each under its own rules when this browser has them). */
export function useBuiltMembers(rules: Rules | null, members: ListRow[]): (BuiltMember | null)[] {
  const [built, setBuilt] = useState<(BuiltMember | null)[]>([]);
  const sig = members.map((m) => `${m.id}@${m.head.id}`).join(",");
  useEffect(() => {
    let live = true;
    if (!rules) return;
    void Promise.all(members.map((m) => buildRow(m, rules).then((b) => (b ? { row: m, ...b } : null)))).then((out) => live && setBuilt(out));
    return () => {
      live = false;
    };
  }, [rules?.version, sig]);
  return built;
}

/** The warnings: an icon and the book's sentence, then the characters it is about. */
export function Warnings({ warnings, names, onOpen }: { warnings: WarbandWarning[]; names: Map<string, string>; onOpen?: (id: string) => void }) {
  if (!warnings.length) return null;
  return (
    <ul class="wb-warnings">
      {warnings.map((w) => (
        <li class={`wb-warning wb-${w.kind}`} key={w.id}>
          <span class="wb-warning-icon" role="img" aria-label={w.kind === "models" ? W.models : W.warning} title={w.kind === "models" ? W.models : W.warning}>
            {w.kind === "models" ? <Users size={ICON_SM} /> : <TriangleAlert size={ICON_SM} />}
          </span>
          <span class="wb-warning-text">{w.text}</span>
          <span class="wb-warning-who">
            {w.members.map((id) =>
              onOpen ? (
                <button type="button" class="wb-who" onClick={() => onOpen(id)}>
                  {names.get(id) || "–"}
                </button>
              ) : (
                <span class="wb-who">{names.get(id) || "–"}</span>
              ),
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The warnings for built members, under the current rules. */
export function useWarnings(rules: Rules | null, built: (BuiltMember | null)[]): WarbandWarning[] {
  return useMemo(() => {
    if (!rules) return [];
    const ok = built.filter((b): b is BuiltMember => !!b);
    try {
      return warbandWarnings(rules.compendium, ok.map((b) => ({ id: b.row.id, character: b.result.character })));
    } catch {
      return [];
    }
  }, [rules, built]);
}

/** The members' sheets, read-only, one after another. */
export function MemberSheets({ built }: { built: (BuiltMember | null)[] }) {
  return (
    <div class="wb-sheets">
      {built.map((b) => (b ? <MemberSheet b={b} key={b.row.id} /> : null))}
    </div>
  );
}

function MemberSheet({ b }: { b: BuiltMember }) {
  const parts = useMemo(() => sheetParts(b.result.character, b.rules.compendium), [b]);
  return (
    <section class="wb-sheet" id={`wb-${b.row.id}`}>
      <div class="balance-line">
        <BalanceLabel rules={b.rules} built={b.result} />
      </div>
      <Sheet parts={parts} character={b.result.character} />
      {b.result.companions.map((m) => (
        <Sheet key={m.key} parts={sheetParts(m.result.character, b.rules.compendium)} character={m.result.character} />
      ))}
    </section>
  );
}

function NameEdit({ name, onDone }: { name: string; onDone: (v: string | null) => void }) {
  return (
    <input
      class="wb-name-input"
      type="text"
      maxLength={200}
      aria-label={W.rename}
      title={W.rename}
      defaultValue={name}
      ref={(el) => {
        if (el && document.activeElement !== el) {
          el.focus();
          el.select();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(e.currentTarget.value);
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={(e) => onDone(e.currentTarget.value)}
    />
  );
}

type Props = {
  id: string;
  /** Where the tools go (the bar's second row); beside the name without it. */
  tools?: HTMLElement | null;
  backend: WarbandBackend;
  /** The viewer's characters (to add). */
  characters: ListRow[];
  rules: Rules | null;
  /** "Archetype, Subtype" for a list row. */
  tagOf: (row: ListRow) => string;
  onOpen: (characterId: string) => void;
  onChanged: (w: Warband) => void;
  onRemoved: (id: string) => void;
  onCreated: (w: Warband) => void;
};

export function WarbandView(p: Props) {
  const [warband, setWarband] = useState<Warband | null>(null);
  const [members, setMembers] = useState<ListRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // An armed delete disarms itself after a few seconds (a later stray tap mustn't delete).
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);
  const [gone, setGone] = useState(false);

  // The characters' list rows change as they are edited: reload with them.
  const charSig = p.characters.map((c) => `${c.id}@${c.head.id}:${c.name}`).join(",");
  useEffect(() => {
    let live = true;
    setConfirmDelete(false);
    p.backend.get(p.id).then(
      (w) => {
        if (!live) return;
        setWarband(w.warband);
        setMembers(w.members);
        setGone(false);
      },
      () => live && setGone(true),
    );
    return () => {
      live = false;
    };
  }, [p.id, p.backend, charSig]);

  const built = useBuiltMembers(p.rules, members);
  const warnings = useWarnings(p.rules, built);
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);

  if (gone) return null;
  if (!warband) return <section class="wb" aria-busy="true" />;

  const save = async (patch: { name?: string; character_ids?: string[] }) => {
    if (busy) return;
    setBusy(true);
    try {
      const w = await p.backend.update(warband.id, patch);
      const all = new Map([...p.characters, ...members].map((c) => [c.id, c]));
      setWarband(w);
      setMembers(w.character_ids.map((id) => all.get(id)).filter((r): r is ListRow => !!r));
      p.onChanged(w);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const ids = members.map((m) => m.id);

  const duplicate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      p.onCreated(await p.backend.duplicate(warband.id));
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      await p.backend.remove(warband.id);
      p.onRemoved(warband.id);
    } catch {
      setBusy(false);
    }
  };

  const addable = p.characters.filter((c) => !ids.includes(c.id));
  const tools = (
    <span class="wb-tools">
      <span class="site-group">
        <IconButton label={W.addCharacter} disabled={busy || !addable.length} onClick={() => setAdding(true)}>
          <UserPlus size={ICON} />
        </IconButton>
      </span>
      <span class="site-group">
        <IconButton label={W.duplicate} disabled={busy} onClick={() => void duplicate()}>
          <CopyPlus size={ICON} />
        </IconButton>
        <ShareButton disabled={busy || !members.length} link={() => shareWarband(warband.id)} />
        <ExportButtons disabled={busy || !members.length} caption rows={() => members} name={warband.name} />
      </span>
      <span class="site-group wb-delete">
        <IconButton label={confirmDelete ? W.confirmRemove : W.remove} class={confirmDelete ? "armed" : undefined} disabled={busy} onClick={() => void remove()}>
          {confirmDelete ? <TriangleAlert size={ICON} /> : <Trash2 size={ICON} />}
        </IconButton>
      </span>
    </span>
  );

  return (
    <section class="wb" aria-busy={busy}>
      {p.tools && createPortal(tools, p.tools)}
      <header class="wb-head">
        <h2 class="wb-name">
          {renaming ? (
            <NameEdit
              name={warband.name}
              onDone={(v) => {
                setRenaming(false);
                if (v !== null && v.trim() !== warband.name) void save({ name: v.trim() });
              }}
            />
          ) : (
            <button type="button" class="wb-name-btn" aria-label={warband.name ? `${W.rename}: ${warband.name}` : W.rename} title={W.rename} onClick={() => setRenaming(true)}>
              {warband.name || <span class="wb-name-empty" />}
            </button>
          )}
        </h2>
        {!p.tools && tools}
      </header>

      <Warnings warnings={warnings} names={names} onOpen={p.onOpen} />

      <ol class="wb-members">
        {members.map((m, i) => {
          const b = built[i];
          const ch = b && b.row.id === m.id ? b.result.character : null;
          // (an unnamed character goes by its archetype and subtype)
          const who = m.name || p.tagOf(m) || "–";
          return (
            <li class="wb-member" key={m.id}>
              <button type="button" class="wb-member-open" onClick={() => p.onOpen(m.id)}>
                <span class="wb-member-name">{m.name || "–"}</span>
                <span class="wb-member-tag">{[p.tagOf(m), ch?.alignment].filter(Boolean).join(", ")}</span>
              </button>
              <span class="wb-member-ctl">
                <IconButton small label={`${W.moveUp}: ${who}`} disabled={busy || i === 0} onClick={() => void save({ character_ids: moved(ids, m.id, -1) })}>
                  <ArrowUp size={ICON_SM} />
                </IconButton>
                <IconButton small label={`${W.moveDown}: ${who}`} disabled={busy || i === members.length - 1} onClick={() => void save({ character_ids: moved(ids, m.id, 1) })}>
                  <ArrowDown size={ICON_SM} />
                </IconButton>
                <IconButton small label={`${W.takeOut}: ${who}`} disabled={busy} onClick={() => void save({ character_ids: ids.filter((x) => x !== m.id) })}>
                  <X size={ICON_SM} />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ol>

      <MemberSheets built={built} />

      {adding && (
        <Picker
          label="Warrior Band"
          count={addable.length}
          options={addable.map((c) => ({ id: c.id, label: c.name || "–", detail: p.tagOf(c) }))}
          onClose={() => setAdding(false)}
          onDone={(add) => {
            setAdding(false);
            if (add.length) void save({ character_ids: [...ids, ...add] });
          }}
        />
      )}
    </section>
  );
}
