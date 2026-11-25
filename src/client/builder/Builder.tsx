// The builder ("/", "/c/<id>"): the character list and the selected
// character's sheet, edited in place. Every edit is a new version (the
// version tree in src/client/lib/characters.ts); undo/redo move the head
// along the branch. Characters live on the server, in the session's account
// (a visitor's until "Create account" or "Sign in": src/client/lib/account.ts);
// characters this browser kept itself before that go there once on load
// (src/client/lib/legacy.ts).
import { CircleArrowUp, CopyPlus, History, Info, Plus, Redo2, Trash2, TriangleAlert, Undo2 } from "lucide-preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Character as ApiCharacter, EditKind, PageData, Warband } from "../../shared/api.ts";
import { powerScore, type Distribution } from "../../shared/engine/balance.ts";
import { BuildError, type BuildResult } from "../../shared/engine/build.ts";
import type { CharacterDiff } from "../../shared/engine/diff.ts";
import type { ThingKind } from "../../shared/engine/record.ts";
import type { Compendium } from "../../shared/rules/compendium.ts";
import { MenuToggle, SiteBar } from "../components/SiteBar.tsx";
import { account } from "../lib/account.ts";
import { balanceText, distribution, quickDistribution } from "../lib/balance.ts";
import { characters as backend, headVersion, redoTarget, undoTarget, type ListRow } from "../lib/characters.ts";
import { migrateLegacy } from "../lib/legacy.ts";
import { setUrl } from "../lib/router.ts";
import { currentRules, followRules, loadRules, rulesAt, type Rules } from "../lib/rules.ts";
import { useStore } from "../lib/store.ts";
import { CharacterView, Companions, type ViewEdits } from "./CharacterView.tsx";
import { ICON, IconButton } from "./Icon.tsx";
import { L, T } from "./labels.ts";
import { archetypeName, NewCharacter } from "./NewCharacter.tsx";
import * as ops from "./ops.ts";
import { Picker, type PickerOption } from "./Picker.tsx";
import { RulesUpdate } from "./RulesUpdate.tsx";
import { ExportButtons } from "../export/ExportButtons.tsx";
import { exportWord } from "../export/sheets.ts";
import { ShareButton } from "../warband/ShareButton.tsx";
import { shareCharacter } from "../warband/share.ts";
import { warbands as wbBackend } from "../warband/store.ts";
import { WarbandList } from "../warband/WarbandList.tsx";
import { WarbandView } from "../warband/WarbandView.tsx";
import "./builder.css";

const SELECTED = "inquisitor:selected";
const LIST_OPEN = "inquisitor:list-open";
/** Wide enough for the list as a column beside the character (builder.css). */
const wideList = () => matchMedia("(min-width: 861px)").matches;
const readLocal = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

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

/** /c/<id> for a character, / for none (the address while the builder is shown: src/client/lib/router.ts). */
function syncUrl(c: ApiCharacter | null) {
  setUrl("builder", c ? `/c/${encodeURIComponent(c.id)}` : "/");
}

/** /w/<id> for a warband. */
function syncWarbandUrl(id: string) {
  setUrl("builder", `/w/${encodeURIComponent(id)}`);
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
export function BalanceLabel({ rules, built }: { rules: Rules; built: BuildResult }) {
  const ch = built.character;
  const [dist, setDist] = useState<Distribution | null>(null);
  useEffect(() => {
    let live = true;
    setDist(null);
    // A quick estimate first (or the kept full one), then the full one.
    void quickDistribution(rules, ch.archetype.id, ch.subtype.id).then((d) => live && d && setDist((cur) => (cur && cur.n >= d.n ? cur : d)));
    void distribution(rules, ch.archetype.id, ch.subtype.id).then((d) => live && d && setDist(d));
    return () => {
      live = false;
    };
  }, [rules.version, ch.archetype.id, ch.subtype.id]);
  if (!dist) return null;
  const b = balanceText(powerScore(ch, rules.compendium), dist, ch.archetype.name, ch.subtype.name);
  return <BalanceChip word={b.word} text={b.text} />;
}

let chipIds = 0;

/**
 * The word alone, then an (i) that shows the full label: on hover with a
 * mouse, or on a tap/click (kept until a tap elsewhere or Escape).
 */
function BalanceChip({ word, text }: { word: string; text: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useMemo(() => `balance-detail-${++chipIds}`, []);
  const open = hover || pinned;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setPinned(false);
        setHover(false);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPinned(false);
      setHover(false);
      btn.current?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const mouse = (on: boolean) => (e: PointerEvent) => e.pointerType === "mouse" && setHover(on);
  return (
    <span ref={root} class={`balance balance-${word}`} role="status" aria-label={`${L.balance}: ${text}`} onPointerEnter={mouse(true)} onPointerLeave={mouse(false)}>
      <span class="balance-word">{word}</span>
      <button
        ref={btn}
        type="button"
        class="balance-info"
        aria-label={L.balanceDetail}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          // Open on hover: a click keeps it open; a second click closes it.
          if (pinned) setHover(false);
          setPinned(!pinned);
        }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span id={id} class="balance-pop" hidden={!open}>
        {text}
      </span>
    </span>
  );
}

/** `seq`: goes up when the builder, kept, is sent to another character or warband (`data` names it). */
export function Builder({ data, seq = 0 }: { data: PageData; seq?: number }) {
  const { signedIn } = useStore(account);
  const [rules, setRules] = useState<Rules | null>(null);
  const [list, setList] = useState<ListRow[] | null>(null);
  const [char, setChar] = useState<ApiCharacter | null>(data.character ?? null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  // The list: a column on a wide screen (open unless closed there, remembered), a drawer on a narrow one.
  const [listOpen, setListOpen] = useState<boolean>(() => wideList() && readLocal(LIST_OPEN) !== "0");
  const toggleList = (open: boolean) => {
    setListOpen(open);
    if (wideList()) writeLocal(LIST_OPEN, open ? "1" : "0");
  };
  /** Closes the drawer after a pick (the column stays). */
  const pickedFromList = () => {
    if (!wideList()) setListOpen(false);
  };
  // The bar's height (both rows): the drawer and the column start below it.
  const [barH, setBarH] = useState(93);
  // The second row's place for a shown warband's tools (WarbandView puts them there).
  const [wbTools, setWbTools] = useState<HTMLElement | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [update, setUpdate] = useState<{ d: CharacterDiff; randomChoices: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // An armed delete disarms itself after a few seconds (a later stray tap mustn't delete).
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);
  const redoHint = useRef(new Map<string, string>());
  // Warbands (src/client/warband): the list under the characters; one shown instead of the character.
  const [warbands, setWarbands] = useState<Warband[]>([]);
  const [wb, setWb] = useState<string | null>(data.warband?.warband.id ?? null);
  const wbRef = useRef(wb);
  wbRef.current = wb;

  // The current rules, following live rules edits (an outdated character then offers its update).
  useEffect(() => {
    void loadRules().then(setRules, () => setRules(null));
    const off = currentRules.subscribe(() => {
      const r = currentRules.get().rules;
      if (r) setRules(r);
    });
    const stop = followRules();
    return () => {
      off();
      stop();
    };
  }, []);

  // The list (after this browser's own kept characters, if any, went to the server).
  const refresh = useCallback(async (select?: string | null) => {
    try {
      const imported = await migrateLegacy();
      // The selected character was one of them: select what it became.
      const cur = remembered();
      const mapped = imported && cur ? imported.characters[cur] : undefined;
      if (mapped) remember(mapped);
    } catch {}
    let rows: ListRow[] = [];
    try {
      rows = await backend.list();
    } catch {}
    setList(rows);
    let bands: Warband[] = [];
    try {
      bands = await wbBackend.list();
    } catch {}
    setWarbands(bands);
    const shownWb = wbRef.current;
    if (shownWb && !bands.some((w) => w.id === shownWb)) setWb(null);
    else if (shownWb) syncWarbandUrl(shownWb);
    const want = select !== undefined ? select : remembered();
    const id = want && rows.some((r) => r.id === want) ? want : rows[0]?.id ?? null;
    const onWarband = !!wbRef.current && bands.some((w) => w.id === wbRef.current);
    if (!id) {
      setChar(null);
      if (!onWarband) {
        setCreating(true);
        syncUrl(null);
      }
      return;
    }
    try {
      const c = await backend.get(id);
      setChar(c);
      remember(c.id);
      if (!onWarband) syncUrl(c);
    } catch {
      setChar(null);
    }
  }, []);

  useEffect(() => {
    void refresh(data.character?.id);
  }, [signedIn]);

  // Sent to a character or a warband (a link from another page, back or forward): show it, and the list as it is now.
  const seen = useRef(seq);
  useEffect(() => {
    if (seen.current === seq) return;
    seen.current = seq;
    setCreating(false);
    setUpdate(null);
    setPicker(null);
    const w = data.warband?.warband.id ?? null;
    wbRef.current = w;
    setWb(w);
    if (data.character) {
      setChar(data.character);
      remember(data.character.id);
    }
    void refresh(data.character?.id);
  }, [seq]);

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
    pickedFromList();
    setCreating(false);
    setUpdate(null);
    setWb(null);
    try {
      const c = await backend.get(id);
      setChar(c);
      remember(c.id);
      syncUrl(c);
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
      setWb(null);
      remember(c.id);
      syncUrl(c);
      setList((l) => [{ id: c.id, name: c.name, head: headVersion(c), updated_at: c.updated_at }, ...(l ?? [])]);
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
      setChar(c);
      remember(c.id);
      syncUrl(c);
      setList((l) => [{ id: c.id, name: c.name, head: headVersion(c), updated_at: c.updated_at }, ...(l ?? [])]);
    } catch {
    } finally {
      setBusy(false);
    }
  };

  /** `sure`: already confirmed (the delete under the character asks with confirm()). */
  const remove = async (sure = false) => {
    if (!char || busy) return;
    if (!sure && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    setBusy(true);
    try {
      await backend.remove(char.id);
      remember(null);
      await refresh(null);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => setConfirmDelete(false), [char?.id]);

  const openUpdate = async () => {
    if (!rules || !record || !head) return;
    const old = await rulesAt(head.rules_version);
    const oldC = old?.compendium ?? null;
    let randomChoices = true;
    try {
      randomChoices = ops.view(oldC ?? rules.compendium, record).pending.length === 0;
    } catch {}
    try {
      const d = ops.rulesDiff(oldC, rules.compendium, record);
      // Nothing to show: just move the version to the current rules.
      if (!d.changed) return void commit(ops.updateRules(rules.compendium, record, rules.version, randomChoices), "roll");
      setUpdate({ d, randomChoices });
    } catch (e) {
      // the current rules can't build it (its archetype or subtype is gone): left as it is
      if (!(e instanceof BuildError)) throw e;
    }
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
          rebuild: (archetype, subtype) => void commit(ops.create(c, archetype, subtype, "random", { name: record.name, version: v }), "roll"),
          choose: (key, ids, then) => void commit(ops.choose(c, record, key, ids, { version: v, then }), "choice"),
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

  // Signing in or out refreshes the list (the signedIn effect above): a
  // visitor's characters keep their ids in the account signed into.

  const undoTo = char ? undoTarget(char) : null;
  const redoTo = char ? redoTarget(char, redoHint.current.get(char.head_id)) : null;
  const outdated = !!(rules && head && head.rules_version !== rules.version);
  const archOf = (r: ListRow) => {
    const a = c?.archetypes.get(String(r.head.record.archetype));
    const s = a?.subtypes.find((x) => x.id === r.head.record.subtype);
    const name = a ? archetypeName(a) : undefined;
    return [name, s && s.name.toLowerCase() !== name?.toLowerCase() ? s.name : null].filter(Boolean).join(", ");
  };

  // --- warbands ------------------------------------------------------------------

  const showWarband = (id: string) => {
    pickedFromList();
    setCreating(false);
    setUpdate(null);
    setWb(id);
    syncWarbandUrl(id);
  };
  const leaveWarband = () => {
    setWb(null);
    syncUrl(char);
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
    <div class={`builder${listOpen ? " list-open" : ""}`} aria-busy={busy || !rules} style={{ "--topbar-h": `${barH}px` }}>
      <SiteBar page="characters" onHeight={setBarH} onSignedOut={() => remember(null)}>
        <MenuToggle label={L.characters} open={listOpen} onToggle={() => toggleList(!listOpen)} />
        {char && built && !wb && !creating && (
          <span class="site-scroll char-tools">
            <span class="site-group">
              <IconButton label={L.undo} disabled={!undoTo || busy} onClick={() => char && void moveHead(undoTo, char.head_id)}>
                <Undo2 size={ICON} />
              </IconButton>
              <IconButton label={L.redo} disabled={!redoTo || busy} onClick={() => char && void moveHead(redoTo, char.head_id)}>
                <Redo2 size={ICON} />
              </IconButton>
            </span>
            <span class="site-group">
              <IconButton label={L.duplicate} disabled={busy} onClick={duplicate}>
                <CopyPlus size={ICON} />
              </IconButton>
              <ShareButton key={char.id} disabled={busy} link={() => shareCharacter(char.id)} />
              <ExportButtons disabled={busy} caption rows={() => [{ name: char.name, head: headVersion(char) }]} />
            </span>
            <span class="site-group">
              {/* History: the history canvas at /c/<id>/history. */}
              <IconButton label={L.history} href={`/c/${encodeURIComponent(char.id)}/history`}>
                <History size={ICON} />
              </IconButton>
              {outdated && (
                <IconButton label={L.update} class="attention" pressed={!!update} onClick={() => (update ? setUpdate(null) : void openUpdate())}>
                  <CircleArrowUp size={ICON} />
                </IconButton>
              )}
            </span>
            <span class="site-group char-delete">
              <IconButton label={confirmDelete ? L.confirmRemove : L.remove} class={confirmDelete ? "armed" : undefined} disabled={busy} onClick={() => void remove()}>
                {confirmDelete ? <TriangleAlert size={ICON} /> : <Trash2 size={ICON} />}
              </IconButton>
            </span>
          </span>
        )}
        {wb && <span class="site-scroll" ref={setWbTools} />}
      </SiteBar>

      <div class="builder-body">
        {listOpen && <div class="list-backdrop" aria-hidden="true" onClick={() => setListOpen(false)} />}
        <nav class={`char-list${listOpen ? " open" : ""}`} aria-label={L.characters}>
          <div class="char-list-head">
            <IconButton
              label={L.newCharacter}
              pressed={creating && !wb}
              disabled={!rules}
              onClick={() => {
                pickedFromList();
                setWb(null);
                setUpdate(null);
                setCreating(true);
                syncUrl(null);
                window.scrollTo({ top: 0 });
              }}
            >
              <Plus size={ICON} />
            </IconButton>
          </div>
          <ul>
            {(list ?? []).map((r) => (
              <li>
                <button type="button" class="char-row" aria-current={!wb && !creating && r.id === char?.id ? "true" : undefined} onClick={() => void select(r.id)}>
                  <span class="char-row-name">{r.name || "–"}</span>
                  <span class="char-row-tag">{archOf(r)}</span>
                </button>
              </li>
            ))}
          </ul>
          <WarbandList warbands={warbands} current={wb} names={charNames} disabled={busy} onSelect={showWarband} onCreate={() => void newWarband()} />
        </nav>

        <main class="builder-main">
          <h1 class="site-title builder-title">{T.title}</h1>
          {creating && c && rules && (
            <NewCharacter c={c} onCreate={create} onClose={char ? () => {
              setCreating(false);
              syncUrl(char);
            } : undefined} onPreview={(a, s) => {
              void quickDistribution(rules, a, s);
              void distribution(rules, a, s);
            }} />
          )}
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
              tools={wbTools}
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
          {!wb && !creating && rules && built && record && char && (
            <>
              <CharacterView
                key={char.id}
                c={(shown ?? rules).compendium}
                record={record}
                built={built}
                edit={edits}
                balance={<BalanceLabel rules={shown ?? rules} built={built} />}
                footer={
                  <button type="button" class="text-btn" disabled={busy} onClick={() => void exportWord([{ name: char.name, head: headVersion(char) }]).catch(() => {})}>
                    {T.downloadDocx}
                  </button>
                }
              />
              <Companions c={(shown ?? rules).compendium} built={built} />
              <div class="char-foot">
                <IconButton
                  label={L.remove}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`${L.remove} ${char.name || "–"}?`)) void remove(true);
                  }}
                >
                  <Trash2 size={ICON} />
                </IconButton>
              </div>
            </>
          )}
        </main>
      </div>
      {pickerEl}
    </div>
  );
}

