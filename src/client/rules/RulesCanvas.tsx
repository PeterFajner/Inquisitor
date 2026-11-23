// The rules canvas (/rules): every entry of every visible pack as a card on
// one canvas, in the book's sections in book order, then a region per
// extra pack. Cards keep their saved position (entry.pos); the rest are
// laid out by layoutRegions from their measured heights. Wires join every
// archetype and table to the tables it rolls on. Signed in, cards can be
// dragged (saved as moves), edited, created and deleted; edits from others
// arrive live and the changed card is highlighted.
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FilePlus } from "lucide-preact";
import type { PageData } from "../../shared/api.ts";
import { buildCompendium, effectLists, walkEffects, type PackEntries } from "../../shared/rules/compendium.ts";
import type { Entry } from "../../shared/rules/schema.ts";
import { Canvas, layoutRegions, type CanvasApi, type CanvasCard, type CanvasRegion, type CanvasWire, type Size, type View } from "../canvas/index.ts";
import { AccountButton } from "../components/account/AccountButton.tsx";
import { account } from "../lib/account.ts";
import { useStore } from "../lib/store.ts";
import { Card, CheapCard, type CardActions } from "./Card.tsx";
import { ctxOf, namesOf, type RefKind } from "./ctx.ts";
import { Editor, type EditTarget } from "./edit/Editor.tsx";
import { HistoryPanel } from "./History.tsx";
import { KIND_ICON, KIND_LABEL } from "./chips/index.ts";
import { L } from "./labels.ts";
import { connect, keyOf, load, moveEntry, parseKey, rules, type Item, type Key } from "./model.ts";
import { PacksMenu } from "./Packs.tsx";
import { BASE_PACK, BOOK_REGIONS, bookOrder, PACK_ICON, packRegionId, regionOf } from "./regions.ts";
import { blankEntry } from "./edit/blank.ts";
import "./rules.css";

const COL = 320;
const GAP = 16;
const WIDE = 2 * COL + GAP;
const EST_H = 200;
const CHEAP_BELOW = 0.5;
const HIDDEN_KEY = "inquisitor:rules-hidden-packs";
const ACTIVE_KEY = "inquisitor:rules-active-pack";

type RCard = CanvasCard & { item: Item; flash: boolean; editing: boolean };

const XWIDE = 3 * COL + 2 * GAP;
const bigCache = new WeakMap<Entry, boolean>();
// Very long entries (Cherubim) get a third column rather than a very tall card.
const big = (e: Entry) => {
  let b = bigCache.get(e);
  if (b === undefined) bigCache.set(e, (b = JSON.stringify(e).length > 14000));
  return b;
};

function widthOf(e: Entry): number {
  switch (e.kind) {
    case "archetype":
      return big(e) ? XWIDE : WIDE;
    case "rule":
      return WIDE;
    case "table":
      if ((e.columns?.length ?? 0) > 5) return XWIDE;
      return e.columns?.length || e.rows.some((r) => r.label.length > 48 || r.effects.length > 2) ? WIDE : COL;
    case "item":
      return e.profile && Object.keys(e.profile).length > 4 ? WIDE : COL;
    default:
      return COL;
  }
}

function readLocal(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeLocal(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

/** Tables an entry rolls on (roll effects, bionics). */
function rollTargets(e: Entry): string[] {
  const out = new Set<string>();
  for (const { effects } of effectLists(e))
    walkEffects(effects, (x) => {
      if ("roll" in x && typeof x.roll === "string") out.add(x.roll);
      if ("bionics" in x) out.add(x.bionics.table ?? "bionics-table");
    });
  return [...out];
}

/** Fly to a card's top (a very tall card isn't shrunk to fit whole), readable. On
 * a phone a card is wider than the screen: show it at full size from its top-left
 * corner (panning shows the rest) rather than shrunk to an unreadable width. */
function show(api: CanvasApi | null, key: Key, instant = false) {
  const r = api?.rectOf(key);
  if (!api || !r) return;
  const sz = api.size();
  if (sz.w < 700 && r.w > sz.w - 16) {
    api.flyTo({ x: 8 - r.x, y: api.inset() + 8 - r.y, k: 1 }, { instant });
    return;
  }
  api.flyTo({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, Math.max(200, sz.h - 120)) }, { maxZoom: 1, instant });
}

export function RulesCanvas({ data }: { data: PageData }) {
  void data;
  const s = useStore(rules);
  const { signedIn } = useStore(account);
  const api = useRef<CanvasApi>(null);

  useEffect(() => {
    void load();
    return connect();
  }, []);

  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(readLocal(HIDDEN_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleHidden = (id: string) => {
    const n = new Set(hidden);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setHidden(n);
    writeLocal(HIDDEN_KEY, JSON.stringify([...n]));
  };
  const [active, setActiveState] = useState<string>(() => readLocal(ACTIVE_KEY) ?? BASE_PACK);
  const setActive = (id: string) => {
    setActiveState(id);
    writeLocal(ACTIVE_KEY, id);
  };
  const activePack = s.packs.some((p) => p.id === active) ? active : s.packs[0]?.id ?? BASE_PACK;

  const visiblePacks = useMemo(() => s.packs.filter((p) => !hidden.has(p.id)), [s.packs, hidden]);

  // Entries of the visible packs, in book order per region.
  const visible = useMemo(() => {
    const vis = new Set(visiblePacks.map((p) => p.id));
    return [...s.items].filter(([, it]) => vis.has(it.pack));
  }, [s.items, visiblePacks]);

  const compendium = useMemo(() => {
    const stack: PackEntries[] = visiblePacks.map((pack) => ({ pack, entries: [] }));
    const byPack = new Map(stack.map((p) => [p.pack.id, p]));
    for (const [, it] of visible) byPack.get(it.pack)?.entries.push(it.entry);
    return buildCompendium(stack);
  }, [visible, visiblePacks]);
  const names = useMemo(() => namesOf(compendium), [compendium]);

  // Regions: the book's sections (when the base pack shows), then a region per other visible pack.
  const regionDefs = useMemo(() => {
    const defs = visiblePacks.some((p) => p.id === BASE_PACK) ? [...BOOK_REGIONS] : [];
    for (const p of visiblePacks) if (p.id !== BASE_PACK) defs.push({ id: packRegionId(p.id), title: p.name, icon: PACK_ICON });
    return defs;
  }, [visiblePacks]);

  const ordered = useMemo(() => {
    const list = visible.map(([key, it]) => ({ key, it, region: regionOf(it.pack, it.entry) }));
    const rank = new Map(regionDefs.map((r, i) => [r.id, i]));
    return list.sort((a, b) => (rank.get(a.region) ?? 0) - (rank.get(b.region) ?? 0) || bookOrder(a.it.entry, b.it.entry));
  }, [visible, regionDefs]);

  // Measured heights (all cards, measured hidden once by the canvas).
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const sizesRef = useRef(sizes);
  const onMeasure = useCallback((m: ReadonlyMap<string, Size>) => {
    sizesRef.current = m;
    setSizes(new Map(m));
  }, []);

  const layout = useMemo(
    () =>
      layoutRegions(
        regionDefs.map((r) => ({ id: r.id, columns: r.columns })),
        ordered.map(({ key, it, region }) => ({ id: key, region, w: widthOf(it.entry), h: sizes.get(key)?.h ?? EST_H })),
        { columnWidth: COL, gap: GAP, padding: 32, regionGap: 240, rowWidth: 16000, aspect: 1.5 },
      ),
    [regionDefs, ordered, sizes],
  );

  const [selected, setSelected] = useState<Key | null>(null);
  const [panel, setPanel] = useState<{ mode: "edit"; target: EditTarget } | { mode: "history"; key: Key } | null>(null);
  const editingKey = panel?.mode === "edit" ? panel.target.key : null;

  // Card objects, reused while nothing about them changes (so only changed cards re-render).
  const cache = useRef(new Map<Key, RCard>());
  const cards = useMemo(() => {
    const next = new Map<Key, RCard>();
    const out: RCard[] = [];
    for (const { key, it } of ordered) {
      const pos = it.entry.pos ? { x: it.entry.pos[0], y: it.entry.pos[1] } : layout.positions.get(key) ?? { x: 0, y: 0 };
      const w = widthOf(it.entry);
      const flash = s.flash.has(key);
      const editing = editingKey === key;
      const old = cache.current.get(key);
      const c =
        old && old.item === it && old.x === pos.x && old.y === pos.y && old.w === w && old.flash === flash && old.editing === editing
          ? old
          : { id: key, x: pos.x, y: pos.y, w, h: sizes.get(key)?.h ?? EST_H, label: it.entry.name, item: it, flash, editing };
      next.set(key, c);
      out.push(c);
    }
    cache.current = next;
    return out;
  }, [ordered, layout, s.flash, editingKey]);

  // Regions are where the layout puts their cards; a card moved elsewhere stays where it was put.
  const regions: CanvasRegion[] = useMemo(
    () => regionDefs.map((r) => ({ id: r.id, title: r.title, icon: r.icon, ...(layout.regions.get(r.id) ?? { x: 0, y: 0, w: COL, h: COL }) })),
    [regionDefs, layout],
  );

  // Wires: archetypes and tables to every table they roll on (the topmost visible pack's).
  const wires: CanvasWire[] = useMemo(() => {
    const out: CanvasWire[] = [];
    for (const { key, it } of ordered) {
      if (it.entry.kind !== "archetype" && it.entry.kind !== "table") continue;
      for (const t of rollTargets(it.entry)) {
        const pack = compendium.origin.get(`table/${t}`);
        if (!pack) continue;
        const to = keyOf(pack, "table", t);
        if (to !== key) out.push({ from: key, to, class: it.entry.kind === "archetype" ? "rw rw-a" : "rw" });
      }
    }
    return out;
  }, [ordered, compendium]);

  // Fly to a card an entry names.
  const go = useCallback(
    (kind: RefKind, id: string) => {
      const pack = compendium.origin.get(`${kind}/${id}`);
      if (!pack) return;
      const key = keyOf(pack, kind, id);
      setSelected(key);
      show(api.current, key);
    },
    [compendium],
  );

  // Contexts per entry, cached by entry object.
  const ctxCache = useRef(new WeakMap<Entry, ReturnType<typeof ctxOf>>());
  useEffect(() => {
    ctxCache.current = new WeakMap();
  }, [names, go]);

  const [cheap, setCheap] = useState(false);
  const onViewChange = useCallback((v: View) => setCheap(v.k < CHEAP_BELOW), []);

  // Keep a card in view beside a panel that just opened (the canvas narrows).
  const reveal = (key: Key) =>
    setTimeout(() => {
      const r = api.current?.rectOf(key);
      const v = api.current?.getView();
      if (r && v) api.current?.flyTo({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 400) }, { maxZoom: Math.max(v.k, 0.6) });
    }, 80);

  const actions = useRef<CardActions>({ edit: () => {}, history: () => {} });
  actions.current.edit = (key) => {
    const it = rules.get().items.get(key);
    if (it) setPanel({ mode: "edit", target: { key, pack: it.pack, entry: it.entry, base: it.meta?.commit ?? null, isNew: false } });
    reveal(key);
  };
  actions.current.history = (key) => {
    setPanel({ mode: "history", key });
    reveal(key);
  };
  const stableActions = useMemo<CardActions>(() => ({ edit: (k) => actions.current.edit(k), history: (k) => actions.current.history(k) }), []);

  const renderCard = useCallback(
    (c: CanvasCard, st: { selected: boolean }) => {
      const rc = c as RCard;
      const e = rc.item.entry;
      const h = sizesRef.current.get(c.id)?.h;
      if (cheap && h && !st.selected) return <CheapCard entry={e} h={h} flash={rc.flash} />;
      let ctx = ctxCache.current.get(e);
      if (!ctx) {
        ctx = { ...ctxOf(e, names), go };
        ctxCache.current.set(e, ctx);
      }
      return (
        <Card
          cardKey={c.id}
          entry={e}
          meta={rc.item.meta}
          ctx={ctx}
          selected={st.selected}
          signedIn={signedIn}
          editing={rc.editing}
          flash={rc.flash}
          actions={stableActions}
        />
      );
    },
    [cheap, names, go, signedIn, stableActions],
  );

  const onMove = useCallback((id: string, p: { x: number; y: number }) => {
    void moveEntry(id, [Math.round(p.x), Math.round(p.y)]);
  }, []);

  // A card named in the address (#<pack>:<kind>/<id>) is shown once every card is measured (the layout has settled).
  const flewHash = useRef(false);
  const measured = cards.length > 0 && cards.every((c) => sizes.has(c.id));
  useEffect(() => {
    if (flewHash.current || !s.loaded || !measured) return;
    flewHash.current = true;
    const h = decodeURIComponent(location.hash.slice(1));
    if (h && s.items.has(h)) {
      setSelected(h);
      setTimeout(() => show(api.current, h, true), 0);
    }
  }, [s.loaded, measured]);
  useEffect(() => {
    if (!flewHash.current) return;
    const url = `${location.pathname}${location.search}${selected ? `#${encodeURIComponent(selected)}` : ""}`;
    history.replaceState(null, "", url);
  }, [selected]);

  // A new entry: of a kind, in the active pack; laid out at the end of its region until it's moved.
  const [newOpen, setNewOpen] = useState(false);
  const newEntry = (kind: Entry["kind"]) => {
    setNewOpen(false);
    setPanel({ mode: "edit", target: { key: null, pack: activePack, entry: blankEntry(kind), base: null, isNew: true } });
  };

  const closePanel = useCallback(() => setPanel(null), []);
  const onSaved = useCallback((key: Key) => {
    setPanel(null);
    setSelected(key);
    setTimeout(() => show(api.current, key), 50);
  }, []);

  const labels = useMemo(() => ({ zoomIn: L.zoomIn, zoomOut: L.zoomOut, fit: L.fit, minimap: L.minimap, canvas: L.canvas }), []);

  return (
    <main class={`rules-page${panel ? " has-panel" : ""}`}>
      <div class="rules-canvas" aria-busy={!s.loaded}>
        {s.loaded && (
          <Canvas
            cards={cards}
            renderCard={renderCard}
            wires={wires}
            regions={regions}
            selected={selected}
            onSelect={setSelected}
            onMove={signedIn ? onMove : undefined}
            snap={8}
            measure
            onMeasure={onMeasure}
            onViewChange={onViewChange}
            apiRef={api}
            labels={labels}
          />
        )}
        <div class="rules-tools cv-ui">
        <PacksMenu
          packs={s.packs}
          hidden={hidden}
          onToggle={toggleHidden}
          active={activePack}
          onActive={setActive}
          signedIn={signedIn}
        />
        {signedIn && (
          <div class="menu-wrap">
            <button
              type="button"
              class="icon-btn"
              aria-label={L.newEntry}
              title={L.newEntry}
              aria-expanded={newOpen}
              onClick={() => setNewOpen(!newOpen)}
            >
              <FilePlus size={20} aria-hidden="true" />
            </button>
            {newOpen && (
              <div class="menu kinds-menu" role="menu">
                {(["archetype", "talent", "exotic", "item", "power", "mutation", "table", "rule"] as const).map((k) => {
                  const I = KIND_ICON[k];
                  return (
                    <button type="button" role="menuitem" class="icon-btn" aria-label={KIND_LABEL[k]} title={KIND_LABEL[k]} onClick={() => newEntry(k)}>
                      <I size={20} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <AccountButton />
        </div>
      </div>
      {panel?.mode === "edit" && (
        <Editor key={panel.target.key ?? "new"} target={panel.target} names={names} onClose={closePanel} onSaved={onSaved} />
      )}
      {panel?.mode === "history" && <HistoryPanel key={panel.key} cardKey={panel.key} names={names} signedIn={signedIn} onClose={closePanel} />}
    </main>
  );
}

export { parseKey };
