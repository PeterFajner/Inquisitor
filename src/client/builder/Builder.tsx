// The builder ("/", "/c/<id>"): the character list and the selected
// character's sheet, edited in place. Every edit is a new version (the
// version tree in src/client/lib/characters.ts); undo/redo move the head
// along the branch. Signed out, characters live in this browser; signed in,
// in the account, and the browser's ones move there on sign-in.
import { CircleArrowUp, Copy, History, Menu, Plus, Redo2, Trash2, TriangleAlert, Undo2 } from "lucide-preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Character as ApiCharacter, EditKind, PageData, Warband } from "../../shared/api.ts";
import { powerScore, type Distribution } from "../../shared/engine/balance.ts";
import type { CharacterDiff } from "../../shared/engine/diff.ts";
import type { ThingKind } from "../../shared/engine/record.ts";
import type { Compendium } from "../../shared/rules/compendium.ts";
import { AccountButton } from "../components/account/AccountButton.tsx";
import { account, importCharacters, type SignedIn } from "../lib/account.ts";
import { balanceText, distribution } from "../lib/balance.ts";
import {
  backendFor,
  clearImported,
  headVersion,
  localImportBody,
  redoTarget,
  undoTarget,
  type ListRow,
} from "../lib/characters.ts";
import { loadRules, rulesAt, type Rules } from "../lib/rules.ts";
import { useStore } from "../lib/store.ts";
import { CharacterView, type ViewEdits } from "./CharacterView.tsx";
import { ICON, IconButton } from "./Icon.tsx";
import { L } from "./labels.ts";
import { NewCharacter } from "./NewCharacter.tsx";
import * as ops from "./ops.ts";
import { Picker, type PickerOption } from "./Picker.tsx";
import { RulesUpdate } from "./RulesUpdate.tsx";
import { ExportButtons } from "../export/ExportButtons.tsx";
import { ShareButton } from "../warband/ShareButton.tsx";
import { shareCharacter } from "../warband/share.ts";
import { warbandsFor } from "../warband/store.ts";
import { WarbandList } from "../warband/WarbandList.tsx";
import { WarbandView } from "../warband/WarbandView.tsx";
import { HistoryView } from "../history/HistoryView.tsx";
import { findSource } from "../history/source.ts";
import "./builder.css";

const SELECTED = "inquisitor:selected";

const remember = (id: string | null) => {
  try {
    if (id) localStorage.setItem(SELECTED, id);
    else localStorage.removeItem(SELECTED);
  } catch {}
};
const remembered = (): string | null => {
  try {
    return localStorage.getItem(SELECTED);
  } catch {
    return null;
  }
};

/** /c/<id> for a saved character, / for one in this browser (or none). */
function syncUrl(c: ApiCharacter | null, local: boolean) {
  const path = c && !local ? `/c/${encodeURIComponent(c.id)}` : "/";
  if (location.pathname !== path) history.replaceState(null, "", path);
}

/** /w/<id> for a saved warband, / for one in this browser. */
function syncWarbandUrl(id: string, local: boolean) {
  const path = local ? "/" : `/w/${encodeURIComponent(id)}`;
  if (location.pathname !== path) history.replaceState(null, "", path);
}

// Ability kinds as the book's profile rows name them.
const ABILITY_TABS: { id: ThingKind; label: string }[] = [
  { id: "talent", label: "Talents" },
  { id: "exotic", label: "Exotic Abilities" },
  { id: "mutation", label: "Mutations" },
  { id: "power", label: "Psychic Abilities" },
];

type PickerState =
  | { what: "abilities"; tab: ThingKind }
  | { what: "items" }
  | { what: "choice"; key: string; label: string; count: number; options: PickerOption[]; chosen: string[] };

/** The rules a version was built with when this browser kept them, else the current ones. */
export function usePinnedRules(rules: Rules | null, version: string | null | undefined): Rules | null {
  const [pinned, setPinned] = useState<Rules | null>(null);
  useEffect(() => {
    let live = true;
    if (!rules || !version || version === rules.version) {
      setPinned(null);
      return;
    }
    void rulesAt(version).then((r) => live && setPinned(r));
    return () => {
      live = false;
    };
  }, [rules?.version, version]);
  return pinned && pinned.version === version ? pinned : rules;
}

/** The balance label for a built character (once its distribution is simulated). */
export function BalanceLabel({ rules, built }: { rules: Rules; built: ReturnType<typeof ops.view> }) {
  const ch = built.character;
  const [dist, setDist] = useState<Distribution | null>(null);
  useEffect(() => {
    let live = true;
    setDist(null);
    void distribution(rules, ch.archetype.id, ch.subtype.id).then((d) => live && setDist(d));
    return () => {
      live = false;
    };
  }, [rules.version, ch.archetype.id, ch.subtype.id]);
  if (!dist) return null;
  const b = balanceText(powerScore(ch, rules.compendium), dist, ch.archetype.name, ch.subtype.name);
  return (
    <span class={`balance balance-${b.word}`} role="status" aria-label={`${L.balance}: ${b.text}`}>
      {b.text}
    </span>
  );
}

export function Builder({ data }: { data: PageData }) {
  const { signedIn } = useStore(account);
  const backend = backendFor(signedIn);
  const [rules, setRules] = useState<Rules | null>(null);
  const [list, setList] = useState<ListRow[] | null>(null);
  const [char, setChar] = useState<ApiCharacter | null>(data.character ?? null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // The top bar wraps to two rows on phones: the drawer starts below it.
  const barRef = useRef<HTMLElement>(null);
  const [barH, setBarH] = useState(49);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(() => setBarH(Math.round(bar.getBoundingClientRect().height)));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [update, setUpdate] = useState<{ d: CharacterDiff; randomChoices: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // An armed delete disarms itself after a few seconds (a later stray tap mustn't delete).
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);
  // The history canvas for a character kept in this browser (saved ones have /c/<id>/history).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFocus, setHistoryFocus] = useState<string | null>(null);
  const redoHint = useRef(new Map<string, string>());
  // Warbands (src/client/warband): the list under the characters; one shown instead of the character.
  const wbBackend = warbandsFor(signedIn);
  const [warbands, setWarbands] = useState<Warband[]>([]);
  const [wb, setWb] = useState<string | null>(data.warband?.warband.id ?? null);
  const wbRef = useRef(wb);
  wbRef.current = wb;

  useEffect(() => {
    void loadRules().then(setRules, () => setRules(null));
  }, []);

  // The list (and, signed in, the browser's characters into the account).
  const refresh = useCallback(async (select?: string | null) => {
    const b = backendFor(account.get().signedIn);
    if (!b.local) {
      const body = localImportBody();
      if (body) {
        try {
          clearImported(await importCharacters(body));
        } catch {}
      }
    }
    let rows: ListRow[] = [];
    try {
      rows = await b.list();
    } catch {}
    setList(rows);
    let bands: Warband[] = [];
    try {
      bands = await warbandsFor(!b.local).list();
    } catch {}
    setWarbands(bands);
    const shownWb = wbRef.current;
    if (shownWb && !bands.some((w) => w.id === shownWb)) setWb(null);
    else if (shownWb) syncWarbandUrl(shownWb, b.local);
    const want = select !== undefined ? select : remembered();
    const id = want && rows.some((r) => r.id === want) ? want : rows[0]?.id ?? null;
    const onWarband = !!wbRef.current && bands.some((w) => w.id === wbRef.current);
    if (!id) {
      setChar(null);
      if (!onWarband) {
        setCreating(true);
        syncUrl(null, b.local);
      }
      return;
    }
    try {
      const c = await b.get(id);
      setChar(c);
      remember(c.id);
      if (!onWarband) syncUrl(c, b.local);
    } catch {
      setChar(null);
    }
  }, []);

  useEffect(() => {
    void refresh(data.character?.id);
  }, [signedIn]);

  const head = char ? headVersion(char) : null;
  const record = useMemo(() => (head ? ops.engineRecord(head.record) : null), [head]);
  // The version is shown under the rules it was built with (when this
  // browser has them); edits build under the current rules.
  const shown = usePinnedRules(rules, head?.rules_version);
  const built = useMemo(() => {
    if (!shown || !record) return null;
    try {
      return ops.view(shown.compendium, record);
    } catch {
      return null;
    }
  }, [shown, record]);

  // --- saving ---------------------------------------------------------------

  const commit = async (next: ops.CharacterRecord, kind: EditKind) => {
    if (!char || !head || !rules || busy) return;
    setBusy(true);
    try {
      next.rulesVersion = rules.version;
      const res = await backend.addVersion(char.id, { parent_id: head.id, record: next, rules_version: rules.version, kind });
      let name = char.name;
      if (next.name !== char.name) {
        await backend.rename(char.id, next.name);
        name = next.name;
      }
      const updated: ApiCharacter = { ...char, name, head_id: res.head_id, versions: [...char.versions, res.version], updated_at: res.version.created_at };
      setChar(updated);
      setList((l) => l?.map((r) => (r.id === char.id ? { ...r, name, head: res.version, updated_at: res.version.created_at } : r)) ?? l);
    } catch {
      // A failed save leaves the character as it was.
    } finally {
      setBusy(false);
    }
  };

  const moveHead = async (to: string | null, from: string) => {
    if (!char || !to || busy) return;
    setBusy(true);
    try {
      await backend.setHead(char.id, to);
      const v = char.versions.find((x) => x.id === to)!;
      const name = typeof v.record.name === "string" ? v.record.name : char.name;
      if (name !== char.name) await backend.rename(char.id, name);
      redoHint.current.set(to, from);
      setChar({ ...char, head_id: to, name });
      setList((l) => l?.map((r) => (r.id === char.id ? { ...r, name, head: v } : r)) ?? l);
    } catch {
    } finally {
      setBusy(false);
    }
  };

  const select = async (id: string) => {
    setListOpen(false);
    setHistoryOpen(false);
    setHistoryFocus(null);
    setCreating(false);
    setUpdate(null);
    setWb(null);
    try {
      const c = await backend.get(id);
      setChar(c);
      remember(c.id);
      syncUrl(c, backend.local);
    } catch {}
  };

  const create = async (archetype: string, subtype: string, mode: "random" | "freeform") => {
    if (!rules || busy) return;
    setBusy(true);
    try {
      const rec = ops.create(rules.compendium, archetype, subtype, mode, { version: rules.version });
      const c = await backend.create({ name: "", record: rec, rules_version: rules.version, kind: mode === "random" ? "roll" : "manual" });
      setChar(c);
      setCreating(false);
      setHistoryOpen(false);
      setWb(null);
      remember(c.id);
      syncUrl(c, backend.local);
      setList((l) => [{ id: c.id, name: c.name, head: headVersion(c), updated_at: c.updated_at, local: backend.local }, ...(l ?? [])]);
    } catch {
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    if (!char || busy) return;
    setBusy(true);
    try {
      const c = await backend.duplicate(char.id, char.head_id);
      setHistoryOpen(false);
      setChar(c);
      remember(c.id);
      syncUrl(c, backend.local);
      setList((l) => [{ id: c.id, name: c.name, head: headVersion(c), updated_at: c.updated_at, local: backend.local }, ...(l ?? [])]);
    } catch {
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!char || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    setBusy(true);
    try {
      await backend.remove(char.id);
      setHistoryOpen(false);
      remember(null);
      await refresh(null);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => setConfirmDelete(false), [char?.id]);
  useEffect(() => {
    if (!backend.local) setHistoryOpen(false);
  }, [backend.local]);

  // --- local history ------------------------------------------------------------

  const historySetHead = async (versionId: string) => {
    if (char && versionId !== char.head_id) await moveHead(versionId, char.head_id);
  };
  const historyDuplicate = async (versionId: string) => {
    if (!char || busy) return;
    setBusy(true);
    try {
      const c = await backend.duplicate(char.id, versionId);
      setChar(c);
      remember(c.id);
      setHistoryOpen(false);
      setList((l) => [{ id: c.id, name: c.name, head: headVersion(c), updated_at: c.updated_at, local: backend.local }, ...(l ?? [])]);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const historySource = async (versionId: string) => {
    if (!char) return;
    const id = await findSource(backend, versionId, char.id);
    if (!id) return;
    await select(id);
    setHistoryFocus(versionId);
    setHistoryOpen(true);
  };

  const openUpdate = async () => {
    if (!rules || !record || !head) return;
    const old = await rulesAt(head.rules_version);
    const oldC = old?.compendium ?? null;
    let randomChoices = true;
    try {
      randomChoices = ops.view(oldC ?? rules.compendium, record).pending.length === 0;
    } catch {}
    const d = ops.rulesDiff(oldC, rules.compendium, record);
    // Nothing to show: just move the version to the current rules.
    if (!d.changed) return void commit(ops.updateRules(rules.compendium, record, rules.version, randomChoices), "roll");
    setUpdate({ d, randomChoices });
  };

  // --- edits ------------------------------------------------------------------

  const c: Compendium | null = rules?.compendium ?? null;
  const v = rules?.version;
  const edits: ViewEdits | undefined =
    c && record
      ? {
          rename: (name) => void commit(ops.rename(record, name, v), "manual"),
          stat: (stat, value) => void commit(ops.setStat(c, record, stat, value, v), "override"),
          alignment: (value) => void commit(ops.setAlignment(record, value, v), "override"),
          remove: (ref) => void commit(ops.removeThing(record, ref.kind, ref.id, v), "override"),
          add: (what) => setPicker(what === "abilities" ? { what, tab: "talent" } : { what }),
          reroll: (key) => void commit(ops.rerollDecision(c, record, key, { version: v }), "reroll"),
          choose: (key, ids) => void commit(ops.choose(c, record, key, ids, { version: v }), "choice"),
          randomFill: (keys) => void commit(ops.fillPending(c, record, { keys, version: v }), "roll"),
          change: (key) => {
            const p = ops.choiceOptions(c, record, key);
            if (p) setPicker({ what: "choice", key, label: p.label, count: p.count, options: p.options.map((o) => ({ id: o.id, label: o.label || "–" })), chosen: p.chosen });
          },
        }
      : undefined;

  const pickerEl = (() => {
    if (!picker || !c || !record || !built) return null;
    const close = () => setPicker(null);
    if (picker.what === "choice") {
      return (
        <Picker
          label={picker.label}
          options={picker.options}
          count={picker.count}
          chosen={picker.chosen}
          onClose={close}
          onDone={(ids) => {
            close();
            void commit(ops.choose(c, record, picker.key, ids, { version: v }), "choice");
          }}
        />
      );
    }
    if (picker.what === "abilities") {
      const kind = picker.tab;
      const map = { talent: c.talents, exotic: c.exotics, mutation: c.mutations, power: c.powers }[kind as "talent"];
      const owned = new Set(
        { talent: built.character.talents, exotic: built.character.exotics, mutation: built.character.mutations, power: built.character.powers }[kind as "talent"].map(
          (t) => t.id,
        ),
      );
      const options = [...map.values()]
        .filter((a) => !owned.has(a.id))
        .sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name))
        .map((a) => ({ id: a.id, label: a.name, group: a.group }));
      const tab = ABILITY_TABS.find((t) => t.id === kind)!;
      return (
        <Picker
          label={tab.label}
          tabs={ABILITY_TABS}
          tab={kind}
          onTab={(id) => setPicker({ what: "abilities", tab: id as ThingKind })}
          options={options}
          onClose={close}
          onDone={([id]) => {
            close();
            void commit(ops.addThing(record, kind, id, v), "override");
          }}
        />
      );
    }
    const options = [...c.items.values()]
      .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
      .map((it) => ({ id: it.id, label: it.name, group: it.group, detail: it.availability }));
    return (
      <Picker
        label="Equipment"
        options={options}
        onClose={close}
        onDone={([id]) => {
          close();
          void commit(ops.addThing(record, "item", id, v), "override");
        }}
      />
    );
  })();

  // --- sign-in ------------------------------------------------------------------

  const onSignedIn = (r: SignedIn) => {
    if (r.imported) clearImported(r.imported);
    const cur = char && remembered() === char.id ? char.id : null;
    const mapped = cur && r.imported?.characters[cur];
    if (mapped) remember(mapped);
    const wbMapped = wb && r.imported?.warbands?.[wb];
    if (wbMapped) setWb(wbMapped);
    // refresh runs from the signedIn effect (and imports anything left).
  };

  const undoTo = char ? undoTarget(char) : null;
  const redoTo = char ? redoTarget(char, redoHint.current.get(char.head_id)) : null;
  const outdated = !!(rules && head && head.rules_version !== rules.version);
  const archOf = (r: ListRow) => {
    const a = c?.archetypes.get(String(r.head.record.archetype));
    const s = a?.subtypes.find((x) => x.id === r.head.record.subtype);
    return [a?.name, s && s.name.toLowerCase() !== a?.name.toLowerCase() ? s.name : null].filter(Boolean).join(", ");
  };

  // --- warbands ------------------------------------------------------------------

  const showWarband = (id: string) => {
    setListOpen(false);
    setHistoryOpen(false);
    setCreating(false);
    setUpdate(null);
    setWb(id);
    syncWarbandUrl(id, wbBackend.local);
  };
  const leaveWarband = () => {
    setWb(null);
    syncUrl(char, backend.local);
  };
  const newWarband = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const w = await wbBackend.create({ name: "" });
      setWarbands((l) => [w, ...l]);
      showWarband(w.id);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const charNames = useMemo(() => new Map((list ?? []).map((r) => [r.id, r.name])), [list]);

  return (
    <div class="builder" aria-busy={busy || !rules} style={{ "--topbar-h": `${barH}px` }}>
      <header class="topbar" ref={barRef}>
        <IconButton label={L.characters} class="list-toggle" pressed={listOpen} onClick={() => setListOpen(!listOpen)}>
          <Menu size={ICON} />
        </IconButton>
        <a class="home" href="/" aria-label="Inquisitor" title="Inquisitor">
          <img src="/static/icon.svg" alt="" width={28} height={28} />
        </a>
        <IconButton label={L.newCharacter} pressed={creating} onClick={() => {
            setCreating(!creating);
            setHistoryOpen(false);
          }} disabled={!rules}>
          <Plus size={ICON} />
        </IconButton>
        <span class="topbar-gap" />
        {char && built && !wb && (
          <span class="char-tools">
            <IconButton label={L.undo} disabled={!undoTo || busy} onClick={() => char && void moveHead(undoTo, char.head_id)}>
              <Undo2 size={ICON} />
            </IconButton>
            <IconButton label={L.redo} disabled={!redoTo || busy} onClick={() => char && void moveHead(redoTo, char.head_id)}>
              <Redo2 size={ICON} />
            </IconButton>
            <IconButton label={L.duplicate} disabled={busy} onClick={duplicate}>
              <Copy size={ICON} />
            </IconButton>
            <ShareButton key={char.id} disabled={busy} link={() => shareCharacter(char, backend.local)} />
            <ExportButtons disabled={busy} rows={() => [{ name: char.name, head: headVersion(char) }]} />
            {/* History: the history canvas at /c/<id>/history for saved characters; in place for this browser's. */}
            {backend.local ? (
              <IconButton
                label={L.history}
                pressed={historyOpen}
                onClick={() => {
                  setHistoryFocus(null);
                  setHistoryOpen(!historyOpen);
                }}
              >
                <History size={ICON} />
              </IconButton>
            ) : (
              <IconButton label={L.history} href={`/c/${encodeURIComponent(char.id)}/history`}>
                <History size={ICON} />
              </IconButton>
            )}
            {outdated && (
              <IconButton label={L.update} class="attention" pressed={!!update} onClick={() => (update ? setUpdate(null) : void openUpdate())}>
                <CircleArrowUp size={ICON} />
              </IconButton>
            )}
            <IconButton label={confirmDelete ? L.confirmRemove : L.remove} class={confirmDelete ? "armed" : undefined} disabled={busy} onClick={remove}>
              {confirmDelete ? <TriangleAlert size={ICON} /> : <Trash2 size={ICON} />}
            </IconButton>
          </span>
        )}
        <AccountButton importBody={localImportBody} onSignedIn={onSignedIn} onSignedOut={() => remember(null)} />
      </header>

      <div class="builder-body">
        {listOpen && <div class="list-backdrop" aria-hidden="true" onClick={() => setListOpen(false)} />}
        <nav class={`char-list${listOpen ? " open" : ""}`} aria-label={L.characters}>
          <ul>
            {(list ?? []).map((r) => (
              <li>
                <button type="button" class="char-row" aria-current={!wb && r.id === char?.id ? "true" : undefined} onClick={() => void select(r.id)}>
                  <span class="char-row-name">{r.name || "–"}</span>
                  <span class="char-row-tag">{archOf(r)}</span>
                </button>
              </li>
            ))}
          </ul>
          <WarbandList warbands={warbands} current={wb} names={charNames} disabled={busy} onSelect={showWarband} onCreate={() => void newWarband()} />
        </nav>

        <main class="builder-main">
          {creating && c && <NewCharacter c={c} onCreate={create} onClose={char ? () => setCreating(false) : undefined} />}
          {update && <RulesUpdate d={update.d} onClose={() => setUpdate(null)} onApply={() => {
            if (!c || !record || !rules) return;
            const next = ops.updateRules(c, record, rules.version, update.randomChoices);
            setUpdate(null);
            void commit(next, "roll");
          }} />}
          {wb && (
            <WarbandView
              key={wb}
              id={wb}
              backend={wbBackend}
              characters={list ?? []}
              rules={rules}
              tagOf={archOf}
              onOpen={(id) => void select(id)}
              onChanged={(w) => setWarbands((l) => l.map((x) => (x.id === w.id ? w : x)))}
              onRemoved={(id) => {
                setWarbands((l) => l.filter((x) => x.id !== id));
                leaveWarband();
              }}
              onCreated={(w) => {
                setWarbands((l) => [w, ...l]);
                // Its characters are copies: the list has new rows.
                void refresh(char?.id ?? null).then(() => showWarband(w.id));
              }}
            />
          )}
          {!wb && historyOpen && backend.local && char && (
            <div class="builder-history">
              <HistoryView
                key={char.id}
                versions={char.versions}
                headId={char.head_id}
                rules={rules}
                busy={busy}
                focus={historyFocus}
                onSetHead={historySetHead}
                onOpen={(id) => {
                  void historySetHead(id).then(() => setHistoryOpen(false));
                }}
                onDuplicate={historyDuplicate}
                onSource={(id) => void historySource(id)}
              />
            </div>
          )}
          {!wb && !historyOpen && rules && built && record && char && (
            <>
              <div class="balance-line">
                <BalanceLabel rules={shown ?? rules} built={built} />
              </div>
              <CharacterView key={char.id} c={(shown ?? rules).compendium} record={record} built={built} edit={edits} />
            </>
          )}
        </main>
      </div>
      {pickerEl}
    </div>
  );
}

