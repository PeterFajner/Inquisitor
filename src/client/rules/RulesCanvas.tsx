// The rules canvas (/rules): every entry of every visible pack as a card on
// one canvas, in the book's sections in book order, then a region per
// extra pack. Every card is placed by layoutRegions from its height
// (stored from an earlier visit, else measured hidden once); saved positions
// (entry.pos) are ignored and cards aren't dragged. Wires join every
// archetype and table to the tables it rolls on. Signed in, cards can be
// edited, created and deleted; edits from others arrive live and the
// changed card is highlighted.
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Menu, Plus, ScrollText } from "lucide-preact";
import type { PageData } from "../../shared/api.ts";
import { buildCompendium, effectLists, walkEffects, type PackEntries } from "../../shared/rules/compendium.ts";
import type { Entry } from "../../shared/rules/schema.ts";
import { Canvas, layoutRegions, type CanvasApi, type CanvasCard, type CanvasRegion, type CanvasWire, type Size } from "../canvas/index.ts";
import { AccountButton } from "../components/account/AccountButton.tsx";
import { L as B } from "../builder/labels.ts";
import { account } from "../lib/account.ts";
import { useStore } from "../lib/store.ts";
import { Card, CheapCard, type CardActions } from "./Card.tsx";
import { ctxOf, namesOf, type RefKind } from "./ctx.ts";
import { Editor, type EditTarget } from "./edit/Editor.tsx";
import { HistoryPanel } from "./History.tsx";
import { KIND_ICON, KIND_LABEL } from "./chips/index.ts";
import { buildId, heightKey, loadHeights, saveHeights } from "./heights.ts";
import { L } from "./labels.ts";
import { connect, keyOf, load, parseKey, rules, type Item, type Key } from "./model.ts";
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
const jsonCache = new WeakMap<Entry, string>();
const jsonOf = (e: Entry) => {
  let j = jsonCache.get(e);
  if (j === undefined) jsonCache.set(e, (j = JSON.stringify(e)));
  return j;
};
// Very long entries (Cherubim) get a third column rather than a very tall card.
const big = (e: Entry) => jsonOf(e).length > 14000;

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

  // Card heights (heights.ts): stored from an earlier visit, else measured
  // hidden once by the canvas (then stored).
  const build = useMemo(buildId, []);
  const stored = useMemo(() => loadHeights(build), [build]);
  const hkeys = useMemo(
    () => new Map(ordered.map(({ key, it }) => [key, heightKey(jsonOf(it.entry), widthOf(it.entry), !!it.meta?.edited)])),
    [ordered],
  );

  // Measured heights (the canvas measures, hidden, every card it isn't given a size for).
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const saveTimer = useRef(0);
  const onMeasure = useCallback(
    (m: ReadonlyMap<string, Size>) => {
      setSizes(new Map(m));
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        for (const [key, sz] of m) {
          const k = hkeys.get(key);
          if (k) stored.set(k, Math.round(sz.h * 100) / 100);
        }
        // Only what the current cards show.
        const live = new Set(hkeys.values());
        for (const k of stored.keys()) if (!live.has(k)) stored.delete(k);
        saveHeights(build, stored);
      }, 1500);
    },
    [hkeys, stored, build],
  );
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  const heightOf = (key: string): number | undefined => sizes.get(key)?.h ?? stored.get(hkeys.get(key)!);
  // What the canvas starts from (it measures the rest).
  const known = useMemo(() => {
    const m = new Map<string, Size>();
    for (const { key, it } of ordered) {
      const h = stored.get(hkeys.get(key)!);
      if (h !== undefined) m.set(key, { w: widthOf(it.entry), h });
    }
    return m;
  }, [ordered, hkeys, stored]);


  // Laid out again only when a card's slot changes (not on every measurement).
  const lastLayout = useRef<{ regionDefs: unknown; ordered: unknown; hs: number[]; layout: ReturnType<typeof layoutRegions> } | null>(null);
  const layout = useMemo(() => {
    const hs = ordered.map(({ key }) => heightOf(key) ?? EST_H);
    const last = lastLayout.current;
    if (last && last.regionDefs === regionDefs && last.ordered === ordered && last.hs.length === hs.length && last.hs.every((h, i) => Math.abs(h - hs[i]) < 0.5))
      return last.layout;
    const l = layoutRegions(
      regionDefs.map((r) => ({ id: r.id, columns: r.columns })),
      ordered.map(({ key, it, region }, i) => ({ id: key, region, w: widthOf(it.entry), h: hs[i] })),
      { columnWidth: COL, gap: GAP, padding: 32, regionGap: 240, rowWidth: 16000, aspect: 1.5 },
    );
    lastLayout.current = { regionDefs, ordered, hs, layout: l };
    return l;
  }, [regionDefs, ordered, sizes, known]);

  const [selected, setSelected] = useState<Key | null>(null);
  const [panel, setPanel] = useState<{ mode: "edit"; target: EditTarget } | { mode: "history"; key: Key } | null>(null);
  const editingKey = panel?.mode === "edit" ? panel.target.key : null;

  // Card objects, reused while nothing about them changes (so only changed cards re-render).
  const cache = useRef(new Map<Key, RCard>());
  const cards = useMemo(() => {
    const next = new Map<Key, RCard>();
    const out: RCard[] = [];
    for (const { key, it } of ordered) {
      const pos = layout.positions.get(key) ?? { x: 0, y: 0 };
      const w = widthOf(it.entry);
      const flash = s.flash.has(key);
      const editing = editingKey === key;
      const old = cache.current.get(key);
      const c =
        old && old.item === it && old.x === pos.x && old.y === pos.y && old.w === w && old.flash === flash && old.editing === editing
          ? old
          : { id: key, x: pos.x, y: pos.y, w, h: heightOf(key) ?? EST_H, label: it.entry.name, item: it, flash, editing };
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
    [names, go, signedIn, stableActions],
  );
  const renderCheap = useCallback((c: CanvasCard, sz: Size) => <CheapCard entry={(c as RCard).item.entry} h={sz.h} flash={(c as RCard).flash} />, []);


  // A card named in the address (#<pack>:<kind>/<id>) is shown once every card is measured (the layout has settled).
  const flewHash = useRef(false);
  const measured = cards.length > 0 && cards.every((c) => heightOf(c.id) !== undefined);
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

  // The bar: on the left the same controls, in the same places, as the builder's
  // (characters on narrow screens, home, +, rules); the region tabs; then packs and account.
  const barStart = (
    <>
      <a class="icon-btn list-toggle" href="/" aria-label={B.characters} title={B.characters}>
        <Menu size={20} aria-hidden="true" />
      </a>
      <a class="home" href="/" aria-label="Inquisitor" title="Inquisitor">
        <img src="/static/icon.svg" alt="" width={28} height={28} />
      </a>
      <div class="menu-wrap">
        <button
          type="button"
          class="icon-btn"
          aria-label={L.newEntry}
          title={L.newEntry}
          aria-expanded={signedIn ? newOpen : undefined}
          disabled={!signedIn}
          onClick={() => setNewOpen(!newOpen)}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
        {signedIn && newOpen && (
          <div class="menu menu-left kinds-menu" role="menu">
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
      <a class="icon-btn" href="/rules" aria-label={B.rules} title={B.rules} aria-current="page">
        <ScrollText size={20} aria-hidden="true" />
      </a>
    </>
  );
  const barEnd = (
    <span class="rules-tools">
      <PacksMenu packs={s.packs} hidden={hidden} onToggle={toggleHidden} active={activePack} onActive={setActive} signedIn={signedIn} />
      <AccountButton />
    </span>
  );

  return (
    <main class={`rules-page${panel ? " has-panel" : ""}`}>
      <div class="rules-canvas" aria-busy={!s.loaded}>
        {s.loaded && (
          <Canvas
            cards={cards}
            renderCard={renderCard}
            renderCheap={renderCheap}
            cheapBelow={CHEAP_BELOW}
            wires={wires}
            regions={regions}
            selected={selected}
            onSelect={setSelected}
            measure
            initialSizes={known}
            onMeasure={onMeasure}
            apiRef={api}
            labels={labels}
            barStart={barStart}
            barEnd={barEnd}
          />
        )}
      </div>
      {panel?.mode === "edit" && (
        <Editor key={panel.target.key ?? "new"} target={panel.target} names={names} onClose={closePanel} onSaved={onSaved} />
      )}
      {panel?.mode === "history" && <HistoryPanel key={panel.key} cardKey={panel.key} names={names} signedIn={signedIn} onClose={closePanel} />}
    </main>
  );
}

export { parseKey };
