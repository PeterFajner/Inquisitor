// The rules canvas (/rules): every entry of every visible pack as a card on
// one canvas, in the book's sections in book order, then a region per
// extra pack. Every card is placed by layoutRegions from its size, worked
// out rather than measured (./sizes.ts: the server's, else worked out here),
// so a first visit lays everything out at once. Cards too small to read
// aren't mounted but drawn from their geometry (./greek.ts), and mounted
// (fading in over the drawing) once their text would be readable; saved positions (entry.pos)
// are ignored and cards aren't dragged. Wires join an
// archetype or table to the tables it rolls on, drawn only for the selected
// and the hovered card (the cards at their ends outlined, or pointed to
// from the edge when off screen). Signed in, cards can be
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
import { decodeGeo, geoOf, type Geo } from "../../shared/layout/paint.ts";
import { Card, type CardActions } from "./Card.tsx";
import { ctxOf, namesOf, type RefKind } from "./ctx.ts";
import { Editor, type EditTarget } from "./edit/Editor.tsx";
import { HistoryPanel } from "./History.tsx";
import { KIND_ICON, KIND_LABEL } from "./chips/index.ts";
import { cardHeight, LAYOUT, WEBKIT } from "./card-height.tsx";
import { drawBlank, drawGeo, X_HEIGHT } from "./greek.ts";
import { COL, GAP, holds, widthOf } from "./sizes.ts";
import { L } from "./labels.ts";
import { connect, keyOf, load, parseKey, rules, type Item, type Key } from "./model.ts";
import { PacksMenu } from "./Packs.tsx";
import { BASE_PACK, BOOK_REGIONS, bookOrder, PACK_ICON, packRegionId, regionOf } from "./regions.ts";
import { blankEntry } from "./edit/blank.ts";
import "./rules.css";

const EST_H = 200;
/**
 * Cards are mounted (the browser draws their text) once their body text's
 * x-height (13px Ubuntu: 6.8 CSS px) is this many device pixels, and drawn
 * (./greek.ts) below that. Under about 4.5 pixels lowercase letters can't
 * be told apart (it's 9px text on a 1× screen, the smallest UI text there
 * is), so nothing readable is lost; measured in device pixels, a retina
 * screen switches at the same physical size: zoom 0.67 at 1×, 0.33 at 2×,
 * 0.22 at 3×.
 */
const READABLE_X_PX = 4.5;
const BODY_PX = 13;
const readableAt = (dpr: number) => READABLE_X_PX / (BODY_PX * X_HEIGHT * dpr);
/** Screen pixels around the view whose cards stay mounted: few, since a card mounted late fades in over its drawing rather than popping in, and full cards are mounted from a low zoom. */
const OVERSCAN = 250;
const HIDDEN_KEY = "inquisitor:rules-hidden-packs";
const ACTIVE_KEY = "inquisitor:rules-active-pack";
/** Cards worked out here at once; more (no heights from the server) are worked out in slices. */
const AT_ONCE = 40;
const SLICE_MS = 8;

type RCard = CanvasCard & { item: Item; flash: boolean; editing: boolean };
type Sized = { w: number; h: number };
/** Where a card's geometry comes from: the server's (with its height), or worked out here. */
type GeoSource = "server" | Geo;

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

  // Card sizes: the server's while they hold (same content, same names
  // looked up), else worked out here, at once for a few (an edit), in slices
  // for many (no heights from the server).
  const worked = useRef(new Map<Key, { item: Item; names: unknown; size: Sized; geo: Geo }>());
  const [workedTick, setWorkedTick] = useState(0);
  const geoSource = useRef(new Map<Key, GeoSource>());
  const computed = useMemo(() => {
    const out = new Map<Key, Sized>();
    const src = new Map<Key, GeoSource>();
    const todo: { key: Key; it: Item }[] = [];
    const server = s.heights?.build === LAYOUT ? s.heights.cards : null;
    for (const { key, it } of ordered) {
      const rec = server?.[key];
      if (holds(rec, it.entry, !!it.meta?.edited, names)) {
        out.set(key, { w: rec.w, h: rec.h });
        src.set(key, "server");
        continue;
      }
      const w = worked.current.get(key);
      if (w && w.item === it && w.names === names) {
        out.set(key, w.size);
        src.set(key, w.geo);
      } else todo.push({ key, it });
    }
    if (todo.length <= AT_ONCE)
      for (const { key, it } of todo) {
        const r = cardHeight(key, it.entry, it.meta, names);
        const size = { w: r.w, h: r.h };
        const geo = geoOf(r.ops);
        worked.current.set(key, { item: it, names, size, geo });
        out.set(key, size);
        src.set(key, geo);
      }
    geoSource.current = src;
    return out;
  }, [ordered, names, s.heights, workedTick]);
  useEffect(() => {
    const todo = ordered.filter(({ key }) => !computed.has(key));
    if (!todo.length) return;
    let stop = false;
    const ch = new MessageChannel();
    let last = performance.now();
    ch.port1.onmessage = () => {
      if (stop) return;
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < SLICE_MS) {
        const { key, it } = todo.shift()!;
        const r = cardHeight(key, it.entry, it.meta, names);
        worked.current.set(key, { item: it, names, size: { w: r.w, h: r.h }, geo: geoOf(r.ops) });
      }
      if (!todo.length || performance.now() - last > 1000) {
        last = performance.now();
        setWorkedTick((n) => n + 1);
      }
      if (todo.length) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
    return () => {
      stop = true;
      ch.port1.close();
    };
  }, [computed]);

  const widthFor = (key: string, e: Entry) => computed.get(key)?.w ?? widthOf(e);
  const heightOf = (key: string): number | undefined => computed.get(key)?.h;
  // What the canvas starts from.
  const known = useMemo(() => {
    const m = new Map<string, Size>();
    for (const [key, sz] of computed) m.set(key, sz);
    return m;
  }, [computed]);

  // Laid out again only when a card's slot changes (not on every measurement).
  const lastLayout = useRef<{ regionDefs: unknown; ordered: unknown; hs: number[]; layout: ReturnType<typeof layoutRegions> } | null>(null);
  const layout = useMemo(() => {
    const hs = ordered.map(({ key }) => heightOf(key) ?? EST_H);
    const last = lastLayout.current;
    if (last && last.regionDefs === regionDefs && last.ordered === ordered && last.hs.length === hs.length && last.hs.every((h, i) => Math.abs(h - hs[i]) < 0.5))
      return last.layout;
    const l = layoutRegions(
      regionDefs.map((r) => ({ id: r.id, columns: r.columns })),
      ordered.map(({ key, it, region }, i) => ({ id: key, region, w: widthFor(key, it.entry), h: hs[i] })),
      { columnWidth: COL, gap: GAP, padding: 32, regionGap: 240, rowWidth: 16000, aspect: 1.5 },
    );
    lastLayout.current = { regionDefs, ordered, hs, layout: l };
    return l;
  }, [regionDefs, ordered, computed]);

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
      const w = widthFor(key, it.entry);
      const h = computed.get(key)?.h;
      const flash = s.flash.has(key);
      const editing = editingKey === key;
      const old = cache.current.get(key);
      const c =
        old && old.item === it && old.x === pos.x && old.y === pos.y && old.w === w && old.h === (h ?? EST_H) && old.flash === flash && old.editing === editing
          ? old
          : { id: key, x: pos.x, y: pos.y, w, h: h ?? EST_H, label: it.entry.name, item: it, flash, editing };
      next.set(key, c);
      out.push(c);
    }
    cache.current = next;
    return out;
  }, [ordered, layout, computed, s.flash, editingKey]);

  // Regions are where the layout puts their cards; a card moved elsewhere stays where it was put.
  const regions: CanvasRegion[] = useMemo(
    () => regionDefs.map((r) => ({ id: r.id, title: r.title, icon: r.icon, ...(layout.regions.get(r.id) ?? { x: 0, y: 0, w: COL, h: COL }) })),
    [regionDefs, layout],
  );

  // Wires: archetypes and tables to every table they roll on (the topmost visible pack's).
  const allWires: CanvasWire[] = useMemo(() => {
    const out: CanvasWire[] = [];
    for (const { key, it } of ordered) {
      if (it.entry.kind !== "archetype" && it.entry.kind !== "table") continue;
      for (const t of rollTargets(it.entry)) {
        const pack = compendium.origin.get(`table/${t}`);
        if (!pack) continue;
        const to = keyOf(pack, "table", t);
        if (to !== key) out.push({ from: key, to, class: "rw" });
      }
    }
    return out;
  }, [ordered, compendium]);

  // Shown only in context: the selected card's wires, and the hovered card's (all of them at once are a tangle).
  const [hovered, setHovered] = useState<Key | null>(null);
  const wires = useMemo(
    () => (selected || hovered ? allWires.filter((w) => w.from === selected || w.to === selected || w.from === hovered || w.to === hovered) : []),
    [allWires, selected, hovered],
  );

  // A card an entry names: selected, and brought into view at the same zoom (a click never zooms).
  const go = useCallback(
    (kind: RefKind, id: string) => {
      const pack = compendium.origin.get(`${kind}/${id}`);
      if (!pack) return;
      const key = keyOf(pack, kind, id);
      setSelected(key);
      api.current?.flyTo(key, { keepZoom: true });
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
          minHeight={c.h}
          actions={stableActions}
        />
      );
    },
    [names, go, signedIn, stableActions],
  );

  // Cards too small to read: drawn from their geometry (the server's, decoded once, or worked out here;
  // in WebKit always here, in its own lines: card-height.tsx).
  const decoded = useRef({ of: null as unknown, geos: new Map<Key, Geo | null>() });
  const ownGeo = useRef({ names: null as unknown, geos: new Map<Key, { item: Item; geo: Geo }>() });
  const geometry = s.heights && s.geometry?.version === s.heights.version && s.geometry.build === LAYOUT ? s.geometry : null;
  const drawCard = useCallback(
    (g: CanvasRenderingContext2D, c: CanvasCard, scale: number) => {
      if (WEBKIT) {
        const it = (c as RCard).item;
        if (ownGeo.current.names !== names) ownGeo.current = { names, geos: new Map() };
        let own = ownGeo.current.geos.get(c.id);
        if (own?.item !== it) {
          own = { item: it, geo: geoOf(cardHeight(c.id, it.entry, it.meta, names, true).ops) };
          ownGeo.current.geos.set(c.id, own);
        }
        drawGeo(g, own.geo, scale, c.h);
        return;
      }
      const src = geoSource.current.get(c.id);
      let geo: Geo | null | undefined = src === "server" ? undefined : src;
      if (src === "server" && geometry) {
        if (decoded.current.of !== geometry) decoded.current = { of: geometry, geos: new Map() };
        geo = decoded.current.geos.get(c.id);
        if (geo === undefined) {
          const str = geometry.cards[c.id];
          try {
            geo = str === undefined ? null : decodeGeo(str, geometry.looks);
          } catch {
            geo = null;
          }
          decoded.current.geos.set(c.id, geo);
        }
      }
      if (geo) drawGeo(g, geo, scale, c.h);
      else drawBlank(g, c.w, c.h ?? EST_H);
    },
    [geometry, names],
  );

  // Device pixels per CSS pixel (a window moved to another screen changes it).
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const mq = matchMedia(`(resolution: ${dpr}dppx)`);
    const on = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [dpr]);


  // A card named in the address (#<pack>:<kind>/<id>) is shown once every card has its size (the layout has settled).
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
            drawCard={drawCard}
            placeholderBelow={readableAt(dpr)}
            overscan={OVERSCAN}
            wires={wires}
            wireMarks
            onHover={setHovered as (id: string | null) => void}
            regions={regions}
            selected={selected}
            onSelect={setSelected}
            initialSizes={known}
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
