// The rules page (/rules): a tab per kind across every shown book
// (./regions.ts: Character Archetypes, Talents & Exotic Abilities, …), each
// one ordinary scrolling page of its shelves (the book's groups, ./shelves.ts
// groupShelves) with their cards A–Z, in columns on a wide screen and one
// column on a phone (./book.ts masonry). A sidebar holds the tab's Table of
// Contents: the shelves and their cards' names; a name scrolls to its card,
// and the reader's place is picked out. Links between cards (a chip's
// reference, a table's "Rolled on by") switch tab if need be, scroll to the
// card and flash it; every card has its address (#<pack>:<kind>/<id>), so
// back, forward and shared links work. The packs menu filters the books; an
// entry an article overrides shows once (the article's, as the builder has
// it), and a name another book's card on the tab shares is listed with its
// book's (./book.ts listNames). Search finds a card by name. Signed in,
// cards can be edited, created and deleted; edits from others arrive live.
//
// Speed: cards skip layout and paint off screen (content-visibility, sized
// by their worked-out heights: ./sizes.ts, the server's /rules/heights), and
// a tab mounts the cards in and near view at once, the rest a frame's worth
// at a time, nearest first. Tabs once shown stay mounted, hidden.
// (This replaced the rules canvas, ./RulesCanvas.tsx, shelved in November
// 2026: docs/CANVAS.md.)
import { Component, type ComponentChildren } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Plus } from "lucide-preact";
import type { PageData } from "../../shared/api.ts";
import { buildCompendium, type PackEntries } from "../../shared/rules/compendium.ts";
import type { Entry } from "../../shared/rules/schema.ts";
import { MenuToggle, SiteBar } from "../components/SiteBar.tsx";
import { account } from "../lib/account.ts";
import { useStore } from "../lib/store.ts";
import { byDistance, cardAt, columnsIn, hashOf, linkTarget, listNames, masonry, parseHash, shortName, winners } from "./book.ts";
import { Card, type CardActions } from "./Card.tsx";
import { cardHeight, LAYOUT } from "./card-height.tsx";
import { KIND_ICON, KIND_LABEL } from "./chips/index.ts";
import { ctxOf, namesOf, type Ctx, type Names, type RefKind } from "./ctx.ts";
import { blankEntry } from "./edit/blank.ts";
import { Editor, type EditTarget } from "./edit/Editor.tsx";
import { HistoryPanel } from "./History.tsx";
import { L } from "./labels.ts";
import { connect, load, rules, type Item, type Key } from "./model.ts";
import { PacksMenu } from "./Packs.tsx";
import { BASE_PACK, REGIONS, regionOf, shelfOf, shelfRanker } from "./regions.ts";
import { SearchBox } from "./Search.tsx";
import { groupShelves, type ShelfGroup } from "./shelves.ts";
import { COL, depsHash, depValue, GAP, holds, widthOf } from "./sizes.ts";
import "./rules.css";
import "./book.css";

const EST_H = 200;
const HIDDEN_KEY = "inquisitor:rules-hidden-packs";
const ACTIVE_KEY = "inquisitor:rules-active-pack";
const TAB_KEY = "inquisitor:rules-tab";
const TOC_KEY = "inquisitor:rules-toc";
/** Wide enough for the Table of Contents beside the cards; narrower, it lies over them. */
const WIDE_MQ = "(min-width: 900px)";
/** Cards worked out here at once; more (no heights from the server) are worked out in slices. */
const AT_ONCE = 40;
const SLICE_MS = 8;
/** Room around a card's slot for its shadow, flash and selection outline (a slot clips its paint off screen). */
const PAD = 6;
/** Time a frame may spend mounting cards (ms). */
const MOUNT_MS = 6;
const PULSE_MS = 1800;

type Deadline = { timeRemaining(): number };
/** Calls back when the browser is idle (Safari has no requestIdleCallback: soon after, with a short budget). */
const whenIdle = (f: (d: Deadline) => void): number =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 2000 }) : window.setTimeout(() => f({ timeRemaining: () => 5 }), 32);
const cancelIdle = (h: number) => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(h) : clearTimeout(h));

/** A card's size, and the names it looks up in other entries (./sizes.ts), when known. */
type Sized = { w: number; h: number; d?: string[] };
/** `sig`: what the card shows of other entries (the names it looks up, as they are now): a card is drawn again only when this or its entry changes. */
/** `label`: its name in the Table of Contents (with its book's, where another book's card on the tab has the same name). */
type BookCard = { id: Key; region: string; shelf: string; name: string; label: string; w: number; h: number; item: Item; sig: string };

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
const wide = () => typeof matchMedia === "function" && matchMedia(WIDE_MQ).matches;

/** Card sizes: the server's while they hold (same content, same names looked up), else worked out here (as the canvas did). */
function useCardSizes(visible: [Key, Item][], names: Names, heights: ReturnType<typeof rules.get>["heights"]) {
  const worked = useRef(new Map<Key, { item: Item; names: unknown; size: Sized }>());
  const [tick, setTick] = useState(0);
  const computed = useMemo(() => {
    const out = new Map<Key, Sized>();
    const server = heights?.build === LAYOUT ? heights.cards : null;
    for (const [key, it] of visible) {
      const rec = server?.[key];
      if (holds(rec, it.entry, !!it.meta?.edited, names)) {
        out.set(key, { w: rec.w, h: rec.h, d: rec.d });
        continue;
      }
      const w = worked.current.get(key);
      if (w && w.item === it && w.names === names) out.set(key, w.size);
    }
    return out;
  }, [visible, names, heights, tick]);
  useLayoutEffect(() => {
    const todo = visible.filter(([key]) => !computed.has(key));
    if (!todo.length) return;
    const work = (key: Key, it: Item) => {
      const r = cardHeight(key, it.entry, it.meta, names, false, false);
      worked.current.set(key, { item: it, names, size: { w: r.w, h: r.h, d: r.d } });
    };
    if (todo.length <= AT_ONCE) {
      for (const [key, it] of todo) work(key, it);
      setTick((n) => n + 1);
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
        setTick((n) => n + 1);
      }
      if (todo.length) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
    return () => {
      stop = true;
      ch.port1.close();
    };
  }, [computed]);
  return computed;
}

export function RulesBook({ data }: { data: PageData }) {
  void data;
  const s = useStore(rules);
  const { signedIn } = useStore(account);

  useEffect(() => {
    void load();
    return connect();
  }, []);

  // --- books ------------------------------------------------------------------
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
  const toggleHidden = (id: string) => {
    const n = new Set(hidden);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setHidden(n);
    writeLocal(HIDDEN_KEY, JSON.stringify([...n]));
  };

  const visiblePacks = useMemo(() => s.packs.filter((p) => !hidden.has(p.id)), [s.packs, hidden]);
  const packName = useMemo(() => new Map(s.packs.map((p) => [p.id, p.name])), [s.packs]);
  const packShort = useMemo(() => new Map(s.packs.map((p) => [p.id, shortName(p)])), [s.packs]);
  const inShown = useMemo(() => {
    const vis = new Set(visiblePacks.map((p) => p.id));
    return [...s.items].filter(([, it]) => vis.has(it.pack));
  }, [s.items, visiblePacks]);
  const compendium = useMemo(() => {
    const stack: PackEntries[] = visiblePacks.map((pack) => ({ pack, entries: [] }));
    const byPack = new Map(stack.map((p) => [p.pack.id, p]));
    for (const [, it] of inShown) byPack.get(it.pack)?.entries.push(it.entry);
    return buildCompendium(stack);
  }, [inShown, visiblePacks]);
  // An entry an article overrides shows once, as the compendium has it (hide the article to see the book's).
  const visible = useMemo(() => winners(inShown, compendium.origin), [inShown, compendium]);
  const labels = useMemo(
    () => listNames(visible.map(([key, it]) => ({ key, name: it.entry.name, tab: regionOf(it.entry), pack: it.pack, book: packShort.get(it.pack) ?? it.pack }))),
    [visible, packShort],
  );
  const names = useMemo(() => namesOf(compendium), [compendium]);
  const sizes = useCardSizes(visible, names, s.heights);

  // --- tabs and shelves -------------------------------------------------------
  const shelfRank = useMemo(
    () => shelfRanker([...s.items.values()], s.packs.map((p) => p.id), (id) => packName.get(id) ?? id),
    [s.items, s.packs, packName],
  );
  const cardCache = useRef(new Map<Key, BookCard>());
  const byTab = useMemo(() => {
    const next = new Map<Key, BookCard>();
    const cards = visible.map(([key, it]) => {
      const sz: Sized = sizes.get(key) ?? { w: widthOf(it.entry), h: EST_H };
      const shelf = shelfOf(it.entry, packName.get(it.pack) ?? it.pack);
      const sig = sz.d ? depsHash(sz.d.map((d) => depValue(names, d))) : "";
      const label = labels.get(key) ?? it.entry.name;
      const old = cardCache.current.get(key);
      const c = old && old.item === it && old.w === sz.w && old.h === sz.h && old.shelf === shelf && old.sig === sig && old.label === label
        ? old
        : { id: key, region: regionOf(it.entry), shelf, name: it.entry.name, label, w: sz.w, h: sz.h, item: it, sig };
      next.set(key, c);
      return c;
    });
    cardCache.current = next;
    const out = new Map<string, ShelfGroup<BookCard>[]>(REGIONS.map((r) => [r.id, []]));
    for (const g of groupShelves(REGIONS, cards, shelfRank)) out.get(g.region)!.push(g);
    return out;
  }, [visible, sizes, shelfRank, packName, names, labels]);
  const tabOfKey = useCallback((key: Key) => {
    const it = rules.get().items.get(key);
    return it ? regionOf(it.entry) : null;
  }, []);
  const tabIds = useMemo(() => REGIONS.map((r) => r.id), []);

  // (A card in the address is shown once the rules are in, below.)
  const [tab, setTabState] = useState<string>(() => {
    const p = parseHash(location.hash, () => null, tabIds);
    const saved = readLocal(TAB_KEY);
    return p?.tab ?? (saved && tabIds.includes(saved) ? saved : REGIONS[0].id);
  });
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [shown, setShown] = useState<Set<string>>(() => new Set([tab]));
  // Tabs whose cards are all mounted. Once the tab shown is, the others are made ready one by one in idle time, so a switch only shows them.
  const [complete, setComplete] = useState<ReadonlySet<string>>(new Set());
  const onDone = useCallback((t: string) => setComplete((c) => (c.has(t) ? c : new Set(c).add(t))), []);
  const working = complete.has(tab) ? REGIONS.find((r) => shown.has(r.id) && !complete.has(r.id))?.id ?? null : null;
  const scrollOf = useRef(new Map<string, number>());
  /** Where a tab should scroll once shown: a card (and flash it), or its last place. */
  const [focus, setFocus] = useState<{ tab: string; key: Key | null; n: number } | null>(null);
  const focusN = useRef(0);

  const [selected, setSelected] = useState<Key | null>(null);
  const [pulse, setPulse] = useState<Key | null>(null);
  useEffect(() => {
    if (!pulse) return;
    const t = setTimeout(() => setPulse(null), PULSE_MS);
    return () => clearTimeout(t);
  }, [pulse]);

  /** Shows a tab (at its last place) or a card (its tab, scrolled to it). */
  const show = useCallback(
    (to: { tab: string; key: Key | null }, opts: { push?: boolean; flash?: boolean } = {}) => {
      if (tabRef.current !== to.tab) scrollOf.current.set(tabRef.current, window.scrollY);
      tabRef.current = to.tab;
      setTabState(to.tab);
      writeLocal(TAB_KEY, to.tab);
      setShown((sh) => (sh.has(to.tab) ? sh : new Set(sh).add(to.tab)));
      setFocus({ tab: to.tab, key: to.key, n: ++focusN.current });
      if (to.key) {
        setSelected(to.key);
        if (opts.flash) setPulse(to.key);
      }
      if (opts.push !== false) {
        const h = hashOf(to);
        if (location.hash !== h) history.pushState(null, "", `${location.pathname}${location.search}${h}`);
      }
    },
    [],
  );
  const goKey = useCallback(
    (key: Key, opts: { push?: boolean; flash?: boolean } = {}) => {
      const t = tabOfKey(key);
      if (t) show({ tab: t, key }, opts);
    },
    [show, tabOfKey],
  );

  // A card a chip names: its tab, scrolled to, flashed. (Stable: the cards keep it.)
  const compRef = useRef(compendium);
  compRef.current = compendium;
  const go = useCallback(
    (kind: RefKind, id: string) => {
      const key = linkTarget(compRef.current.origin, kind, id);
      if (key) goKey(key, { flash: true });
    },
    [goKey],
  );

  // The address: on load (once the rules are in), and on back / forward.
  const openedHash = useRef(false);
  useEffect(() => {
    if (openedHash.current || !s.loaded) return;
    openedHash.current = true;
    const p = parseHash(location.hash, tabOfKey, tabIds);
    if (p?.key && s.items.has(p.key)) goKey(p.key, { push: false, flash: true });
    else if (p) show(p, { push: false });
    // No address: the tab shown gets one, so coming back to it works.
    else history.replaceState(null, "", `${location.pathname}${location.search}${hashOf({ tab: tabRef.current, key: null })}`);
  }, [s.loaded]);
  useEffect(() => {
    history.scrollRestoration = "manual";
    const on = () => {
      const p = parseHash(location.hash, tabOfKey, tabIds);
      if (p) show(p, { push: false, flash: !!p.key });
    };
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, [show, tabOfKey, tabIds]);
  // A card chosen by a click is the address too (without a new history entry).
  const select = useCallback((key: Key) => {
    setSelected(key);
    const t = tabOfKey(key);
    if (t) history.replaceState(null, "", `${location.pathname}${location.search}${hashOf({ tab: t, key })}`);
  }, [tabOfKey]);

  useEffect(() => {
    if (!s.loaded || !complete.has(tab) || working) return;
    const next = REGIONS.find((r) => !shown.has(r.id));
    if (!next) return;
    const h = whenIdle(() => setShown((sh) => new Set(sh).add(next.id)));
    return () => cancelIdle(h);
  }, [s.loaded, complete, shown, tab, working]);

  // --- the Table of Contents --------------------------------------------------
  const [tocOpen, setTocOpen] = useState<boolean>(() => {
    const v = readLocal(TOC_KEY);
    return v === null ? wide() : v === "1" && wide();
  });
  const setToc = (open: boolean) => {
    setTocOpen(open);
    writeLocal(TOC_KEY, open ? "1" : "0");
  };
  // Each shown tab's, once it has been opened (kept, hidden, like the tabs' pages).
  const tocs = useRef(new Map<string, HTMLElement | null>());
  const tocEver = useRef(false);
  if (tocOpen) tocEver.current = true;
  const atRef = useRef<Key | null>(null);
  /** The reader's place, picked out in the Table of Contents (straight in the DOM: no re-render while scrolling). */
  const onAt = useCallback((key: Key | null) => {
    atRef.current = key;
    const toc = tocs.current.get(tabRef.current);
    if (!toc) return;
    toc.querySelector('[aria-current="location"]')?.removeAttribute("aria-current");
    if (!key) return;
    const a = toc.querySelector<HTMLElement>(`a[data-key="${CSS.escape(key)}"]`);
    if (!a) return;
    a.setAttribute("aria-current", "location");
    const top = a.offsetTop, bottom = top + a.offsetHeight;
    if (top < toc.scrollTop + 40 || bottom > toc.scrollTop + toc.clientHeight - 40) toc.scrollTop = top - toc.clientHeight / 3;
  }, []);
  useLayoutEffect(() => onAt(atRef.current), [tocOpen, tab, byTab]);

  // --- editing ----------------------------------------------------------------
  const [panel, setPanel] = useState<{ mode: "edit"; target: EditTarget } | { mode: "history"; key: Key } | null>(null);
  const editingKey = panel?.mode === "edit" ? panel.target.key : null;
  const actions = useRef<CardActions>({ edit: () => {}, history: () => {} });
  actions.current.edit = (key) => {
    const it = rules.get().items.get(key);
    if (it) setPanel({ mode: "edit", target: { key, pack: it.pack, entry: it.entry, base: it.meta?.commit ?? null, isNew: false } });
  };
  actions.current.history = (key) => setPanel({ mode: "history", key });
  const stableActions = useMemo<CardActions>(() => ({ edit: (k) => actions.current.edit(k), history: (k) => actions.current.history(k) }), []);
  const [newOpen, setNewOpen] = useState(false);
  const newEntry = (kind: Entry["kind"]) => {
    setNewOpen(false);
    setPanel({ mode: "edit", target: { key: null, pack: activePack, entry: blankEntry(kind), base: null, isNew: true } });
  };
  const closePanel = useCallback(() => setPanel(null), []);
  const onSaved = useCallback((key: Key) => {
    setPanel(null);
    setTimeout(() => goKey(key, { flash: true }), 50);
  }, [goKey]);

  // --- cards ------------------------------------------------------------------
  // renderCard doesn't change with the names (every edit makes new ones): a card is drawn again when its
  // entry or what it looks up changes (BookCard.sig), and then reads the names as they are.
  const ctxCache = useMemo(() => ({ names, ctx: new WeakMap<Entry, Ctx>() }), [names]);
  const ctxRef = useRef(ctxCache);
  ctxRef.current = ctxCache;
  const renderCard = useCallback(
    (c: BookCard, st: { selected: boolean; flash: boolean; editing: boolean; minHeight?: number }) => {
      const e = c.item.entry;
      const cache = ctxRef.current;
      let ctx = cache.ctx.get(e);
      if (!ctx) {
        ctx = { ...ctxOf(e, cache.names), go };
        cache.ctx.set(e, ctx);
      }
      return <Card cardKey={c.id} entry={e} meta={c.item.meta} ctx={ctx} selected={st.selected} signedIn={signedIn} editing={st.editing} flash={st.flash} minHeight={st.minHeight} actions={stableActions} />;
    },
    [go, signedIn, stableActions],
  );

  // The content's width (the masonry's columns follow it).
  const mainRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.loaded]);
  const [barH, setBarH] = useState(93);

  // Search: every shown card by name; choosing one shows it.
  const searchable = useMemo(
    () => visible.map(([key, it]) => ({ key, name: it.entry.name, label: labels.get(key) ?? it.entry.name, kind: it.entry.kind, book: packName.get(it.pack) ?? it.pack })),
    [visible, packName, labels],
  );
  const pick = useCallback((key: Key) => goKey(key, { flash: true }), [goKey]);
  const tocPick = useCallback(
    (key: Key) => {
      goKey(key);
      if (!wide()) setToc(false);
    },
    [goKey],
  );

  const tabFocus = focus?.tab === tab ? focus : null;

  return (
    <div class={`rb${tocOpen ? " toc-open" : ""}${panel ? " has-panel" : ""}`} style={{ "--bar-h": `${barH}px` }}>
      <SiteBar page="rules" onHeight={setBarH}>
        <MenuToggle label={L.contents} open={tocOpen} onToggle={() => setToc(!tocOpen)} />
        <nav class="site-scroll rb-tabs">
          {REGIONS.map((r) => {
            const I = r.icon;
            return (
              <button
                type="button"
                class="rb-tab"
                aria-label={r.title}
                title={r.title}
                aria-current={r.id === tab ? "page" : undefined}
                onClick={() => show({ tab: r.id, key: null })}
              >
                <I size={18} aria-hidden="true" />
                <span class="rb-tab-name" aria-hidden="true">{r.title}</span>
              </button>
            );
          })}
        </nav>
        <span class="site-end">
          <SearchBox cards={searchable} onPick={pick} />
          <PacksMenu packs={s.packs} hidden={hidden} onToggle={toggleHidden} active={activePack} onActive={setActive} signedIn={signedIn} />
          {signedIn && (
            <div class="menu-wrap">
              <button type="button" class="icon-btn" aria-label={L.newEntry} title={L.newEntry} aria-expanded={newOpen} onClick={() => setNewOpen(!newOpen)}>
                <Plus size={20} aria-hidden="true" />
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
        </span>
      </SiteBar>
      <div class="rb-body">
        {tocOpen && <div class="rb-backdrop" onClick={() => setToc(false)} />}
        {tocEver.current &&
          REGIONS.filter((r) => shown.has(r.id)).map((r) => (
            <Toc key={r.id} tab={r.id} shown={tocOpen && r.id === tab} shelves={byTab.get(r.id) ?? []} onPick={tocPick} navs={tocs.current} />
          ))}
        <div class="rb-main" ref={mainRef} aria-busy={!s.loaded}>
          {s.loaded &&
            width > 0 &&
            REGIONS.filter((r) => shown.has(r.id)).map((r) => (
              <TabPage
                key={r.id}
                shelves={byTab.get(r.id) ?? []}
                current={r.id === tab}
                width={width}
                barH={barH}
                focus={r.id === tab ? tabFocus : null}
                savedY={scrollOf.current}
                work={r.id === working}
                onDone={onDone}
                tab={r.id}
                renderCard={renderCard}
                selected={selected}
                flash={s.flash}
                pulse={pulse}
                editing={editingKey}
                onSelect={select}
                onAt={r.id === tab ? onAt : null}
              />
            ))}
        </div>
      </div>
      {panel && (
        <div class="rb-panel">
          {panel.mode === "edit" ? (
            <Editor key={panel.target.key ?? "new"} target={panel.target} names={names} onClose={closePanel} onSaved={onSaved} />
          ) : (
            <HistoryPanel key={panel.key} cardKey={panel.key} names={names} signedIn={signedIn} onClose={closePanel} />
          )}
        </div>
      )}
    </div>
  );
}

// --- the Table of Contents ------------------------------------------------------

type TocProps = {
  tab: string;
  shown: boolean;
  shelves: ShelfGroup<BookCard>[];
  onPick: (key: Key) => void;
  navs: Map<string, HTMLElement | null>;
};

class Toc extends Component<TocProps> {
  shouldComponentUpdate(n: TocProps) {
    return n.shown !== this.props.shown || n.shelves !== this.props.shelves || n.onPick !== this.props.onPick;
  }
  render() {
    const p = this.props;
    return (
      <nav
        class={`rb-toc${p.shown ? "" : " rb-away"}`}
        aria-hidden={p.shown ? undefined : "true"}
        aria-label={L.contents}
        ref={(el) => {
          p.navs.set(p.tab, el);
        }}
      >
        {p.shelves.map((sh) => (
          <section>
            {sh.label && <h2>{sh.label}</h2>}
            <ul>
              {sh.cards.map((c) => (
                  <li>
                    <a
                      href={`#${encodeURIComponent(c.id)}`}
                      data-key={c.id}
                      onClick={(e) => {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        p.onPick(c.id);
                      }}
                    >
                      {c.label}
                    </a>
                  </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    );
  }
}

// --- a tab's page ---------------------------------------------------------------

type CardState = { selected: boolean; flash: boolean; editing: boolean; minHeight?: number };
type TabProps = {
  tab: string;
  shelves: ShelfGroup<BookCard>[];
  current: boolean;
  width: number;
  barH: number;
  focus: { key: Key | null; n: number } | null;
  /** Each tab's last scroll position. */
  savedY: Map<string, number>;
  /** Mount its cards in idle time though it isn't shown (the tabs are made ready one after another). */
  work: boolean;
  onDone: (tab: string) => void;
  renderCard: (c: BookCard, st: CardState) => ComponentChildren;
  selected: Key | null;
  flash: ReadonlyMap<Key, number>;
  pulse: Key | null;
  editing: Key | null;
  onSelect: (key: Key) => void;
  onAt: ((key: Key | null) => void) | null;
};

/** A card's height in a column `w` wide: its own (worked out at its own width), or, narrower, about as much more as it's narrower. */
const heightAt = (c: BookCard, w: number) => (w >= c.w ? c.h : Math.round((c.h * c.w) / w));

function TabPage(p: TabProps) {
  // One column (a phone, a tablet upright): every card the page's width, its height only estimated until it's
  // drawn; in columns, each at its own width (as worked out) unless the page is narrower.
  const flow = columnsIn(p.width) === 1;
  // Heights cards turned out to have, drawn, where that isn't what was worked out or estimated.
  const [real, setReal] = useState<ReadonlyMap<Key, number>>(new Map());
  const realWidth = useRef(p.width);
  if (realWidth.current !== p.width) {
    realWidth.current = p.width;
    if (real.size) setReal(new Map());
  }
  const { layouts, hs } = useMemo(() => {
    const hs = new Map<Key, number>();
    const layouts = p.shelves.map((sh) =>
      masonry(
        sh.cards.map((c) => {
          const h = real.get(c.id) ?? heightAt(c, flow ? p.width : Math.min(c.w, p.width));
          hs.set(c.id, h);
          return { id: c.id, w: flow ? p.width : c.w, h };
        }),
        p.width,
      ),
    );
    return { layouts, hs };
  }, [p.shelves, p.width, flow, real]);
  const inner = flow ? p.width : Math.max(0, ...layouts.map((l) => l.w), columnsIn(p.width) * (COL + GAP) - GAP);
  const cardsById = useMemo(() => new Map(p.shelves.flatMap((sh) => sh.cards.map((c) => [c.id, c] as const))), [p.shelves]);

  const shelfEls = useRef<(HTMLElement | null)[]>([]);
  const slotEl = (key: Key) => document.querySelector<HTMLElement>(`.rb-tab-page[data-tab="${p.tab}"] [data-key="${CSS.escape(key)}"]`);
  /** Every card's top and height on the page (document coordinates). */
  const tops = () => {
    const out: { id: Key; top: number; h: number }[] = [];
    p.shelves.forEach((sh, i) => {
      const el = shelfEls.current[i];
      if (!el) return;
      const base = el.getBoundingClientRect().top + window.scrollY;
      const l = layouts[i];
      for (const c of sh.cards) {
        const at = l.pos.get(c.id)!;
        out.push({ id: c.id, top: base + at.y, h: hs.get(c.id)! });
      }
    });
    return out;
  };

  // Mounting: the cards in and near view at once; while this is the tab shown, each frame those coming
  // near (a frame's worth); the rest in idle time, nearest first (a tab not shown: in reading order), as
  // many as the time left allows, each card's cost reckoned from the batches so far.
  const [mounted, setMounted] = useState<ReadonlySet<Key>>(new Set());
  const add = (keys: Key[]) => setMounted((m) => (keys.every((k) => m.has(k)) ? m : new Set([...m, ...keys])));
  // Every card mounted, and every height not known ahead measured.
  const ready = useMemo(() => p.shelves.every((sh) => sh.cards.every((c) => mounted.has(c.id) && ((!flow && c.w <= p.width) || real.has(c.id)))), [p.shelves, mounted, real, flow, p.width]);
  const near = (y: number) => {
    const vh = window.innerHeight;
    return tops().filter((t) => t.top + t.h >= y - vh / 2 && t.top <= y + vh * 1.5).map((t) => t.id);
  };
  const cost = useRef({ perCard: 3, t0: 0, n: 0 });
  useLayoutEffect(() => {
    const c = cost.current;
    if (!c.t0) return;
    c.perCard = 0.7 * c.perCard + 0.3 * Math.max(0.2, (performance.now() - c.t0) / c.n);
    c.t0 = 0;
  }, [mounted]);
  useEffect(() => {
    if (!p.current && !p.work) return;
    const unmounted = () => p.shelves.flatMap((sh) => sh.cards.filter((c) => !mounted.has(c.id)).map((c) => c.id));
    if (!unmounted().length) {
      if (ready) p.onDone(p.tab);
      return;
    }
    const mount = (keys: Key[], budget: number) => {
      if (!keys.length) return;
      const n = Math.min(keys.length, Math.max(1, Math.floor(budget / cost.current.perCard)));
      Object.assign(cost.current, { t0: performance.now(), n });
      add(keys.slice(0, n));
    };
    const nearest = () => {
      const y = window.scrollY;
      return byDistance(tops().filter((t) => !mounted.has(t.id)), y, y + window.innerHeight);
    };
    let raf = 0, idle = 0;
    const later = () => (idle = whenIdle((d) => mount(p.current ? nearest() : unmounted(), d.timeRemaining() - 1)));
    if (p.current)
      raf = requestAnimationFrame(() => {
        const close = new Set(near(window.scrollY));
        const urgent = nearest().filter((k) => close.has(k));
        if (urgent.length) mount(urgent, MOUNT_MS);
        else later();
      });
    else later();
    return () => {
      cancelAnimationFrame(raf);
      cancelIdle(idle);
    };
  }, [p.current, p.work, mounted, layouts, ready]);

  // Becoming the current tab, or asked to show a card: mount what's in view and scroll there, before the browser paints;
  // then keep the card at the top while the cards above it settle (a phone's are only estimated until mounted), unless the reader scrolls.
  // The cards in view are drawn in that first frame ("awake"): left to themselves (content-visibility: auto), the
  // browser would find them on screen only a frame later, after a frame of blank slots.
  const [awake, setAwake] = useState<ReadonlySet<Key>>(new Set());
  useEffect(() => {
    if (!awake.size) return;
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setAwake(new Set()))));
    return () => cancelAnimationFrame(raf);
  }, [awake]);
  useLayoutEffect(() => {
    if (!p.current) return;
    const key = p.focus?.key && cardsById.has(p.focus.key) ? p.focus.key : null;
    const t = key ? tops().find((x) => x.id === key) : null;
    const y = t ? t.top - p.barH - 12 : key ? window.scrollY : p.savedY.get(p.tab) ?? 0;
    const inView = near(y);
    add(inView);
    setAwake(new Set(inView));
    window.scrollTo(0, y);
    if (!key) return;
    // The card has the focus, so the keyboard goes on into it (its quote, history and edit buttons).
    slotEl(key)?.focus({ preventScroll: true });
    let n = 0, still = 0, raf = 0;
    const events = ["wheel", "touchstart", "keydown", "pointerdown"];
    const stop = () => {
      cancelAnimationFrame(raf);
      for (const ev of events) removeEventListener(ev, stop, true);
    };
    for (const ev of events) addEventListener(ev, stop, { capture: true, passive: true });
    const fix = () => {
      const el = slotEl(key);
      if (el) {
        const d = el.getBoundingClientRect().top + PAD - (p.barH + 12);
        if (Math.abs(d) > 1 && window.scrollY + d >= 0) {
          window.scrollBy(0, d);
          still = 0;
        } else still++;
      }
      if (still < 3 && ++n < 60) raf = requestAnimationFrame(fix);
      else stop();
    };
    raf = requestAnimationFrame(fix);
    return stop;
  }, [p.current, p.focus?.n]);
  // The reader's place: the last card (in A–Z order) whose top has passed under the bar.
  useEffect(() => {
    const onAt = p.onAt;
    if (!p.current || !onAt) return;
    let raf = 0, last: Key | null | undefined;
    const update = () => {
      raf = 0;
      const at = cardAt(tops(), window.scrollY + p.barH + 48);
      if (at !== last) onAt((last = at));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", on);
      removeEventListener("resize", on);
    };
  }, [p.current, p.onAt, layouts, p.barH]);

  // Cards whose height isn't known ahead (one column; a card made narrower than it was worked out for) are
  // laid out once as they're mounted, even out of view ("fresh": not skipped), and their height kept: their
  // columns make room. If that moves what's in view (a card above it changed), the page scrolls by as much,
  // so nothing on screen moves. A card drawn later at another height (edited, say) is kept the same way.
  const exact = (c: BookCard) => !flow && c.w <= p.width;
  const sizing = useRef({ cardsById, hs, exact, current: p.current, barH: p.barH });
  sizing.current = { cardsById, hs, exact, current: p.current, barH: p.barH };
  const anchor = useRef<{ key: Key; top: number } | null>(null);
  const observed = useRef<{ ro: ResizeObserver; els: WeakSet<Element> } | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      const { cardsById: cs, hs: h0, exact: ex, current, barH } = sizing.current;
      const add: [Key, number][] = [];
      const vh = window.innerHeight;
      for (const en of entries) {
        const el = en.target as HTMLElement;
        const c = cs.get(el.dataset.key!);
        if (!c || !el.firstElementChild || ex(c)) continue;
        // A card off screen and not fresh is skipped: its size is only the one it was given.
        const r = el.getBoundingClientRect();
        if (!el.classList.contains("fresh") && !(current && r.bottom > -vh && r.top < 2 * vh)) continue;
        const h = (en.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight) - 2 * PAD;
        if (!realRef.current.has(c.id) || Math.abs(h - (h0.get(c.id) ?? h)) > 0.5) add.push([c.id, h]);
      }
      if (!add.length) return;
      if (current) {
        const first = [...document.querySelectorAll<HTMLElement>(`.rb-tab-page[data-tab="${p.tab}"] .rb-card`)].find((el) => el.getBoundingClientRect().bottom > barH);
        anchor.current = first ? { key: first.dataset.key!, top: first.getBoundingClientRect().top } : null;
      }
      setReal((g) => new Map([...g, ...add]));
    });
    observed.current = { ro, els: new WeakSet() };
    return () => {
      ro.disconnect();
      observed.current = null;
    };
  }, []);
  const realRef = useRef(real);
  realRef.current = real;
  useLayoutEffect(() => {
    const o = observed.current;
    if (!o) return;
    for (const el of document.querySelectorAll<HTMLElement>(`.rb-tab-page[data-tab="${p.tab}"] .rb-card`))
      if (el.firstElementChild && !o.els.has(el)) {
        o.els.add(el);
        o.ro.observe(el);
      }
  }, [mounted]);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const el = a && slotEl(a.key);
    if (!a || !el) return;
    const d = el.getBoundingClientRect().top - a.top;
    if (Math.abs(d) > 0.5) window.scrollBy(0, d);
  }, [layouts]);

  // A tab not shown is being made ready (mounted and measured out of sight, inert from the start, while it's
  // still small: inert on a big page costs WebKit tens of milliseconds), then put away (content-visibility:
  // hidden: not drawn, not focusable, quick to show again).
  const making = useRef(!p.current);
  if (making.current && (p.current || ready)) making.current = false;
  return (
    <div
      class={`rb-tab-page${p.current ? "" : making.current ? " rb-making" : " rb-away"}`}
      data-tab={p.tab}
      aria-hidden={p.current ? undefined : "true"}
      inert={making.current}
      style={{ width: `${inner}px` }}
    >
      {p.shelves.map((sh, i) => {
        const l = layouts[i];
        return (
          <section class="rb-shelf">
            {sh.label && <h2 class="rb-shelf-name">{sh.label}</h2>}
            <div
              class="rb-cards"
              ref={(el) => {
                shelfEls.current[i] = el;
              }}
              style={{ height: `${l.h}px` }}
            >
              {sh.cards.map((c) => {
                const at = l.pos.get(c.id)!;
                return (
                  <Slot
                    key={c.id}
                    card={c}
                    x={at.x}
                    y={at.y}
                    w={at.w}
                    h={hs.get(c.id)!}
                    exact={exact(c)}
                    mounted={mounted.has(c.id)}
                    fresh={mounted.has(c.id) && ((!exact(c) && !real.has(c.id)) || awake.has(c.id))}
                    selected={p.selected === c.id}
                    flash={p.flash.has(c.id) || p.pulse === c.id}
                    editing={p.editing === c.id}
                    render={p.renderCard}
                    onSelect={p.onSelect}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type SlotProps = {
  card: BookCard;
  /** Where it is in the shelf's columns. */
  x: number;
  y: number;
  w: number;
  /** Its height as worked out, or estimated. */
  h: number;
  /** The height is the worked-out one (the card at its own width): held as its least. */
  exact: boolean;
  mounted: boolean;
  /** Drawn whether or not the browser thinks it's on screen: its height isn't known yet (laid out though off screen, to
   * learn it), or it's in view as its tab is shown. */
  fresh: boolean;
  selected: boolean;
  flash: boolean;
  editing: boolean;
  render: TabProps["renderCard"];
  onSelect: (key: Key) => void;
};

/** One card's slot: sized ahead (its content skipped off screen), its card once mounted. Re-renders only when what it shows changes. */
class Slot extends Component<SlotProps> {
  shouldComponentUpdate(n: SlotProps) {
    const o = this.props;
    return n.card !== o.card || n.x !== o.x || n.y !== o.y || n.w !== o.w || n.h !== o.h || n.mounted !== o.mounted || n.fresh !== o.fresh || n.selected !== o.selected || n.flash !== o.flash || n.editing !== o.editing || n.render !== o.render;
  }
  onClick = (e: MouseEvent) => {
    const t = e.target as Element;
    if (t.closest("button, a, input, select, textarea, [data-canvas-nodrag]")) return;
    if (getSelection()?.toString()) return;
    this.props.onSelect(this.props.card.id);
  };
  render() {
    const p = this.props;
    const style: Record<string, string> = {
      left: `${p.x - PAD}px`,
      top: `${p.y - PAD}px`,
      width: `${p.w + 2 * PAD}px`,
      // (Of the content box: inside the padding.)
      containIntrinsicBlockSize: `auto ${p.h}px`,
    };
    if (!p.mounted || p.exact) style.minHeight = `${p.h + 2 * PAD}px`;
    return (
      <div class={p.fresh ? "rb-card fresh" : "rb-card"} tabIndex={-1} data-key={p.card.id} data-selected={p.selected ? "" : undefined} style={style} onClick={this.onClick}>
        {p.mounted && <SlotBody card={p.card} selected={p.selected} flash={p.flash} editing={p.editing} minHeight={p.exact ? p.h : undefined} render={p.render} />}
      </div>
    );
  }
}

type BodyProps = CardState & { card: BookCard; render: TabProps["renderCard"] };

/** The card in a slot: re-rendered only when the card or its state changes, not when its slot moves. */
class SlotBody extends Component<BodyProps> {
  shouldComponentUpdate(n: BodyProps) {
    const o = this.props;
    return n.card !== o.card || n.selected !== o.selected || n.flash !== o.flash || n.editing !== o.editing || n.minHeight !== o.minHeight || n.render !== o.render;
  }
  render() {
    const p = this.props;
    return p.render(p.card, { selected: p.selected, flash: p.flash, editing: p.editing, minHeight: p.minHeight });
  }
}
