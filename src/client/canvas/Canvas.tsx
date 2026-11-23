// The infinite canvas (docs/CANVAS.md): cards at world positions, wires
// between them, titled regions, pan/zoom by pointer, touch, wheel and keys,
// a region tab bar, a minimap. Only cards near the viewport are mounted;
// below `placeholderBelow` zoom they are empty boxes. Panning and zooming
// move two layers by CSS transform without re-rendering; Preact re-renders
// only when the set of mounted cards has to change.
import { Component, type ComponentChildren, type ComponentType, type CSSProperties, type Ref } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Map as MapIcon, Maximize, ZoomIn, ZoomOut } from "lucide-preact";
import {
  center, clamp, contains, easeInOut, fitView, flyPath, intersects, panBy, snap, toWorld, union, viewAt, visibleRect, wirePath, zoomAt,
  type Point, type Rect, type Side, type Size, type View, type ZoomLimits,
} from "./geometry.ts";
import { Minimap, type MinimapHandle } from "./Minimap.tsx";
import "./canvas.css";

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
  /** Measured sizes (all known so far) whenever one changes. */
  onMeasure?: (sizes: ReadonlyMap<string, Size>) => void;
  initialView?: View | "fit";
  /** The view after it settles (debounced). */
  onViewChange?: (v: View) => void;
  minZoom?: number;
  maxZoom?: number;
  /** Below this zoom cards are drawn as empty boxes. */
  placeholderBelow?: number;
  /** Screen pixels around the viewport whose cards stay mounted. */
  overscan?: number;
  minimap?: boolean;
  controls?: boolean;
  labels?: Partial<CanvasLabels>;
  apiRef?: Ref<CanvasApi>;
  class?: string;
};

// Preact 11 doesn't add "px" to numbers in style: every length below is a string.
// Placeholder words until the owner approves the controls' labels (AGENTS.md).
const LABELS: CanvasLabels = { zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Zoom to fit", minimap: "Minimap" };
const DEFAULT_H = 120;
const KEY_PAN = 80;
// Room around the content on "fit": region titles sit above their regions, controls float over the edges.
const FIT_PAD = 64;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const INTERACTIVE = "button, a[href], input, select, textarea, label, summary, [contenteditable], [role=button], [data-canvas-nodrag]";
const HANDLE = "[data-canvas-handle]";

type Win = { rect: Rect; k: number; lod: boolean };
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
  const backRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  // The tabs' bottom edge: what a fit leaves clear at the top.
  const inset = () => {
    const t = tabsRef.current;
    return t ? Math.max(0, t.offsetTop + t.offsetHeight - 8) : 0;
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
  const sizes = useRef(new Map<string, Size>());
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

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
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

  // Moves the layers to the view; re-renders only when the mounted window must change.
  const apply = useCallback((v: View) => {
    viewRef.current = v;
    const t = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    if (worldRef.current) worldRef.current.style.transform = t;
    if (backRef.current) {
      backRef.current.style.transform = t;
      backRef.current.style.setProperty("--cv-inv", String(1 / v.k));
    }
    if (frontRef.current) {
      frontRef.current.style.transform = t;
      frontRef.current.style.setProperty("--cv-inv", String(1 / v.k));
    }
    const s = sizeRef.current;
    if (!s) return;
    miniRef.current?.place();
    const lod = v.k < (P.current.placeholderBelow ?? 0.32);
    const need = visibleRect(v, s, (P.current.overscan ?? 700) / 3);
    const w = winRef.current;
    if (!w || w.lod !== lod || !contains(w.rect, need) || v.k > w.k * 2) {
      const next = { rect: visibleRect(v, s, lod ? 2 * (P.current.overscan ?? 700) : P.current.overscan ?? 700), k: v.k, lod };
      winRef.current = next;
      setWin(next);
    }
    const reg = regionAt(v, s);
    setCurrentRegion((old) => (old === reg ? old : reg));
    clearTimeout(viewTimer.current);
    viewTimer.current = window.setTimeout(() => P.current.onViewChange?.(viewRef.current), 200);
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
    return () => ro.disconnect();
  }, []);

  // Until the first move, keep the initial "fit" fitting what's been measured since.
  useLayoutEffect(() => {
    const s = sizeRef.current;
    if (touched.current || !s || (P.current.initialView ?? "fit") !== "fit") return;
    const r = contentRect();
    if (r) apply(fitBelow(r, s, limitsRef.current, FIT_PAD));
  }, [sizeTick, cards, regions]);

  // Measured card heights (mounted cards).
  const measureQueue = useRef(0);
  const noteSize = useCallback((id: string, s: Size) => {
    const old = sizes.current.get(id);
    if (old && Math.abs(old.h - s.h) < 0.5 && Math.abs(old.w - s.w) < 0.5) return;
    sizes.current.set(id, s);
    if (!measureQueue.current)
      measureQueue.current = requestAnimationFrame(() => {
        measureQueue.current = 0;
        setSizeTick((n) => n + 1);
        P.current.onMeasure?.(sizes.current);
      });
  }, []);
  const observer = useMemo(
    () =>
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            for (const e of entries) {
              const el = e.target as HTMLElement;
              const id = el.dataset.id;
              if (!id || el.classList.contains("is-ph")) continue;
              const b = e.borderBoxSize?.[0];
              noteSize(id, b ? { w: b.inlineSize, h: b.blockSize } : { w: el.offsetWidth, h: el.offsetHeight });
            }
          }),
    [noteSize],
  );
  useEffect(() => () => observer?.disconnect(), [observer]);

  // Hidden measuring of every card, in batches.
  const [measuring, setMeasuring] = useState<CanvasCard[]>([]);
  const measureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.measure) return;
    let stop = false;
    const next = () => {
      if (stop) return;
      const batch = P.current.cards.filter((c) => !sizes.current.has(c.id)).slice(0, 40);
      setMeasuring(batch);
    };
    (document.fonts?.ready ?? Promise.resolve()).then(next);
    return () => { stop = true; };
  }, [props.measure, cards.length]);
  useLayoutEffect(() => {
    if (!measuring.length) return;
    const el = measureRef.current;
    if (!el) return;
    for (const child of Array.from(el.children) as HTMLElement[])
      if (child.dataset.id) noteSize(child.dataset.id, { w: child.offsetWidth, h: child.offsetHeight });
    const id = window.setTimeout(() => {
      const batch = P.current.cards.filter((c) => !sizes.current.has(c.id)).slice(0, 40);
      setMeasuring(batch);
    }, 16);
    return () => clearTimeout(id);
  }, [measuring]);

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
      if (target.closest(".cv-ui, .cv-minimap")) return;
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
      stopFlight();
      const p = local(e);
      const cardEl = target.closest<HTMLElement>(".cv-card");
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
      if (cardEl) {
        // Mouse on a card: the browser's own (text selection, clicks). Touch: pan once it moves.
        if (touch) gesture.current = { mode: "pending-pan", id: e.pointerId, start: p };
        return;
      }
      if (!touch) e.preventDefault(); // no text selection while panning the background
      if (touch) gesture.current = { mode: "pending-pan", id: e.pointerId, start: p };
      else startPan(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      if (!prev) return;
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
      if (g.mode === "pending-pan" && g.id === e.pointerId && !(e.target as Element).closest?.(".cv-card") && e.type === "pointerup")
        P.current.onSelect?.(null);
      if (g.mode === "pan" && g.id === e.pointerId && !suppressClick.current && e.type === "pointerup") P.current.onSelect?.(null);
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
    } else if ((e.key === "Enter" || e.key === " ") && t.classList.contains("cv-card")) {
      e.preventDefault();
      P.current.onSelect?.(t.dataset.id!);
    }
  };

  // A card focused by keyboard (Tab) comes into view. (A native listener:
  // Preact's onFocusIn doesn't map to "focusin".)
  const focusIn = useRef<(e: FocusEvent) => void>(() => {});
  focusIn.current = (e: FocusEvent) => {
    const el = (e.target as Element).closest<HTMLElement>(".cv-card");
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

  const onDblClick = (e: MouseEvent) => {
    if ((e.target as Element).closest(".cv-card, .cv-ui, .cv-minimap")) return;
    const b = rootRef.current!.getBoundingClientRect();
    api.zoomBy(2, { x: e.clientX - b.left, y: e.clientY - b.top });
  };

  // What to draw.
  void sizeTick;
  const visibleCards = win ? cards.filter((c) => intersects(rectOf(c.id)!, win.rect) || c.id === drag?.id || c.id === selected) : [];
  const paths = win
    ? wires.flatMap((w, i) => {
        const a = rectOf(w.from), b = rectOf(w.to);
        if (!a || !b) return [];
        const p = wirePath(a, b, [w.fromSide, w.toSide]);
        if (!intersects({ x: p.box.x - 1, y: p.box.y - 1, w: p.box.w + 2, h: p.box.h + 2 }, win.rect)) return [];
        return [<path key={`${w.from}>${w.to}#${i}`} class={w.class ? `cv-wire ${w.class}` : "cv-wire"} style={w.style} d={p.d} />];
      })
    : [];
  const tabs = regions.filter((r) => r.icon);

  return (
    <div
      ref={rootRef}
      class={`cv${ready ? " is-ready" : ""}${props.class ? " " + props.class : ""}`}
      tabIndex={0}
      role="group"
      aria-label={labels.canvas}
      onKeyDown={onKeyDown}
      onDblClick={onDblClick}
    >
      <div ref={backRef} class="cv-layer cv-back">
        {regions.map((r) => (
          <div key={r.id} class={r.class ? `cv-region ${r.class}` : "cv-region"} data-region={r.id} style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, height: `${r.h}px` }} />
        ))}
      </div>
      <div ref={worldRef} class="cv-layer cv-world">
        <svg class="cv-wires" aria-hidden="true">{paths}</svg>
        {visibleCards.map((c) => {
          const d = drag?.id === c.id ? drag : null;
          return (
            <CardSlot
              key={c.id}
              card={c}
              x={d ? d.x : c.x}
              y={d ? d.y : c.y}
              h={win!.lod ? rectOf(c.id)!.h : 0}
              lod={win!.lod}
              selected={c.id === selected}
              dragging={!!d}
              render={renderCard}
              observer={observer}
              onClick={onCardClick}
            />
          );
        })}
      </div>
      {/* Region titles over everything, so one that grows past its gap when zoomed out stays readable. */}
      <div ref={frontRef} class="cv-layer cv-front">
        {regions.map((r) => (
          <div key={r.id} class="cv-region-label" style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, "--rw": `${r.w}px` }}>
            <h2 class="cv-region-title">{r.title}</h2>
          </div>
        ))}
      </div>
      {props.measure && measuring.length > 0 && (
        <div ref={measureRef} class="cv-measure" aria-hidden="true" inert>
          {measuring.map((c) => (
            <div key={c.id} class="cv-card" data-id={c.id} style={{ width: `${c.w}px` }}>
              {renderCard(c, { selected: false })}
            </div>
          ))}
        </div>
      )}
      {tabs.length > 0 && (
        <nav class="cv-ui cv-tabs" ref={tabsRef}>
          {tabs.map((r) => {
            const Icon = r.icon!;
            return (
              <button key={r.id} type="button" class="icon-btn" aria-label={r.title} title={r.title} aria-current={currentRegion === r.id ? "true" : undefined} onClick={() => api.flyTo(r.id)}>
                <Icon size={20} aria-hidden="true" />
              </button>
            );
          })}
        </nav>
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

type SlotProps = {
  card: CanvasCard;
  x: number;
  y: number;
  h: number;
  lod: boolean;
  selected: boolean;
  dragging: boolean;
  render: CanvasProps["renderCard"];
  observer: ResizeObserver | null;
  onClick: (e: MouseEvent) => void;
};

// One card's box. Re-renders only when its own inputs change, so panning
// and dragging another card don't re-render it.
class CardSlot extends Component<SlotProps> {
  el: HTMLDivElement | null = null;
  shouldComponentUpdate(n: SlotProps) {
    const p = this.props;
    return n.card !== p.card || n.x !== p.x || n.y !== p.y || n.lod !== p.lod || (n.lod && n.h !== p.h) || n.selected !== p.selected || n.dragging !== p.dragging || n.render !== p.render;
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
  render() {
    const { card, x, y, h, lod, selected, dragging, render, onClick } = this.props;
    return (
      <div
        ref={this.setEl}
        class={`cv-card${lod ? " is-ph" : ""}${dragging ? " is-drag" : ""}`}
        data-id={card.id}
        data-selected={selected ? "" : undefined}
        tabIndex={0}
        role="group"
        aria-label={card.label}
        aria-current={selected ? "true" : undefined}
        style={{ transform: `translate(${x}px, ${y}px)`, width: `${card.w}px`, height: lod ? `${h}px` : undefined }}
        onClick={onClick}
      >
        {lod ? null : render(card, { selected })}
      </div>
    );
  }
}
