// The rules canvas (/rules): every entry of every shown book as a card on
// one canvas, laid out as shelves (./shelves.ts, docs/CANVAS.md): a region
// per kind across the books (./regions.ts), the book's groups as labelled
// shelves, cards A–Z down their columns. Positions are worked out here, from
// the cards' sizes (./sizes.ts: the server's heights, else worked out here),
// whenever the shown books change; the card under the view's centre (or the
// selected one) stays where it was. What a card shows follows the zoom:
// far out, each region's A–Z index of names (a name flies to its card);
// nearer, each card's drawing (./greek.ts) under its title in large text;
// once readable, the card itself. An article's cards carry its mark
// (./marks.ts). Wires join the selected card to the tables it rolls on and
// the cards that roll on it, at right angles along the gutters. Signed in,
// cards can be edited, created and deleted; edits from others arrive live
// and the changed card is highlighted.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Menu, Plus, ScrollText } from "lucide-preact";
import type { PageData } from "../../shared/api.ts";
import { buildCompendium, type PackEntries } from "../../shared/rules/compendium.ts";
import type { Entry } from "../../shared/rules/schema.ts";
import { Canvas, intersects, type CanvasApi, type CanvasCard, type CanvasRegion, type CanvasWire, type Point, type Rect, type View } from "../canvas/index.ts";
import { AccountButton } from "../components/account/AccountButton.tsx";
import { L as B } from "../builder/labels.ts";
import { account } from "../lib/account.ts";
import { useStore } from "../lib/store.ts";
import { decodeGeo, geoOf, type Geo } from "../../shared/layout/paint.ts";
import { Card, type CardActions } from "./Card.tsx";
import { ctxOf, namesOf, rollTargets, type RefKind } from "./ctx.ts";
import { Editor, type EditTarget } from "./edit/Editor.tsx";
import { HistoryPanel } from "./History.tsx";
import { KIND_ICON, KIND_LABEL } from "./chips/index.ts";
import { cardHeight, LAYOUT, WEBKIT } from "./card-height.tsx";
import { drawBlank, drawGeo, resetColours, X_HEIGHT } from "./greek.ts";
import { holds, widthOf } from "./sizes.ts";
import { L } from "./labels.ts";
import { drawMark, marksOf } from "./marks.ts";
import { connect, keyOf, load, parseKey, rules, type Item, type Key } from "./model.ts";
import { PacksMenu } from "./Packs.tsx";
import { BASE_PACK, REGIONS, regionOf, shelfOf, shelfRanker } from "./regions.ts";
import { SearchBox } from "./Search.tsx";
import { anchorOf, emWidth, indexAt, indexLayout, keepStill, layoutShelves, route, wrap, type RegionIndex, type ShelfLayout } from "./shelves.ts";
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
/** Drawn text (the index, titles, shelf labels) shows once it's this many CSS pixels: 9px text, the smallest UI text there is. */
const MIN_TEXT_PX = 9;
/** A drawn card's title, in world pixels: from zoom 0.25 (MIN_TEXT_PX), where the regions' indexes give way to it. */
const TITLE_PX = 36;
const TITLE_K = MIN_TEXT_PX / TITLE_PX;
/** A shelf label's size on screen (CSS px), within what its band above the shelf holds. */
const LABEL_SCREEN_PX = 16;
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

/** The page's colours (tokens), for what's drawn: read once, again when the theme changes. */
type Inks = { ink: string; ink2: string; accent: string; wire: string; surface: string; region: string; font: string };
function readInks(): Inks {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { ink: v("--ink", "#ddd"), ink2: v("--ink-2", "#aaa"), accent: v("--accent", "#c33"), wire: v("--wire", "#888"), surface: v("--surface", "#222"), region: v("--surface-2", "#1a1a1a"), font: v("--font", "sans-serif") };
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
  const [active, setActiveState] = useState<string>(() => readLocal(ACTIVE_KEY) ?? BASE_PACK);
  const setActive = (id: string) => {
    setActiveState(id);
    writeLocal(ACTIVE_KEY, id);
  };
  const activePack = s.packs.some((p) => p.id === active) ? active : s.packs[0]?.id ?? BASE_PACK;

  const visiblePacks = useMemo(() => s.packs.filter((p) => !hidden.has(p.id)), [s.packs, hidden]);
  const packName = useMemo(() => new Map(s.packs.map((p) => [p.id, p.name])), [s.packs]);
  const marks = useMemo(() => marksOf(s.packs), [s.packs]);

  // Entries of the shown books.
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

  // Card sizes: the server's while they hold (same content, same names
  // looked up), else worked out here (rendering the card into the layout
  // engine's own DOM: never while this renders, which would leave Preact's
  // hooks pointing nowhere), at once for a few (an edit, a book hidden), in
  // slices for many (no heights from the server).
  const worked = useRef(new Map<Key, { item: Item; names: unknown; size: Sized; geo: Geo }>());
  const [workedTick, setWorkedTick] = useState(0);
  const geoSource = useRef(new Map<Key, GeoSource>());
  const computed = useMemo(() => {
    const out = new Map<Key, Sized>();
    const src = new Map<Key, GeoSource>();
    const server = s.heights?.build === LAYOUT ? s.heights.cards : null;
    for (const [key, it] of visible) {
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
      }
    }
    geoSource.current = src;
    return out;
  }, [visible, names, s.heights, workedTick]);
  const work = (key: Key, it: Item) => {
    const r = cardHeight(key, it.entry, it.meta, names);
    worked.current.set(key, { item: it, names, size: { w: r.w, h: r.h }, geo: geoOf(r.ops) });
  };
  useLayoutEffect(() => {
    const todo = visible.filter(([key]) => !computed.has(key));
    if (!todo.length) return;
    // A few: before the browser paints.
    if (todo.length <= AT_ONCE) {
      for (const [key, it] of todo) work(key, it);
      setWorkedTick((n) => n + 1);
      return;
    }
    let stop = false;
    const ch = new MessageChannel();
    let last = performance.now();
    ch.port1.onmessage = () => {
      if (stop) return;
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < SLICE_MS) {
        const [key, it] = todo.shift()!;
        work(key, it);
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
  const pendingSizes = visible.some(([key]) => !computed.has(key));

  const sizeOf = (key: string, e: Entry): Sized => computed.get(key) ?? { w: widthOf(e), h: EST_H };
  const heightOf = (key: string): number | undefined => computed.get(key)?.h;
  // What the canvas starts from.
  const known = useMemo(() => new Map(computed), [computed]);

  // Shelves in book order (from every book, so hiding one doesn't reorder them).
  const shelfRank = useMemo(
    () => shelfRanker([...s.items.values()], s.packs.map((p) => p.id), (id) => packName.get(id) ?? id),
    [s.items, s.packs, packName],
  );
  // The layout: again only when a card's slot changes (not on every measurement).
  const lastLayout = useRef<{ visible: unknown; key: string; layout: ShelfLayout } | null>(null);
  const layout = useMemo(() => {
    const cards = visible.map(([key, it]) => {
      const sz = sizeOf(key, it.entry);
      return { id: key, region: regionOf(it.entry), shelf: shelfOf(it.entry, packName.get(it.pack) ?? it.pack), name: it.entry.name, w: sz.w, h: sz.h };
    });
    const key = cards.map((c) => `${c.id}:${c.w}:${Math.round(c.h * 2)}:${c.shelf}:${c.name}`).join("|");
    const last = lastLayout.current;
    if (last && last.key === key) return last.layout;
    const l = layoutShelves(REGIONS, cards, { shelfRank });
    lastLayout.current = { visible, key, layout: l };
    return l;
  }, [visible, computed, shelfRank, packName]);

  const [selected, setSelected] = useState<Key | null>(null);
  const [panel, setPanel] = useState<{ mode: "edit"; target: EditTarget } | { mode: "history"; key: Key } | null>(null);
  const editingKey = panel?.mode === "edit" ? panel.target.key : null;

  // Card objects, reused while nothing about them changes (so only changed cards re-render). Tab order: shelf by shelf, A–Z.
  const cache = useRef(new Map<Key, RCard>());
  const cards = useMemo(() => {
    const next = new Map<Key, RCard>();
    const out: RCard[] = [];
    for (const sh of layout.shelves)
      for (const key of sh.ids) {
        const it = s.items.get(key);
        if (!it) continue;
        const pos = layout.positions.get(key) ?? { x: 0, y: 0 };
        const sz = sizeOf(key, it.entry);
        const flash = s.flash.has(key);
        const editing = editingKey === key;
        const old = cache.current.get(key);
        const c =
          old && old.item === it && old.x === pos.x && old.y === pos.y && old.w === sz.w && old.h === sz.h && old.flash === flash && old.editing === editing
            ? old
            : { id: key, x: pos.x, y: pos.y, w: sz.w, h: sz.h, label: it.entry.name, item: it, flash, editing };
        next.set(key, c);
        out.push(c);
      }
    cache.current = next;
    return out;
  }, [layout, s.items, s.flash, editingKey]);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const regions: CanvasRegion[] = useMemo(
    () => REGIONS.filter((r) => layout.regions.has(r.id)).map((r) => ({ id: r.id, title: r.title, icon: r.icon, ...layout.regions.get(r.id)! })),
    [layout],
  );

  // Each region's A–Z index (far out): over the region, below its top padding.
  const indexes = useMemo(() => {
    const out = new Map<string, RegionIndex>();
    for (const [id, r] of layout.regions) {
      const pad = layout.o.padding;
      const groups = layout.shelves.filter((sh) => sh.region === id).map((sh) => ({ label: sh.label, items: sh.ids.map((k) => ({ id: k, name: s.items.get(k)?.entry.name ?? k })) }));
      out.set(id, indexLayout({ x: r.x + pad, y: r.y + pad, w: r.w - 2 * pad, h: r.h - 2 * pad }, groups));
    }
    return out;
  }, [layout, s.items]);
  // Titles' lines, per card (cached by name and width).
  const titles = useRef(new Map<string, string[]>());
  const titleOf = (c: RCard) => {
    const k = `${c.w}|${c.label}`;
    let t = titles.current.get(k);
    if (!t) titles.current.set(k, (t = wrap(c.label ?? "", TITLE_PX, c.w - 24 - (marks.has(c.item.pack) ? 24 : 0))));
    return t;
  };

  // Wires: the selected card to every table it rolls on, and every card that rolls on it (the topmost shown book's), along the gutters.
  const wires: CanvasWire[] = useMemo(() => {
    if (!selected) return [];
    const it = s.items.get(selected);
    if (!it || !layout.positions.has(selected)) return [];
    const rectOf = (id: string): Rect | null => {
      const c = cardById.get(id);
      return c ? { x: c.x, y: c.y, w: c.w, h: c.h ?? EST_H } : null;
    };
    const keyFor = (kind: RefKind, id: string) => {
      const pack = compendium.origin.get(`${kind}/${id}`);
      return pack ? keyOf(pack, kind, id) : null;
    };
    const pairs: [Key, Key][] = [];
    for (const t of rollTargets(it.entry)) {
      const to = keyFor("table", t);
      if (to && to !== selected) pairs.push([selected, to]);
    }
    if (it.entry.kind === "table" && keyFor("table", it.entry.id) === selected)
      for (const [kind, id] of names.rolledBy(it.entry.id)) {
        const from = keyFor(kind, id);
        if (from && from !== selected) pairs.push([from, selected]);
      }
    return pairs.map(([from, to]) => ({ from, to, class: "rw", points: route(layout, from, to, rectOf) ?? undefined }));
  }, [selected, layout, cardById, compendium, names, s.items]);

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
      const mark = marks.get(rc.item.pack);
      const book = packName.get(rc.item.pack) ?? rc.item.pack;
      return (
        <>
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
          {mark && <span class="rc-mark" role="img" aria-label={book} title={book} style={{ maskImage: mark.css, WebkitMaskImage: mark.css }} />}
        </>
      );
    },
    [names, go, signedIn, stableActions, marks, packName],
  );

  // Cards too small to read: drawn from their geometry (the server's, decoded once, or worked out here;
  // in WebKit always here, in its own lines: card-height.tsx), with their book's mark.
  const decoded = useRef({ of: null as unknown, geos: new Map<Key, Geo | null>() });
  const ownGeo = useRef({ names: null as unknown, geos: new Map<Key, { item: Item; geo: Geo }>() });
  const geometry = s.heights && s.geometry?.version === s.heights.version && s.geometry.build === LAYOUT ? s.geometry : null;
  const inks = useRef<Inks | null>(null);
  const drawCard = useCallback(
    (g: CanvasRenderingContext2D, c: CanvasCard, scale: number) => {
      const it = (c as RCard).item;
      if (WEBKIT) {
        if (ownGeo.current.names !== names) ownGeo.current = { names, geos: new Map() };
        let own = ownGeo.current.geos.get(c.id);
        if (own?.item !== it) {
          own = { item: it, geo: geoOf(cardHeight(c.id, it.entry, it.meta, names, true).ops) };
          ownGeo.current.geos.set(c.id, own);
        }
        drawGeo(g, own.geo, scale, c.h);
      } else {
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
      }
      const mark = marks.get(it.pack);
      if (mark && 9 * scale >= 1) {
        g.fillStyle = (inks.current ??= readInks()).ink2;
        drawMark(g, mark, c.w - 14, (c.h ?? EST_H) - 14, 9);
      }
    },
    [geometry, names, marks],
  );

  // Over the drawn cards, every frame (in device pixels, text at whole pixel
  // sizes so glyphs are reused while zooming): far out, each region's index
  // over it, once legible; nearer, the shelves' labels and each drawn card's
  // title over its top. The index gives way to the titles at the same zoom.
  // (The selected card and those its wires join are picked out in the index.)
  const linked = useMemo(() => new Set(wires.flatMap((w) => [w.from, w.to])), [wires]);
  const drawState = useRef({ layout, indexes, cards, marks, titleOf, selected, linked });
  drawState.current = { layout, indexes, cards, marks, titleOf, selected, linked };
  const drawOver = useCallback((g: CanvasRenderingContext2D, v: View, vis: Rect, dpr: number, drawn: (id: string) => boolean) => {
    const { layout: l, indexes: ix, cards: cs, marks: mk, titleOf: tOf, selected: sel, linked: lk } = drawState.current;
    const c = (inks.current ??= readInks());
    const k = v.k, s = k * dpr;
    const X = (x: number) => (x * k + v.x) * dpr, Y = (y: number) => (y * k + v.y) * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.textBaseline = "alphabetic";
    const indexed = new Set<string>();
    if (k < TITLE_K)
      for (const [id, r] of l.regions) {
        const idx = ix.get(id);
        if (!idx || idx.size * k < MIN_TEXT_PX || !intersects(r, vis)) continue;
        indexed.add(id);
        const pad = l.o.padding;
        g.globalAlpha = 0.94;
        g.fillStyle = c.region;
        g.fillRect(X(r.x + pad / 2), Y(r.y + pad / 2), (r.w - pad) * s, (r.h - pad) * s);
        g.globalAlpha = 1;
        const px = Math.max(1, Math.round(idx.size * s));
        const base = idx.size * 0.95;
        for (const it of idx.items) {
          if (it.y + idx.line < vis.y || it.y > vis.y + vis.h || it.x + it.w < vis.x || it.x - idx.size > vis.x + vis.w) continue;
          if (it.heading) {
            g.font = `700 ${px}px ${c.font}`;
            g.fillStyle = c.ink2;
          } else {
            g.font = `500 ${px}px ${c.font}`;
            if (it.id && (it.id === sel || lk.has(it.id))) {
              // As the card's outline: the selected one filled, those its wires join outlined.
              const r = { x: X(it.x - idx.size * 0.2), y: Y(it.y + idx.size * 0.05), w: (Math.min(it.w, emWidth(it.name) * idx.size) + idx.size * 0.4) * s, h: idx.size * 1.2 * s };
              g.beginPath();
              g.roundRect?.(r.x, r.y, r.w, r.h, idx.size * 0.25 * s);
              if (it.id === sel) {
                g.globalAlpha = 0.35;
                g.fillStyle = c.accent;
                g.fill();
                g.globalAlpha = 1;
              } else {
                g.strokeStyle = c.wire;
                g.lineWidth = Math.max(1, dpr);
                g.stroke();
              }
            }
            g.fillStyle = c.ink;
            const m = it.id ? mk.get(packOfKey(it.id)) : undefined;
            if (m) {
              g.fillStyle = c.ink2;
              drawMark(g, m, X(it.x - idx.size * 0.85), Y(it.y + base - idx.size * 0.62), idx.size * 0.6 * s);
              g.fillStyle = c.ink;
            }
          }
          g.fillText(it.name, X(it.x), Y(it.y + base), Math.max(1, it.w * s));
        }
      }
    // Shelf labels in the band above their cards, at a steady size on screen within what the band holds.
    const o = l.o;
    const fs = Math.min(o.labelH * 0.6, Math.max(20, LABEL_SCREEN_PX / k));
    if (fs * k >= MIN_TEXT_PX) {
      g.font = `600 ${Math.round(fs * s)}px ${c.font}`;
      g.fillStyle = c.ink2;
      for (const sh of l.shelves) {
        if (!sh.label || indexed.has(sh.region)) continue;
        const band = { x: sh.x, y: sh.top - o.labelH, w: Math.max(sh.w, 2 * o.labelH), h: o.labelH };
        if (!intersects(band, vis)) continue;
        g.fillText(sh.label, X(sh.x), Y(sh.top - o.gap - 0.3 * fs), Math.max(1, (l.regions.get(sh.region)!.x + l.regions.get(sh.region)!.w - o.padding - sh.x) * s));
      }
    }
    // Titles of drawn cards, over their tops.
    if (k >= TITLE_K) {
      const px = Math.round(TITLE_PX * s);
      g.font = `600 ${px}px ${c.font}`;
      for (const card of cs) {
        const h = card.h ?? EST_H;
        if (card.x > vis.x + vis.w || card.x + card.w < vis.x || card.y > vis.y + vis.h || card.y + h < vis.y || !drawn(card.id)) continue;
        const lines = tOf(card);
        const lh = TITLE_PX * 1.2;
        const bh = Math.min(h, lines.length * lh + 20);
        g.fillStyle = c.surface;
        g.fillRect(X(card.x), Y(card.y + 3), card.w * s, (bh - 3) * s);
        g.fillStyle = c.ink;
        lines.forEach((t, i) => g.fillText(t, X(card.x + 12), Y(card.y + 10 + lh * i + TITLE_PX * 0.95), Math.max(1, (card.w - 24) * s)));
        const m = mk.get(card.item.pack);
        if (m) {
          g.fillStyle = c.ink2;
          drawMark(g, m, X(card.x + card.w - 12 - 18), Y(card.y + 10 + TITLE_PX * 0.3), 18 * s);
        }
      }
    }
  }, []);
  // Cards under a legible index: it shows them (no outline or wire over it).
  const covered = useCallback((id: string, v: View): boolean => {
    if (v.k >= TITLE_K) return false;
    const { layout: l, indexes: ix } = drawState.current;
    const p = l.place.get(id);
    const idx = p && ix.get(l.shelves[p.shelf].region);
    return !!idx && idx.size * v.k >= MIN_TEXT_PX;
  }, []);
  // The index's names are links to their cards.
  const linkAt = useCallback((p: Point, v: View): string | null => {
    if (v.k >= TITLE_K) return null;
    const { layout: l, indexes: ix } = drawState.current;
    for (const [id, r] of l.regions) {
      if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
      const idx = ix.get(id);
      if (!idx || idx.size * v.k < MIN_TEXT_PX) return null;
      return indexAt(idx, p)?.id ?? null;
    }
    return null;
  }, []);
  const onLink = useCallback((key: string) => {
    setSelected(key);
    show(api.current, key);
  }, []);
  // Drawn colours follow the theme.
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => {
      inks.current = null;
      resetColours();
    };
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  // Device pixels per CSS pixel (a window moved to another screen changes it).
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const mq = matchMedia(`(resolution: ${dpr}dppx)`);
    const on = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [dpr]);

  // Showing or hiding a book: the card under the view's centre (or the
  // selected one, in view) stays where it is on screen, also while the
  // cards whose sizes that changes are worked out.
  const anchor = useRef<{ id: string; at: Point } | null>(null);
  const toggleHidden = (id: string) => {
    const n = new Set(hidden);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    const a = api.current;
    if (a) {
      const sizeOfId = (k: string) => {
        const c = cardById.get(k);
        return c ? { w: c.w, h: c.h ?? EST_H } : null;
      };
      const stays = (k: string) => !n.has(parseKey(k).pack);
      const v = a.getView();
      const at = anchorOf(layout.positions, sizeOfId, stays, v, a.size(), selected);
      const p = at ? layout.positions.get(at)! : null;
      anchor.current = at && p ? { id: at, at: { x: p.x * v.k + v.x, y: p.y * v.k + v.y } } : null;
    }
    setHidden(n);
    writeLocal(HIDDEN_KEY, JSON.stringify([...n]));
  };
  useLayoutEffect(() => {
    const at = anchor.current;
    const a = api.current;
    if (!at || !a) return;
    const to = layout.positions.get(at.id);
    if (to) {
      const v = a.getView();
      a.setView(keepStill(v, { x: (at.at.x - v.x) / v.k, y: (at.at.y - v.y) / v.k }, to));
    }
    if (!pendingSizes) anchor.current = null;
  }, [layout]);

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

  // A new entry: of a kind, in the active pack; laid out on its shelf.
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

  // Search: the shown cards by name; choosing one selects it and flies there.
  const searchable = useMemo(
    () => cards.map((c) => ({ key: c.id, name: c.label ?? "", kind: c.item.entry.kind, mark: marks.get(c.item.pack) ?? null, book: packName.get(c.item.pack) ?? c.item.pack })),
    [cards, marks, packName],
  );
  const pick = useCallback((key: Key) => {
    setSelected(key);
    show(api.current, key);
  }, []);

  const labels = useMemo(() => ({ zoomIn: L.zoomIn, zoomOut: L.zoomOut, fit: L.fit, minimap: L.minimap, canvas: L.canvas }), []);

  // The bar: on the left the same controls, in the same places, as the builder's
  // (characters on narrow screens, home, +, rules); the region tabs; then search, books and account.
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
      <SearchBox cards={searchable} onPick={pick} />
      <PacksMenu packs={s.packs} hidden={hidden} onToggle={toggleHidden} active={activePack} onActive={setActive} signedIn={signedIn} marks={marks} />
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
            drawOver={drawOver}
            linkAt={linkAt}
            covered={covered}
            onLink={onLink}
            placeholderBelow={readableAt(dpr)}
            overscan={OVERSCAN}
            wires={wires}
            wireMarks
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

/** A card key's pack. */
const packOfKey = (key: string) => key.slice(0, key.indexOf(":"));

export { parseKey };
