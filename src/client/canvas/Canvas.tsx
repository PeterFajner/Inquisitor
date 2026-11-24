// The infinite canvas (docs/CANVAS.md): cards at world positions, wires
// between them, titled regions, pan/zoom by pointer, touch, wheel and keys,
// a region tab bar, a minimap. Only cards near the viewport are mounted;
// below `placeholderBelow` zoom they are empty boxes. Panning and zooming
// move two layers by CSS transform without re-rendering; Preact re-renders
// only when the set of mounted cards has to change.
import { Component, render as renderInto, type ComponentChildren, type ComponentType, type CSSProperties, type Ref } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Map as MapIcon, Maximize, ZoomIn, ZoomOut } from "lucide-preact";
import {
  adaptCount, center, clamp, contains, easeInOut, fitView, flyPath, intersects, nextToMount, panBy, snap, toWorld, union, viewAt, visibleRect, wirePath, zoomAt,
  type Point, type Rect, type Side, type Size, type View, type ZoomLimits,
} from "./geometry.ts";
import { Minimap, type MinimapHandle } from "./Minimap.tsx";
import { tileLevel, Tiles } from "./tiles.ts";
import "./canvas.css";

// Every face the cards use, loaded before anything is measured: fonts load
// only when first used, so `document.fonts.ready` alone can resolve before
// the bold or italic faces arrive and the heights would be the fallback's.
const FACES = ["400 16px Ubuntu", "500 16px Ubuntu", "700 16px Ubuntu", "italic 400 16px Ubuntu", "italic 700 16px Ubuntu", "400 16px 'Ubuntu Mono'"];
const fontsLoaded = (): Promise<unknown> =>
  document.fonts ? Promise.all(FACES.map((f) => document.fonts.load(f).catch(() => []))).then(() => document.fonts.ready) : Promise.resolve();

export type CanvasCard = {
  id: string;
  /** World position of the card's top-left corner. */
  x: number;
  y: number;
  /** Width in world units (the card is laid out at this CSS width). */
  w: number;
  /** Estimated height until the card has been measured. */
  h?: number;
  /** Accessible name of the card (used on its placeholder too). */
  label?: string;
};

export type CanvasWire = {
  from: string;
  to: string;
  /** A route of its own (world points, first to last), drawn as straight lines with rounded turns, instead of a curve between facing sides. */
  points?: readonly Point[];
  fromSide?: Side;
  toSide?: Side;
  /** Extra class on the path (the default stroke is --wire). */
  class?: string;
  style?: string | CSSProperties;
};

export type CanvasRegion = {
  id: string;
  /** Shown over the region and as its tab's label: the caller's (the book's) words. */
  title: string;
  /** Its tab's icon; regions without one get no tab. */
  icon?: ComponentType<{ size?: number | string; "aria-hidden"?: boolean | "true" }>;
  x: number;
  y: number;
  w: number;
  h: number;
  class?: string;
};

export type CanvasLabels = { zoomIn: string; zoomOut: string; fit: string; minimap: string; canvas?: string };

export type FlyTarget = string | Rect | View;
export type FlyOptions = {
  /** Highest zoom to end at (default 1 for a card, the canvas max for a rect). */
  maxZoom?: number;
  /** Keep the current zoom and only pan (a card or point is centred). */
  keepZoom?: boolean;
  /** Screen pixels around the target. */
  pad?: number;
  instant?: boolean;
};

export type CanvasApi = {
  flyTo(target: FlyTarget, opts?: FlyOptions): void;
  fit(opts?: FlyOptions): void;
  zoomBy(factor: number, at?: Point): void;
  panBy(dx: number, dy: number): void;
  getView(): View;
  setView(v: View): void;
  /** A card's world rect (measured height when known). */
  rectOf(id: string): Rect | null;
  /** The screen size of the canvas. */
  size(): Size;
  /** Screen pixels at the top covered by the region tabs (fits and flights keep clear of them). */
  inset(): number;
};

export type CanvasProps = {
  cards: readonly CanvasCard[];
  /** Renders a card's content. Keep it stable (useCallback): cards re-render when it, their card object or selection changes. */
  renderCard: (card: CanvasCard, state: { selected: boolean }) => ComponentChildren;
  /** A cheaper rendering (fixed to the card's measured height) used below `cheapBelow` zoom, once the card has been measured. */
  renderCheap?: (card: CanvasCard, size: Size) => ComponentChildren;
  /** Below this (settled) zoom, measured cards use `renderCheap`. Default 0.5. */
  cheapBelow?: number;
  wires?: readonly CanvasWire[];
  regions?: readonly CanvasRegion[];
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Makes cards draggable; called on drop with the new (snapped) world position. */
  onMove?: (id: string, pos: Point) => void;
  /** Grid step for dragged cards. */
  snap?: number;
  /** Measure every card once (hidden, in idle batches), not only mounted ones. */
  measure?: boolean;
  /** Measured sizes (all known so far) whenever one changes (while measuring hidden, a few times a second). */
  onMeasure?: (sizes: ReadonlyMap<string, Size>) => void;
  /** Sizes known from before (e.g. a cache): taken as measured until the card is mounted and measured again. */
  initialSizes?: ReadonlyMap<string, Size>;
  initialView?: View | "fit";
  /** The view after it settles (debounced). */
  onViewChange?: (v: View) => void;
  minZoom?: number;
  maxZoom?: number;
  /** Below this zoom cards aren't mounted: they're drawn (drawCard), else empty boxes. Once mounted, they stay until the zoom is 10% below it. */
  placeholderBelow?: number;
  /**
   * Draws a card that isn't mounted, on the placeholder canvas: in world
   * units from its top-left corner, `scale` device pixels a world unit (draw
   * less when it's small). Cards are drawn ahead into tiles (./tiles.ts) a
   * few at a time; keep it stable: a new function redraws every card, and a
   * card is redrawn when its object, position or size changes. A card mounted
   * over its drawing fades in.
   */
  drawCard?: (g: CanvasRenderingContext2D, card: CanvasCard, scale: number) => void;
  /** Screen pixels around the viewport whose cards stay mounted. */
  overscan?: number;
  /**
   * Draws over the drawn cards and under the mounted ones, every frame: in
   * world units (the view's transform set), `vis` the visible world rect,
   * `drawn(id)` whether a card shows its drawing there (not mounted, or the
   * cards' layer is hidden). Keep it quick: it runs on every frame of a pan.
   */
  drawOver?: (g: CanvasRenderingContext2D, v: View, vis: Rect, dpr: number, drawn: (id: string) => boolean) => void;
  /** Something drawOver drew that is a link, under a world point: its target card's id (taps and clicks there call onLink, the pointer shows a hand). */
  linkAt?: (p: Point, v: View) => string | null;
  onLink?: (id: string) => void;
  /** Whether drawOver covers a card at this view (e.g. with an index): no selection outline, wire or wire mark is drawn for it. */
  covered?: (id: string, v: View) => boolean;
  /** Outline the cards at each wire's ends and point to those off screen (for a few wires at a time: the selected card's). */
  wireMarks?: boolean;
  /** The card under the mouse pointer (null when none), whenever it changes. */
  onHover?: (id: string | null) => void;
  minimap?: boolean;
  controls?: boolean;
  labels?: Partial<CanvasLabels>;
  /** With either, the region tabs sit in a full-width bar along the top, between these. */
  barStart?: ComponentChildren;
  barEnd?: ComponentChildren;
  apiRef?: Ref<CanvasApi>;
  class?: string;
};

// Preact 11 doesn't add "px" to numbers in style: every length below is a string.
// Placeholder words until the owner approves the controls' labels (AGENTS.md).
const LABELS: CanvasLabels = { zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Zoom to fit", minimap: "Minimap" };
const DEFAULT_H = 120;
// Size of the card names drawn on placeholders, in world pixels.
const LABEL_PX = 26;
// Milliseconds of rendering per frame (or idle slice) for mounting cards and hidden measuring.
const BUDGET = 8;
// Milliseconds a frame may spend mounting cards while a zoom is under way (cards kept ahead, below).
const ZOOM_BUDGET = 5;
// Cards mounted ahead while zooming in, from this fraction of the mount zoom, and the most kept mounted but hidden.
const AHEAD_FROM = 1 / 8;
const KEEP_MAX = 64;
const AHEAD_MAX_MS = 40;
const idle: (f: () => void) => void =
  typeof requestIdleCallback === "function" ? (f) => requestIdleCallback(f, { timeout: 200 }) : (f) => setTimeout(f, 16);
const KEY_PAN = 80;
// Room around the content on "fit": region titles sit above their regions, controls float over the edges.
const FIT_PAD = 64;
/** How long after the last zoom step the zoom counts as resting (cards are mounted again). */
const ZOOM_REST_MS = 150;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const CARD = ".cv-card, .cv-ph";
const INTERACTIVE = "button, a[href], input, select, textarea, label, summary, [contenteditable], [role=button], [data-canvas-nodrag]";
const HANDLE = "[data-canvas-handle]";

type Win = { rect: Rect; k: number; lod: boolean };
type WireLook = { stroke: string; width: number; dash: number[]; alpha: number };
/** What a mounted card shows: 1 its cheap rendering, 2 its full one (unmounted cards are placeholders). */
type Level = 1 | 2;
type Gesture =
  | { mode: "none" }
  | { mode: "pending-pan"; id: number; start: Point }
  | { mode: "pan"; id: number }
  | { mode: "pinch"; ids: [number, number]; v0: View; d0: number; mid0: Point }
  | { mode: "pending-card" | "card"; id: number; card: string; start: Point; origin: Point };

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export function Canvas(props: CanvasProps) {
  const {
    cards, renderCard, wires = [], regions = [], selected = null, placeholderBelow = 0.32,
  } = props;
  const labels = { ...LABELS, ...props.labels };
  const limits: ZoomLimits = { min: props.minZoom ?? 0.02, max: props.maxZoom ?? 2.5 };
  // The latest props, for handlers registered once.
  const P = useRef(props);
  P.current = props;
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  // The tabs' bottom edge: what a fit leaves clear at the top (read once per resize, not per fit).
  const insetRef = useRef(-1);
  const inset = () => {
    if (insetRef.current < 0) {
      const t = tabsRef.current;
      if (!t) return 0;
      insetRef.current = Math.max(0, t.offsetTop + t.offsetHeight - 8);
    }
    return insetRef.current;
  };
  // fitView below the tabs.
  const fitBelow = (r: Rect, s: Size, lim: ZoomLimits, pad: number): View => {
    const top = inset();
    const v = fitView(r, { w: s.w, h: Math.max(1, s.h - top) }, lim, pad);
    return { ...v, y: v.y + top };
  };
  const miniRef = useRef<MinimapHandle | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef<Size | null>(null);
  const winRef = useRef<Win | null>(null);
  // Card sizes: measured, else as given (initialSizes); `measured` holds only the measured ones.
  const sizes = useRef(new Map<string, Size>());
  const measured = useRef(new Map<string, Size>());
  const gesture = useRef<Gesture>({ mode: "none" });
  const pointers = useRef(new Map<number, Point>());
  const suppressClick = useRef(false);
  const flight = useRef(0);
  const movingTimer = useRef(0);
  const viewTimer = useRef(0);

  const [win, setWin] = useState<Win | null>(null);
  const [sizeTick, setSizeTick] = useState(0);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [mini, setMini] = useState(props.minimap ?? false);
  const [currentRegion, setCurrentRegion] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // The settled zoom is below cheapBelow.
  const [cheap, setCheap] = useState(false);
  // Mounted cards and what they show; cards are mounted (or switched between
  // cheap and full) a budget's worth per frame, those on screen first.
  const levels = useRef(new Map<string, Level>());
  const pending = useRef<{ id: string; rect: Rect; want: Level }[]>([]);
  // How many to mount per frame, per level (cheap cards are many times faster than full ones).
  const mountN = useRef<Record<Level, number>>({ 1: 1, 2: 1 });
  const mountLevel = useRef<Level>(2);
  const mountT0 = useRef(0);
  const mountFrame = useRef(0);
  const [, setMountTick] = useState(0);
  // Cards not mounted (all of them when zoomed out) are drawn as boxes on one
  // 2D canvas, redrawn with the view: hundreds of elements would cost the
  // browser's compositor time on every frame of a pan.
  const phCanvas = useRef<HTMLCanvasElement>(null);
  // Region titles and wire marks, over the cards.
  const topCanvas = useRef<HTMLCanvasElement>(null);
  const phList = useRef<Rect[]>([]);
  const phIds = useRef<string[]>([]);
  const phSelected = useRef(-1);
  const phColors = useRef<{ box: string; sel: string; ink: string; font: string } | null>(null);
  // Each region class's fill and border, as a .cv-region element with that class would have them.
  const regionLooks = useRef(new Map<string, { fill: string; line: string }>());
  const regionLook = (cls: string | undefined) => {
    const key = cls ?? "";
    let look = regionLooks.current.get(key);
    if (!look) {
      const root = rootRef.current;
      if (!root) return { fill: "transparent", line: "transparent" };
      const el = document.createElement("div");
      el.className = cls ? `cv-region cv-probe ${cls}` : "cv-region cv-probe";
      root.appendChild(el);
      const cs = getComputedStyle(el);
      look = { fill: cs.backgroundColor, line: cs.borderTopColor };
      el.remove();
      regionLooks.current.set(key, look);
    }
    return look;
  };
  // Cards drawn by the caller (drawCard), into tiles drawn when the main thread is idle.
  const tiles = useRef<Tiles | null>(null);
  if (props.drawCard && !tiles.current)
    tiles.current = new Tiles((g, id, scale) => {
      const c = byIdRef.current.get(id);
      if (c) P.current.drawCard?.(g, c, scale);
    });
  const drawnBy = useRef(props.drawCard);
  if (drawnBy.current !== props.drawCard) {
    drawnBy.current = props.drawCard;
    tiles.current?.invalidate();
  }
  const tileWork = useRef(0);
  // Cards mounted but hidden (visibility), over their drawings: mounted ahead
  // while zooming in, or kept after zooming out (most recently used last).
  // The whole layer of cards is hidden below the mount zoom (`hidRef`), so
  // crossing it shows what's mounted at once.
  const kept = useRef(new Map<string, number>());
  const keptTick = useRef(0);
  const hidRef = useRef(false);
  const setHid = (hid: boolean) => {
    if (hid === hidRef.current) return;
    hidRef.current = hid;
    worldRef.current?.classList.toggle("is-hid", hid);
  };
  const phLabels = useRef<(string | undefined)[]>([]);

  // Wires are drawn on the same canvas, under the boxes; each one styled as an SVG path with its class and style would be.
  const wireList = useRef<{ path: Path2D; box: Rect; look: WireLook; from: string; to: string }[]>([]);
  const hoverRef = useRef<string | null>(null);
  const looks = useRef(new Map<string, WireLook>());
  const lookOf = (w: CanvasWire): WireLook => {
    const style = typeof w.style === "string" ? w.style : w.style ? JSON.stringify(w.style) : "";
    const key = `${w.class ?? ""}|${style}`;
    let look = looks.current.get(key);
    if (!look) {
      const root = rootRef.current;
      if (!root) return { stroke: "#888", width: 1.5, dash: [], alpha: 1 };
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "cv-probe");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", w.class ? `cv-wire ${w.class}` : "cv-wire");
      if (typeof w.style === "string") path.setAttribute("style", w.style);
      else if (w.style) for (const [k, v] of Object.entries(w.style)) path.style.setProperty(k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), String(v));
      svg.appendChild(path);
      root.appendChild(svg);
      const cs = getComputedStyle(path);
      const dash = cs.strokeDasharray && cs.strokeDasharray !== "none" ? cs.strokeDasharray.split(/[ ,]+/).map(parseFloat).filter((n) => n >= 0) : [];
      look = { stroke: cs.stroke, width: parseFloat(cs.strokeWidth) || 1.5, dash, alpha: parseFloat(cs.opacity) || 1 };
      svg.remove();
      looks.current.set(key, look);
    }
    return look;
  };
  const drawFrame = useRef(0);
  const drawPh = useCallback(() => {
    drawFrame.current = 0;
    const cv = phCanvas.current, s = sizeRef.current;
    if (!cv || !s) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(s.w * dpr), H = Math.round(s.h * dpr);
    const top = topCanvas.current;
    for (const c of [cv, top]) {
      if (c && (c.width !== W || c.height !== H)) {
        c.width = W;
        c.height = H;
      }
    }
    const g = cv.getContext("2d");
    if (!g) return;
    if (!phColors.current) {
      const cs = getComputedStyle(cv);
      phColors.current = {
        box: cs.getPropertyValue("--cv-ph").trim() || cs.getPropertyValue("--line").trim() || "#444",
        sel: cs.getPropertyValue("--accent").trim() || "#c33",
        ink: cs.getPropertyValue("--ink-2").trim() || "#aaa",
        font: cs.getPropertyValue("--font").trim() || "sans-serif",
      };
    }
    const v = viewRef.current;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);
    const vis = visibleRect(v, s, 8);
    // Regions (as .cv-region: a border of 1 screen pixel, at least 1 world pixel; corners 12 world pixels, at least 8 on screen).
    const px = 1 / v.k;
    const bw = Math.max(1, px), rr = Math.max(12, 8 * px);
    g.lineWidth = bw;
    for (const r of P.current.regions ?? []) {
      if (!intersects(r, vis)) continue;
      const look = regionLook(r.class);
      g.beginPath();
      if (typeof g.roundRect === "function") g.roundRect(r.x + bw / 2, r.y + bw / 2, r.w - bw, r.h - bw, rr - bw / 2);
      else g.rect(r.x, r.y, r.w, r.h);
      g.fillStyle = look.fill;
      g.fill();
      g.strokeStyle = look.line;
      g.stroke();
    }
    const r = 12, round = r * v.k >= 1.5 && typeof g.roundRect === "function";
    const t = tiles.current;
    // Drawn cards: their tiles; plain boxes only where no tile is drawn yet.
    let clip: Rect[] | null = null;
    if (t) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      const T = P.current.placeholderBelow ?? 0.32;
      const { missing, pending } = t.paint(g, v, vis, dpr, tileLevel(T * dpr, 8) + 1);
      g.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);
      clip = missing;
      if (pending) scheduleTiles();
    }
    if (!clip || clip.length) {
      g.save();
      if (clip) {
        g.beginPath();
        for (const c of clip) g.rect(c.x, c.y, c.w, c.h);
        g.clip();
      }
      g.fillStyle = phColors.current.box;
      g.beginPath();
      phList.current.forEach((b, i) => {
        if ((!t && i === phSelected.current) || !intersects(b, vis) || (clip && !clip.some((c) => intersects(c, b)))) return;
        if (round) g.roundRect(b.x, b.y, b.w, b.h, r);
        else g.rect(b.x, b.y, b.w, b.h);
      });
      g.fill();
      g.restore();
    }
    // The caller's drawing over the drawn cards (titles, indexes), then wires over that (they run between cards).
    if (P.current.drawOver) {
      const mounted = levels.current, hid = hidRef.current;
      g.save();
      P.current.drawOver(g, v, vis, dpr, (id) => hid || !mounted.has(id));
      g.restore();
      g.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);
    }
    // Wires: widths and dashes in screen pixels (non-scaling, as the SVG strokes were).
    const covered = P.current.covered;
    for (const w of wireList.current) {
      if (!intersects(w.box, vis) || covered?.(w.from, v) || covered?.(w.to, v)) continue;
      g.strokeStyle = w.look.stroke;
      g.globalAlpha = w.look.alpha;
      g.lineWidth = w.look.width / v.k;
      g.setLineDash(w.look.dash.map((d) => d / v.k));
      g.stroke(w.path);
    }
    g.globalAlpha = 1;
    g.setLineDash([]);
    const sel = covered?.(phIds.current[phSelected.current], v) ? undefined : phList.current[phSelected.current];
    if (sel && t) {
      // As a mounted card's outline (canvas.css): 3px, 3px out.
      const px = 1 / v.k;
      g.strokeStyle = phColors.current.sel;
      g.lineWidth = 3 * px;
      g.beginPath();
      if (round) g.roundRect(sel.x - 4.5 * px, sel.y - 4.5 * px, sel.w + 9 * px, sel.h + 9 * px, r + 4.5 * px);
      else g.rect(sel.x - 4.5 * px, sel.y - 4.5 * px, sel.w + 9 * px, sel.h + 9 * px);
      g.stroke();
    } else if (sel) {
      g.fillStyle = phColors.current.sel;
      g.beginPath();
      if (round) g.roundRect(sel.x, sel.y, sel.w, sel.h, r);
      else g.rect(sel.x, sel.y, sel.w, sel.h);
      g.fill();
    }
    drawTop(v, vis, dpr);
    // Card names once they'd be legible (LABEL_PX world pixels, at least 7 on screen), unless the cards are drawn.
    if (!t && LABEL_PX * v.k >= 7) {
      g.fillStyle = phColors.current.ink;
      g.font = `600 ${LABEL_PX}px ${phColors.current.font}`;
      g.textBaseline = "top";
      phList.current.forEach((b, i) => {
        const t = phLabels.current[i];
        if (t && intersects(b, vis)) g.fillText(t, b.x + 12, b.y + 10, b.w - 24);
      });
    }
  }, []);
  // Over the cards: region titles (as .cv-region-title: 600 weight, 1.1 line
  // height, 0.3em above the region; 18 screen pixels, at least 28 world
  // pixels, at most a twelfth of the region's width), and with wireMarks the
  // cards at the drawn wires' ends outlined, or pointed to from the edge.
  function drawTop(v: View, vis: Rect, dpr: number) {
    const cv = topCanvas.current, s = sizeRef.current, c = phColors.current;
    const g = cv?.getContext("2d");
    if (!g || !s || !c) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv!.width, cv!.height);
    g.setTransform(v.k * dpr, 0, 0, v.k * dpr, v.x * dpr, v.y * dpr);
    g.fillStyle = c.ink;
    g.textBaseline = "alphabetic";
    for (const r of P.current.regions ?? []) {
      const fs = Math.max(28, Math.min(18 / v.k, r.w / 12));
      if (!intersects({ x: r.x, y: r.y - 1.4 * fs, w: r.w * 2, h: 1.4 * fs }, vis)) continue;
      g.font = `600 ${fs}px ${c.font}`;
      g.fillText(r.title, r.x, r.y - 0.48 * fs);
    }
    if (!P.current.wireMarks || !wireList.current.length) return;
    const px = 1 / v.k;
    const skip = new Set([P.current.selected ?? "", hoverRef.current ?? ""]);
    const done = new Set<string>();
    // (Clear of the tab bar at the top.)
    const inner = visibleRect(v, s, -14);
    const bar = inset() / v.k;
    inner.y += bar;
    inner.h -= bar;
    for (const w of wireList.current) {
      const ends: [string, string][] = [[w.from, w.to], [w.to, w.from]];
      for (const [id, other] of ends) {
        if (skip.has(id) || done.has(id) || P.current.covered?.(id, v) || P.current.covered?.(other, v)) continue;
        done.add(id);
        const r = rectOf(id), o = rectOf(other);
        if (!r || !o) continue;
        g.strokeStyle = g.fillStyle = w.look.stroke;
        g.globalAlpha = Math.min(1, w.look.alpha + 0.2);
        if (intersects(r, vis)) {
          // An outline, 3 screen pixels out (as a selected card's, thinner).
          g.lineWidth = 2 * px;
          g.beginPath();
          if (typeof g.roundRect === "function") g.roundRect(r.x - 3 * px, r.y - 3 * px, r.w + 6 * px, r.h + 6 * px, 12 + 3 * px);
          else g.rect(r.x - 3 * px, r.y - 3 * px, r.w + 6 * px, r.h + 6 * px);
          g.stroke();
          continue;
        }
        // Off screen: a small arrowhead at the edge, on the line from the other end (or the centre) towards it.
        const from = intersects(o, vis) ? center(o) : center(vis);
        const to = center(r);
        const dx = to.x - from.x, dy = to.y - from.y;
        let t = 1;
        if (dx > 0) t = Math.min(t, (inner.x + inner.w - from.x) / dx);
        if (dx < 0) t = Math.min(t, (inner.x - from.x) / dx);
        if (dy > 0) t = Math.min(t, (inner.y + inner.h - from.y) / dy);
        if (dy < 0) t = Math.min(t, (inner.y - from.y) / dy);
        const tip = { x: from.x + dx * t, y: from.y + dy * t };
        const a = Math.atan2(dy, dx), L = 11 * px, Wd = 6 * px;
        g.beginPath();
        g.moveTo(tip.x, tip.y);
        g.lineTo(tip.x - L * Math.cos(a) + Wd * Math.sin(a), tip.y - L * Math.sin(a) - Wd * Math.cos(a));
        g.lineTo(tip.x - L * Math.cos(a) - Wd * Math.sin(a), tip.y - L * Math.sin(a) + Wd * Math.cos(a));
        g.closePath();
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  const requestDraw = useCallback(() => {
    if (!drawFrame.current) drawFrame.current = requestAnimationFrame(drawPh);
  }, [drawPh]);
  useEffect(() => () => cancelAnimationFrame(drawFrame.current), []);
  // Drawn colours follow the page's theme.
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => {
      phColors.current = null;
      regionLooks.current.clear();
      looks.current.clear();
      requestDraw();
    };
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  // Tiles are drawn when the main thread is idle, a few milliseconds at a time.
  function scheduleTiles() {
    if (tileWork.current) return;
    tileWork.current = 1;
    const run = (deadline?: IdleDeadline) => {
      tileWork.current = 0;
      const t = tiles.current, s = sizeRef.current;
      if (!t || !s) return;
      const ms = deadline ? clamp(deadline.timeRemaining(), 3, 12) : 4;
      const r = t.work(ms, toWorld(viewRef.current, { x: s.w / 2, y: s.h / 2 }));
      if (r.ready) requestDraw();
      else if (r.more) scheduleTiles();
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 100 });
    else setTimeout(run, 16);
  }
  /** The placeholder under a screen point, topmost first. */
  const placeholderAt = (p: Point): { id: string; x: number; y: number } | null => {
    const w = toWorld(viewRef.current, p);
    const list = phList.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) {
        const c = byIdRef.current.get(phIds.current[i]);
        return c ? { id: c.id, x: c.x, y: c.y } : null;
      }
    }
    return null;
  };
  // Keyboard users get focusable stand-ins for placeholders (Tab reaches every card); pointers don't need them.
  const [keyboard, setKeyboard] = useState(false);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const indexOf = useMemo(() => new Map(cards.map((c, i) => [c.id, i])), [cards]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const rectOf = useCallback((id: string): Rect | null => {
    const c = byIdRef.current.get(id);
    if (!c) return null;
    const d = dragRef.current;
    const pos = d && d.id === id ? d : c;
    return { x: pos.x, y: pos.y, w: c.w, h: sizes.current.get(id)?.h ?? c.h ?? DEFAULT_H };
  }, []);

  const contentRect = useCallback((): Rect | null => {
    const rs: Rect[] = [...P.current.regions ?? []];
    for (const c of P.current.cards) rs.push(rectOf(c.id)!);
    return union(rs);
  }, [rectOf]);

  // Region under the viewport's centre, for the tab bar.
  const regionAt = (v: View, s: Size) => {
    const c = toWorld(v, { x: s.w / 2, y: s.h / 2 });
    const rs = P.current.regions ?? [];
    const hit = rs.find((r) => c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h);
    return hit?.id ?? null;
  };

  // The mounted window: re-rendered only when the view leaves it, the level of detail changes, or zooming in more than doubles.
  const lastK = useRef(NaN);
  const zoomingRef = useRef(false);
  const zoomTimer = useRef(0);
  const updateWin = useCallback((v: View) => {
    const s = sizeRef.current;
    if (!s) return;
    const w = winRef.current;
    const T = P.current.placeholderBelow ?? 0.32;
    // (Mounted cards stay a little below the threshold: no flapping around it.)
    const lod = v.k < (w && !w.lod ? 0.9 * T : T);
    const need = visibleRect(v, s, (P.current.overscan ?? 700) / 3);
    if (!w || w.lod !== lod || !contains(w.rect, need) || v.k > w.k * 2) {
      const next = { rect: visibleRect(v, s, lod ? 2 * (P.current.overscan ?? 700) : P.current.overscan ?? 700), k: v.k, lod };
      winRef.current = next;
      setWin(next);
    }
  }, []);
  useEffect(() => () => clearTimeout(zoomTimer.current), []);
  // Mounting ahead while zooming in (see apply): the rect the zoom is heading for, and the point it keeps still.
  const ahead = useRef<{ rect: Rect; focal: Point } | null>(null);
  const aheadFrame = useRef(0);
  // Milliseconds a card costs to mount per world pixel of its height (learnt from the mounts ahead), and the last batch's height.
  const aheadRate = useRef(0.004);
  const aheadH = useRef(0);
  const aheadT0 = useRef(0);
  const aheadRest = useRef(0);
  const aheadSamples = useRef(0);
  const lastZoomAt = useRef(0);
  const aheadPump = () => {
    aheadFrame.current = 0;
    const a = ahead.current;
    if (!a) return;
    const todo: { id: string; d: number }[] = [];
    for (const c of P.current.cards) {
      if (levels.current.has(c.id) || kept.current.has(c.id)) continue;
      const r = rectOf(c.id)!;
      if (!intersects(r, a.rect)) continue;
      // (From the point to the card's nearest edge: a tall card under it comes first.)
      const dx = Math.max(r.x - a.focal.x, 0, a.focal.x - r.x - r.w), dy = Math.max(r.y - a.focal.y, 0, a.focal.y - r.y - r.h);
      todo.push({ id: c.id, d: Math.hypot(dx, dy) });
    }
    if (!todo.length) return;
    todo.sort((x, y) => x.d - y.d);
    // A frame's worth (by each card's expected cost), nearest first; while the
    // zoom is still changing a smaller one, and no card that would take more
    // than AHEAD_MAX_MS (a slow device's biggest cards wait for it to pause).
    const now = performance.now();
    const active = now - lastZoomAt.current < 40;
    // (After a batch that overran, as many frames' worth rest before the next.)
    if (active && now < aheadRest.current) {
      aheadFrame.current = requestAnimationFrame(aheadPump);
      return;
    }
    const budget = active ? ZOOM_BUDGET : BUDGET;
    let cost = 0, h = 0;
    for (const t of todo) {
      const th = rectOf(t.id)!.h, c = th * aheadRate.current;
      // (Until the cost is learnt, small cards only.)
      if (active && (c > AHEAD_MAX_MS || (aheadSamples.current < 3 && th > 1200))) continue;
      if (h && cost + c > budget) break;
      keep(t.id);
      cost += c;
      h += th;
    }
    if (!h) {
      aheadFrame.current = requestAnimationFrame(aheadPump);
      return;
    }
    aheadH.current = h;
    aheadT0.current = performance.now();
    setMountTick((n) => n + 1);
  };
  /** Marks a card kept (mounted, hidden below the mount zoom), most recently used; the least recently used beyond KEEP_MAX go. */
  const keep = (id: string) => {
    kept.current.delete(id);
    kept.current.set(id, ++keptTick.current);
    for (const old of kept.current.keys()) {
      if (kept.current.size <= KEEP_MAX) break;
      kept.current.delete(old);
    }
  };
  useEffect(() => () => cancelAnimationFrame(aheadFrame.current), []);
  const requestPump = () => {
    if (pending.current.length && !mountFrame.current) mountFrame.current = requestAnimationFrame(pump);
  };

  // Moves the layers to the view; re-renders only when the mounted window must change.
  const apply = useCallback((v: View) => {
    const t = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    const v0 = viewRef.current;
    viewRef.current = v;
    if (worldRef.current) worldRef.current.style.transform = t;
    const s = sizeRef.current;
    if (!s) return;
    miniRef.current?.place();
    requestDraw();
    // While the zoom changes (a pinch, wheel zoom, a flight), what's mounted
    // stays as it is (scaled with the layer; unmounted cards are drawn as
    // placeholders wherever they are): mounting and unmounting cards at every
    // step is what made zooming slow. The window catches up once the zoom rests.
    const zooming = Math.abs(v.k - lastK.current) > 1e-9;
    lastK.current = v.k;
    const T = P.current.placeholderBelow ?? 0.32;
    // Drawn cards: below the mount zoom the cards' layer is hidden over their
    // drawings (one element's class; from 10% below it once shown), whatever
    // is mounted in it: scaled far down, the browser would repaint them at
    // every step. Crossing it shows at once what's mounted.
    if (tiles.current) setHid(v.k < (hidRef.current ? T : 0.9 * T));
    if (zooming && winRef.current) {
      zoomingRef.current = true;
      lastZoomAt.current = performance.now();
      // Zooming in towards (or past) the mount zoom: the cards it will show,
      // about the point the zoom keeps still, are mounted ahead (hidden until
      // it's crossed), a few each frame, nearest that point first.
      if (tiles.current && v.k > v0.k && v.k >= AHEAD_FROM * T) {
        const vis = visibleRect(v, s);
        const f = Math.abs(v.k - v0.k) > 1e-9 ? { x: (v0.x - v.x) / (v.k - v0.k), y: (v0.y - v.y) / (v.k - v0.k) } : center(vis);
        const F = { x: clamp(f.x, vis.x, vis.x + vis.w), y: clamp(f.y, vis.y, vis.y + vis.h) };
        const q = Math.min(1, v.k / T);
        ahead.current = { rect: { x: F.x + (vis.x - F.x) * q, y: F.y + (vis.y - F.y) * q, w: vis.w * q, h: vis.h * q }, focal: F };
        if (!aheadFrame.current) aheadFrame.current = requestAnimationFrame(aheadPump);
      }
      clearTimeout(zoomTimer.current);
      zoomTimer.current = window.setTimeout(() => {
        zoomingRef.current = false;
        ahead.current = null;
        updateWin(viewRef.current);
        requestPump();
        requestDraw();
      }, ZOOM_REST_MS);
    } else if (!zoomingRef.current) updateWin(v);
    const reg = regionAt(v, s);
    setCurrentRegion((old) => (old === reg ? old : reg));
    clearTimeout(viewTimer.current);
    viewTimer.current = window.setTimeout(() => {
      const ch = viewRef.current.k < (P.current.cheapBelow ?? 0.5);
      setCheap((old) => (old === ch ? old : ch));
      P.current.onViewChange?.(viewRef.current);
    }, 200);
  }, []);

  const moving = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.classList.add("is-moving");
    clearTimeout(movingTimer.current);
    movingTimer.current = window.setTimeout(() => root.classList.remove("is-moving"), 160);
  }, []);

  // Any user or caller move; until then "fit" follows the content as it's measured.
  const touched = useRef(false);
  const stopFlight = () => {
    touched.current = true;
    if (flight.current) cancelAnimationFrame(flight.current);
    flight.current = 0;
  };

  const animateTo = useCallback((to: View, instant?: boolean) => {
    stopFlight();
    const s = sizeRef.current;
    if (!s || instant || reducedMotion()) return apply(to);
    const path = flyPath(viewRef.current, to, s);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / path.ms);
      moving();
      apply(path.at(easeInOut(t)));
      flight.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    flight.current = requestAnimationFrame(step);
  }, [apply, moving]);

  const api = useMemo<CanvasApi>(() => {
    const viewFor = (target: FlyTarget, o: FlyOptions = {}): View | null => {
      const s = sizeRef.current;
      if (!s) return null;
      if (typeof target !== "string" && "k" in target) return target;
      let rect: Rect | null;
      let maxK = limitsRef.current.max;
      if (typeof target === "string") {
        rect = rectOf(target);
        if (rect) maxK = Math.min(maxK, o.maxZoom ?? 1);
        else rect = (P.current.regions ?? []).find((r) => r.id === target) ?? null;
      } else rect = target;
      if (!rect) return null;
      if (o.maxZoom !== undefined) maxK = Math.min(maxK, o.maxZoom);
      if (o.keepZoom) return viewAt(center(rect), viewRef.current.k, s);
      return fitBelow(rect, s, { min: limitsRef.current.min, max: maxK }, o.pad ?? 32);
    };
    return {
      flyTo(target, o) {
        const v = viewFor(target, o);
        if (v) animateTo(v, o?.instant);
      },
      fit(o) {
        const r = contentRect();
        if (r) this.flyTo(r, { pad: FIT_PAD, ...o });
      },
      zoomBy(f, at) {
        const s = sizeRef.current;
        if (!s) return;
        animateTo(zoomAt(viewRef.current, at ?? { x: s.w / 2, y: s.h / 2 }, f, limitsRef.current));
      },
      panBy(dx, dy) {
        stopFlight();
        apply(panBy(viewRef.current, dx, dy));
      },
      getView: () => viewRef.current,
      setView: (v) => { stopFlight(); apply(v); },
      rectOf,
      size: () => sizeRef.current ?? { w: 0, h: 0 },
      inset,
    };
  }, [animateTo, apply, contentRect, rectOf]);

  useLayoutEffect(() => {
    setRef(props.apiRef, api);
    return () => setRef(props.apiRef, null);
  }, [api, props.apiRef]);

  // Size of the canvas; the first one places the initial view.
  useLayoutEffect(() => {
    const root = rootRef.current!;
    const ro = new ResizeObserver(() => {
      const s = { w: root.clientWidth, h: root.clientHeight };
      if (!s.w || !s.h) return;
      insetRef.current = -1;
      const first = !sizeRef.current;
      sizeRef.current = s;
      if (first) {
        const iv = P.current.initialView ?? "fit";
        const r = iv === "fit" ? contentRect() : null;
        apply(iv === "fit" ? (r ? fitBelow(r, s, limitsRef.current, FIT_PAD) : viewRef.current) : iv);
        setReady(true);
      } else {
        winRef.current = null;
        apply(viewRef.current);
      }
    });
    ro.observe(root);
    if (tabsRef.current) ro.observe(tabsRef.current);
    return () => ro.disconnect();
  }, []);

  // Until the first move, keep the initial "fit" fitting what's been measured since.
  useLayoutEffect(() => {
    const s = sizeRef.current;
    if (touched.current || !s || (P.current.initialView ?? "fit") !== "fit") return;
    const r = contentRect();
    if (r) apply(fitBelow(r, s, limitsRef.current, FIT_PAD));
  }, [sizeTick, cards, regions]);

  // Sizes known from before count as measured until a mounted card says otherwise.
  const seeded = useRef<ReadonlyMap<string, Size> | undefined>(undefined);
  if (props.initialSizes !== seeded.current) {
    seeded.current = props.initialSizes;
    for (const [id, sz] of props.initialSizes ?? []) if (!measured.current.has(id)) sizes.current.set(id, sz);
  }

  // Measured card sizes. Mounted cards report on the next frame; hidden
  // measuring reports a few times a second (each report re-lays out the caller).
  const flushFrame = useRef(0);
  const flushTimer = useRef(0);
  const flush = useCallback(() => {
    cancelAnimationFrame(flushFrame.current);
    clearTimeout(flushTimer.current);
    flushFrame.current = flushTimer.current = 0;
    setSizeTick((n) => n + 1);
    P.current.onMeasure?.(measured.current);
  }, []);
  const noteSize = useCallback((id: string, s: Size, bulk = false) => {
    const old = measured.current.get(id);
    if (old && Math.abs(old.h - s.h) < 0.5 && Math.abs(old.w - s.w) < 0.5) return;
    measured.current.set(id, s);
    sizes.current.set(id, s);
    if (bulk) {
      if (!flushTimer.current && !flushFrame.current) flushTimer.current = window.setTimeout(flush, 1000);
    } else if (!flushFrame.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = 0;
      flushFrame.current = requestAnimationFrame(flush);
    }
  }, [flush]);
  useEffect(() => () => {
    cancelAnimationFrame(flushFrame.current);
    clearTimeout(flushTimer.current);
  }, []);
  const observer = useMemo(
    () =>
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            for (const e of entries) {
              const el = e.target as HTMLElement;
              const id = el.dataset.id;
              if (!id || el.dataset.level !== "2") continue;
              const b = e.borderBoxSize?.[0];
              noteSize(id, b ? { w: b.inlineSize, h: b.blockSize } : { w: el.offsetWidth, h: el.offsetHeight });
            }
          }),
    [noteSize],
  );
  useEffect(() => () => observer?.disconnect(), [observer]);

  // Hidden measuring of every card not measured yet: rendered straight into
  // a hidden box (no re-render of the canvas), in slices of about BUDGET ms
  // that yield to input and frames in between; the batch size adapts to how
  // long the last one took.
  const measureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.measure) return;
    let stop = false;
    let n = 4;
    const ch = typeof MessageChannel === "function" ? new MessageChannel() : null;
    const later = () => (ch ? ch.port2.postMessage(0) : setTimeout(slice, 0));
    const slice = () => {
      const box = measureRef.current;
      if (stop || !box) return;
      const todo = P.current.cards.filter((c) => !sizes.current.has(c.id));
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < BUDGET) {
        const batch = todo.splice(0, n);
        const t1 = performance.now();
        renderInto(
          batch.map((c) => (
            <div key={c.id} class="cv-card" data-id={c.id} style={{ width: `${c.w}px` }}>
              {P.current.renderCard(c, { selected: false })}
            </div>
          )),
          box,
        );
        for (const child of Array.from(box.children) as HTMLElement[])
          if (child.dataset.id) noteSize(child.dataset.id, { w: child.offsetWidth, h: child.offsetHeight }, true);
        n = adaptCount(n, performance.now() - t1, BUDGET, 60);
      }
      if (todo.length) return later();
      renderInto(null, box);
      box.removeAttribute("data-busy");
      if (flushTimer.current) flush();
    };
    if (ch) ch.port1.onmessage = slice;
    fontsLoaded().then(() => {
      if (stop || !measureRef.current) return;
      measureRef.current.setAttribute("data-busy", "");
      slice();
    });
    return () => {
      stop = true;
      ch?.port1.close();
      if (measureRef.current) renderInto(null, measureRef.current);
    };
  }, [props.measure, cards.length]);

  // Pointer gestures.
  useEffect(() => {
    const root = rootRef.current!;
    const local = (e: { clientX: number; clientY: number }): Point => {
      const b = root.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const startPan = (id: number) => {
      gesture.current = { mode: "pan", id };
      try { root.setPointerCapture(id); } catch { /* the pointer is gone */ }
      root.classList.add("is-panning");
    };
    const startPinch = () => {
      const [a, b] = [...pointers.current.entries()];
      const pa = a[1], pb = b[1];
      gesture.current = {
        mode: "pinch", ids: [a[0], b[0]], v0: viewRef.current,
        d0: Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y)), mid0: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
      };
      for (const id of [a[0], b[0]]) try { root.setPointerCapture(id); } catch { /* gone */ }
      setDrag(null);
    };
    const down = (e: PointerEvent) => {
      const target = e.target as Element;
      setKeyboard(false);
      if (target.closest(".cv-ui, .cv-minimap")) return;
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
      stopFlight();
      const p = local(e);
      // (Cards hidden below the mount zoom are their drawings: as placeholders.)
      const cardEl = hidRef.current ? null : target.closest<HTMLElement>(CARD);
      // A card drawn as a placeholder (on the placeholder canvas, not an element).
      const ph = cardEl ? null : placeholderAt(p);
      const touch = e.pointerType !== "mouse";
      if (touch || !cardEl || e.button === 1) pointers.current.set(e.pointerId, p);
      if (pointers.current.size >= 2) return startPinch();
      suppressClick.current = false;
      if (e.button === 1) { e.preventDefault(); return startPan(e.pointerId); }
      if (cardEl && P.current.onMove) {
        const handle = target.closest(HANDLE);
        const noHandle = !cardEl.querySelector(HANDLE);
        if (handle || (noHandle && !touch && !target.closest(INTERACTIVE))) {
          const c = byIdRef.current.get(cardEl.dataset.id!);
          if (c) {
            pointers.current.set(e.pointerId, p);
            gesture.current = { mode: "pending-card", id: e.pointerId, card: c.id, start: p, origin: { x: c.x, y: c.y } };
            if (!touch) e.preventDefault();
            return;
          }
        }
      }
      if (ph && P.current.onMove && !touch) {
        pointers.current.set(e.pointerId, p);
        gesture.current = { mode: "pending-card", id: e.pointerId, card: ph.id, start: p, origin: { x: ph.x, y: ph.y } };
        e.preventDefault();
        return;
      }
      if (cardEl) {
        // Mouse on a card: the browser's own (text selection, clicks). Touch: pan once it moves.
        if (touch) gesture.current = { mode: "pending-pan", id: e.pointerId, start: p };
        return;
      }
      if (!touch) e.preventDefault(); // no text selection while panning the background
      if (touch) gesture.current = { mode: "pending-pan", id: e.pointerId, start: p };
      else startPan(e.pointerId);
    };
    const hover = (id: string | null) => {
      if (id === hoverRef.current) return;
      hoverRef.current = id;
      P.current.onHover?.(id);
      requestDraw();
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === "mouse" && !e.buttons && P.current.linkAt && gesture.current.mode === "none") {
          const onUi = (e.target as Element).closest(".cv-ui, .cv-minimap, .cv-card");
          const link = !onUi && P.current.linkAt(toWorld(viewRef.current, local(e)), viewRef.current);
          root.classList.toggle("is-link", !!link);
        }
        if (e.pointerType === "mouse" && !e.buttons && P.current.onHover && gesture.current.mode === "none") {
          const el = (e.target as Element).closest<HTMLElement>(CARD);
          hover(el ? el.dataset.id ?? null : (e.target as Element).closest(".cv-ui, .cv-minimap") ? null : placeholderAt(local(e))?.id ?? null);
        }
        return;
      }
      const p = local(e);
      pointers.current.set(e.pointerId, p);
      const g = gesture.current;
      if (g.mode === "pinch") {
        const pa = pointers.current.get(g.ids[0]), pb = pointers.current.get(g.ids[1]);
        if (!pa || !pb) return;
        const d = Math.max(1, Math.hypot(pa.x - pb.x, pa.y - pb.y));
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const k = clamp(g.v0.k * (d / g.d0), limitsRef.current.min, limitsRef.current.max);
        const w = toWorld(g.v0, g.mid0);
        moving();
        apply({ x: mid.x - w.x * k, y: mid.y - w.y * k, k });
        suppressClick.current = true;
        return;
      }
      if (g.mode === "pending-pan" && g.id === e.pointerId) {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 6) return;
        startPan(e.pointerId);
        suppressClick.current = true;
      }
      if (gesture.current.mode === "pan" && (gesture.current as { id: number }).id === e.pointerId) {
        moving();
        apply(panBy(viewRef.current, p.x - prev.x, p.y - prev.y));
        suppressClick.current = true;
        return;
      }
      if ((g.mode === "pending-card" || g.mode === "card") && g.id === e.pointerId) {
        if (g.mode === "pending-card") {
          if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 4) return;
          gesture.current = { ...g, mode: "card" };
          try { root.setPointerCapture(e.pointerId); } catch { /* gone */ }
          root.classList.add("is-dragging");
          suppressClick.current = true;
        }
        const k = viewRef.current.k;
        const pos = snap({ x: g.origin.x + (p.x - g.start.x) / k, y: g.origin.y + (p.y - g.start.y) / k }, P.current.snap);
        setDrag({ id: g.card, ...pos });
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      const g = gesture.current;
      // The click that ends a pan or drag fires right after this; later clicks count.
      if (suppressClick.current) setTimeout(() => (suppressClick.current = false), 0);
      if (g.mode === "card" && g.id === e.pointerId) {
        const d = dragRef.current;
        if (d && e.type === "pointerup") P.current.onMove?.(d.id, { x: d.x, y: d.y });
        setDrag(null);
      }
      // A tap or click that didn't move: on a placeholder selects it, on the background selects nothing.
      const tapAt = () => {
        const link = P.current.linkAt?.(toWorld(viewRef.current, local(e)), viewRef.current);
        if (link) P.current.onLink?.(link);
        else P.current.onSelect?.(placeholderAt(local(e))?.id ?? null);
      };
      if (g.mode === "pending-pan" && g.id === e.pointerId && !(e.target as Element).closest?.(CARD) && e.type === "pointerup") tapAt();
      if (g.mode === "pan" && g.id === e.pointerId && !suppressClick.current && e.type === "pointerup") tapAt();
      if (g.mode === "pending-card" && g.id === e.pointerId && e.type === "pointerup" && !(e.target as Element).closest?.(CARD)) P.current.onSelect?.(g.card);
      root.classList.remove("is-panning", "is-dragging");
      if (g.mode === "pinch" && pointers.current.size === 1) {
        // One finger left: keep panning with it.
        const [id] = pointers.current.keys();
        gesture.current = { mode: "pan", id };
        return;
      }
      if (!pointers.current.size || g.mode !== "pinch") gesture.current = { mode: "none" };
      if (!pointers.current.size) pointers.current.clear();
    };
    const click = (e: MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".cv-ui, .cv-minimap")) return;
      e.preventDefault();
      stopFlight();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1;
      let dx = e.deltaX * unit, dy = e.deltaY * unit;
      moving();
      if (e.ctrlKey || e.metaKey) {
        apply(zoomAt(viewRef.current, local(e), Math.exp(-dy * 0.01), limitsRef.current));
        return;
      }
      if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
      apply(panBy(viewRef.current, -dx, -dy));
    };
    // Safari's trackpad pinch (iOS pinches arrive as pointers).
    let gestureK = 1;
    const gStart = (e: Event) => {
      e.preventDefault();
      gestureK = 1;
    };
    const gChange = (e: Event) => {
      e.preventDefault();
      if (pointers.current.size) return;
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      touched.current = true;
      moving();
      apply(zoomAt(viewRef.current, local(ge), ge.scale / gestureK, limitsRef.current));
      gestureK = ge.scale;
    };
    // Focusing a card scrolls an overflow:hidden box in every browser; the view does that job.
    const noScroll = () => {
      if (root.scrollTop || root.scrollLeft) root.scrollTop = root.scrollLeft = 0;
    };
    root.addEventListener("scroll", noScroll);
    const onFocusIn = (e: FocusEvent) => focusIn.current(e);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    const leave = () => hover(null);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    root.addEventListener("lostpointercapture", up);
    root.addEventListener("click", click, true);
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("gesturestart", gStart);
    root.addEventListener("gesturechange", gChange);
    return () => {
      root.removeEventListener("scroll", noScroll);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", up);
      root.removeEventListener("lostpointercapture", up);
      root.removeEventListener("click", click, true);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("gesturestart", gStart);
      root.removeEventListener("gesturechange", gChange);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable]") || e.altKey || e.ctrlKey || e.metaKey) return;
    const s = sizeRef.current;
    if (!s) return;
    const step = e.shiftKey ? KEY_PAN * 4 : KEY_PAN;
    const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (pan[e.key]) {
      e.preventDefault();
      api.panBy(...pan[e.key]);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      api.zoomBy(1.4);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      api.zoomBy(1 / 1.4);
    } else if (e.key === "0") {
      e.preventDefault();
      api.fit();
    } else if (e.key === "Escape") {
      P.current.onSelect?.(null);
    } else if ((e.key === "Enter" || e.key === " ") && (t.classList.contains("cv-card") || t.classList.contains("cv-ph"))) {
      e.preventDefault();
      P.current.onSelect?.(t.dataset.id!);
    }
  };

  // A card focused by keyboard (Tab) comes into view. (A native listener:
  // Preact's onFocusIn doesn't map to "focusin".)
  const focusIn = useRef<(e: FocusEvent) => void>(() => {});
  focusIn.current = (e: FocusEvent) => {
    // Only keyboard focus moves the view: a click or tap on a card selects it and nothing else.
    if (!(e.target as Element).matches?.(":focus-visible")) return;
    setKeyboard(true);
    const el = (e.target as Element).closest<HTMLElement>(CARD);
    const s = sizeRef.current;
    if (!el || !s || gesture.current.mode !== "none") return;
    const r = rectOf(el.dataset.id!);
    if (!r) return;
    const vis = visibleRect(viewRef.current, s, -16);
    if (contains(vis, r)) return;
    const k = viewRef.current.k;
    if (k < placeholderBelow) api.flyTo(el.dataset.id!, { maxZoom: 1 });
    else if (r.w * k > s.w - 32 || r.h * k > s.h - 32) api.flyTo(el.dataset.id!, { maxZoom: k });
    else api.flyTo(el.dataset.id!, { keepZoom: true });
  };

  const onCardClick = (e: MouseEvent) => {
    const el = (e.currentTarget as HTMLElement);
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) return; // the click ended a text selection
    P.current.onSelect?.(el.dataset.id!);
  };

  // Mounts the next few pending cards (see `levels`).
  const pump = useCallback(() => {
    mountFrame.current = 0;
    const s = sizeRef.current;
    // (Resumed when the zoom rests.)
    if (!pending.current.length || !s || zoomingRef.current) return;
    const screen = visibleRect(viewRef.current, s);
    // This frame mounts cards of one level: the level of the card most wanted.
    const [first] = nextToMount(pending.current, screen, 1);
    const level = pending.current.find((p) => p.id === first)!.want;
    const same = pending.current.filter((p) => p.want === level);
    for (const id of nextToMount(same, screen, mountN.current[level])) levels.current.set(id, level);
    mountLevel.current = level;
    mountT0.current = performance.now();
    setMountTick((n) => n + 1);
  }, []);
  useLayoutEffect(() => {
    // What a mount costs includes laying the new cards out (else done later in the frame, uncounted).
    if (mountT0.current || aheadT0.current) worldRef.current?.lastElementChild?.getBoundingClientRect();
    if (mountT0.current) {
      const l = mountLevel.current;
      mountN.current[l] = adaptCount(mountN.current[l], performance.now() - mountT0.current, BUDGET, 40);
      mountT0.current = 0;
    }
    if (aheadT0.current) {
      const took = performance.now() - aheadT0.current;
      const rate = took / Math.max(1, aheadH.current);
      aheadRate.current = aheadSamples.current++ ? 0.7 * aheadRate.current + 0.3 * rate : rate;
      aheadRest.current = performance.now() + Math.max(0, took - ZOOM_BUDGET);
      aheadT0.current = 0;
      if (ahead.current && !aheadFrame.current) aheadFrame.current = requestAnimationFrame(aheadPump);
    }
    if (pending.current.length && !mountFrame.current && !zoomingRef.current) mountFrame.current = requestAnimationFrame(pump);
    requestDraw();
  });
  useEffect(() => () => cancelAnimationFrame(mountFrame.current), []);

  // What to draw.
  void sizeTick;
  const visibleCards = win ? cards.filter((c) => intersects(rectOf(c.id)!, win.rect) || c.id === drag?.id || c.id === selected) : [];
  const placeholders: CanvasCard[] = [];
  const mounted: { c: CanvasCard; level: Level; kept?: boolean }[] = [];
  {
    const next = new Map<string, Level>();
    const keeping = !!props.drawCard;
    const waiting: typeof pending.current = [];
    for (const c of visibleCards) {
      if (win!.lod) {
        placeholders.push(c);
        continue;
      }
      const sz = sizes.current.get(c.id);
      const urgent = c.id === selected || c.id === drag?.id;
      const want: Level = !urgent && cheap && props.renderCheap && sz ? 1 : 2;
      let have = levels.current.get(c.id);
      // A card kept mounted (ahead of a zoom, or since one) joins the window as it is.
      if (!have && want === 2 && kept.current.has(c.id)) have = 2;
      kept.current.delete(c.id);
      if (urgent) have = want;
      if (have !== want) waiting.push({ id: c.id, rect: rectOf(c.id)!, want });
      if (have) {
        next.set(c.id, have);
        mounted.push({ c, level: have });
      } else placeholders.push(c);
    }
    // Zoomed out past the mount zoom: the window's cards are kept (hidden), so zooming back in shows them at once.
    if (keeping && win?.lod) for (const id of levels.current.keys()) if (!next.has(id)) keep(id);
    levels.current = next;
    pending.current = waiting;
    // At rest above it, what's kept outside the window goes.
    if (win && !win.lod) kept.current.clear();
    for (const id of kept.current.keys()) {
      const c = byId.get(id);
      if (!c) kept.current.delete(id);
      else if (!next.has(id)) mounted.push({ c, level: 2, kept: true });
    }
    // In the cards' order, kept or not: a kept card joining the window isn't moved in the DOM (moving it lays it out again).
    mounted.sort((a, b) => indexOf.get(a.c.id)! - indexOf.get(b.c.id)!);
    // Every card not mounted is drawn, not only the window's: while a zoom
    // leaves the window behind (see apply), the rest of the board still shows.
    const drawn = cards.filter((c) => !next.has(c.id));
    phIds.current = drawn.map((c) => c.id);
    phList.current = drawn.map((c) => {
      const r = rectOf(c.id)!;
      return drag?.id === c.id ? { ...r, x: drag.x, y: drag.y } : r;
    });
    phLabels.current = drawn.map((c) => c.label);
    phSelected.current = drawn.findIndex((c) => c.id === selected);

  }
  // What the tiles draw: every card but the one being dragged, where it is now.
  useMemo(() => {
    tiles.current?.setItems(cards.filter((c) => c.id !== drag?.id).map((c) => ({ id: c.id, rect: rectOf(c.id)!, version: c })));
  }, [cards, sizeTick, drag?.id, !!props.drawCard]);
  wireList.current = useMemo(() => {
    const list: typeof wireList.current = [];
    if (!win) return list;
    for (const w of wires) {
      const a = rectOf(w.from), b = rectOf(w.to);
      if (!a || !b) continue;
      const p = w.points && w.points.length > 1 ? polyPath(w.points) : wirePath(a, b, [w.fromSide, w.toSide]);
      const box = { x: p.box.x - 1, y: p.box.y - 1, w: p.box.w + 2, h: p.box.h + 2 };
      list.push({ path: new Path2D(p.d), box, look: lookOf(w), from: w.from, to: w.to });
    }
    return list;
  }, [win, wires, sizeTick, drag, cards]);
  const tabs = regions.filter((r) => r.icon);
  const tabButtons = tabs.map((r) => {
    const Icon = r.icon!;
    return (
      <button key={r.id} type="button" class="icon-btn" aria-label={r.title} title={r.title} aria-current={currentRegion === r.id ? "true" : undefined} onClick={() => api.flyTo(r.id)}>
        <Icon size={20} aria-hidden="true" />
      </button>
    );
  });
  const bar = props.barStart !== undefined || props.barEnd !== undefined;

  return (
    <div
      ref={rootRef}
      class={`cv${ready ? " is-ready" : ""}${bar ? " has-bar" : ""}${props.class ? " " + props.class : ""}`}
      tabIndex={0}
      role="group"
      aria-label={labels.canvas}
      onKeyDown={onKeyDown}
    >
      {/* Regions and their titles are drawn (on the canvases); the titles are headings for assistive technology. */}
      <div class="cv-sr">
        {regions.map((r) => (
          <h2 key={r.id}>{r.title}</h2>
        ))}
      </div>
      <canvas ref={phCanvas} class="cv-phs" aria-hidden="true" />
      <div ref={worldRef} class="cv-layer cv-world">
        {keyboard &&
          placeholders.map((c) => {
            const d = drag?.id === c.id ? drag : null;
            return (
              <div
                key={c.id}
                class="cv-ph"
                data-id={c.id}
                data-selected={c.id === selected ? "" : undefined}
                tabIndex={0}
                role="group"
                aria-label={c.label}
                aria-current={c.id === selected ? "true" : undefined}
                style={{ left: `${d ? d.x : c.x}px`, top: `${d ? d.y : c.y}px`, width: `${c.w}px`, height: `${rectOf(c.id)!.h}px` }}
                onClick={onCardClick}
              />
            );
          })}
        {mounted.map(({ c, level, kept }) => {
          const d = drag?.id === c.id ? drag : null;
          return (
            <CardSlot
              key={c.id}
              card={c}
              x={d ? d.x : c.x}
              y={d ? d.y : c.y}
              level={level}
              size={level === 1 ? sizes.current.get(c.id)! : null}
              selected={c.id === selected}
              dragging={!!d}
              fade={!!props.drawCard && !kept}
              render={renderCard}
              renderCheap={props.renderCheap}
              observer={observer}
              onClick={onCardClick}
            />
          );
        })}
      </div>
      {/* Region titles and wire marks over the cards. */}
      <canvas ref={topCanvas} class="cv-phs cv-top" aria-hidden="true" />
      {props.measure && <div ref={measureRef} class="cv-measure" aria-hidden="true" inert />}
      {bar ? (
        <header class="cv-ui cv-bar" ref={tabsRef}>
          {props.barStart}
          <nav class="cv-tabs">{tabButtons}</nav>
          {props.barEnd}
        </header>
      ) : (
        tabs.length > 0 && (
          <nav class="cv-ui cv-tabs" ref={tabsRef}>
            {tabButtons}
          </nav>
        )
      )}
      {props.controls !== false && (
        <div class="cv-ui cv-controls">
          <button type="button" class="icon-btn" aria-label={labels.zoomIn} title={labels.zoomIn} onClick={() => api.zoomBy(1.5)}>
            <ZoomIn size={20} aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn" aria-label={labels.zoomOut} title={labels.zoomOut} onClick={() => api.zoomBy(1 / 1.5)}>
            <ZoomOut size={20} aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn" aria-label={labels.fit} title={labels.fit} onClick={() => api.fit()}>
            <Maximize size={20} aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn" aria-label={labels.minimap} title={labels.minimap} aria-pressed={mini} onClick={() => setMini(!mini)}>
            <MapIcon size={20} aria-hidden="true" />
          </button>
        </div>
      )}
      {mini && (
        <Minimap
          cards={cards}
          regions={regions}
          rectOf={rectOf}
          tick={sizeTick}
          viewRef={viewRef}
          sizeRef={sizeRef}
          handleRef={miniRef}
          selected={selected}
          onJump={(p) => {
            const s = sizeRef.current;
            if (s) api.setView(viewAt(p, viewRef.current.k, s));
          }}
        />
      )}
    </div>
  );
}

/** Straight lines through the points, each turn rounded (up to 12 world units, half the shorter leg). */
function polyPath(ps: readonly Point[]): { d: string; box: Rect } {
  let d = `M${ps[0].x} ${ps[0].y}`;
  for (let i = 1; i < ps.length - 1; i++) {
    const a = ps[i - 1], b = ps[i], c = ps[i + 1];
    const r = Math.min(12, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const u = (p: Point, q: Point) => {
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
    };
    const i1 = u(b, a), o1 = u(b, c);
    d += `L${b.x + i1.x * r} ${b.y + i1.y * r}Q${b.x} ${b.y} ${b.x + o1.x * r} ${b.y + o1.y * r}`;
  }
  const z = ps[ps.length - 1];
  d += `L${z.x} ${z.y}`;
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { d, box: { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 } };
}

type SlotProps = {
  card: CanvasCard;
  x: number;
  y: number;
  level: Level;
  /** The measured size, for the cheap rendering. */
  size: Size | null;
  selected: boolean;
  dragging: boolean;
  /** Fade in when mounted (over its drawing). */
  fade: boolean;
  render: CanvasProps["renderCard"];
  renderCheap: CanvasProps["renderCheap"];
  observer: ResizeObserver | null;
  onClick: (e: MouseEvent) => void;
};

// One mounted card's box. Re-renders only when its own inputs change, so
// panning and dragging another card don't re-render it. Placed by left/top,
// not a transform: hundreds of transformed boxes cost the compositor work on
// every frame of a pan.
class CardSlot extends Component<SlotProps> {
  el: HTMLDivElement | null = null;
  shouldComponentUpdate(n: SlotProps) {
    const p = this.props;
    return (
      n.card !== p.card || n.x !== p.x || n.y !== p.y || n.level !== p.level || n.selected !== p.selected || n.dragging !== p.dragging ||
      (n.level === 2 ? n.render !== p.render : n.renderCheap !== p.renderCheap || n.size?.h !== p.size?.h)
    );
  }
  componentDidMount() {
    if (this.el) this.props.observer?.observe(this.el);
  }
  componentWillUnmount() {
    if (this.el) this.props.observer?.unobserve(this.el);
  }
  setEl = (el: HTMLDivElement | null) => {
    this.el = el;
  };
  // Fades in when first mounted only.
  fadeIn = this.props.fade;
  render() {
    const { card, x, y, level, size, selected, dragging, render, renderCheap, onClick } = this.props;
    return (
      <div
        ref={this.setEl}
        class={`cv-card${dragging ? " is-drag" : ""}${this.fadeIn ? " cv-in" : ""}`}
        data-id={card.id}
        data-level={level}
        data-selected={selected ? "" : undefined}
        tabIndex={0}
        role="group"
        aria-label={card.label}
        aria-current={selected ? "true" : undefined}
        style={{ left: `${x}px`, top: `${y}px`, width: `${card.w}px` }}
        onClick={onClick}
      >
        {level === 1 && renderCheap && size ? renderCheap(card, size) : render(card, { selected })}
      </div>
    );
  }
}

