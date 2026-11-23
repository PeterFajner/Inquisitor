// The canvas's minimap: every region and card as a box on a 2D canvas, the
// viewport as an outline. Press or drag on it to move the view there.
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { miniMapping, union, visibleRect, type Point, type Rect, type Size, type View } from "./geometry.ts";
import type { CanvasCard, CanvasRegion } from "./Canvas.tsx";

export type MinimapHandle = { place(): void };

type Props = {
  cards: readonly CanvasCard[];
  regions: readonly CanvasRegion[];
  rectOf: (id: string) => Rect | null;
  /** Bumps when card sizes change. */
  tick: number;
  selected: string | null;
  viewRef: RefObject<View>;
  sizeRef: RefObject<Size | null>;
  handleRef: RefObject<MinimapHandle | null>;
  onJump: (world: Point) => void;
};

export function Minimap(props: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewEl = useRef<HTMLDivElement>(null);
  const map = useRef<{ s: number; ox: number; oy: number } | null>(null);

  const place = () => {
    const m = map.current, el = viewEl.current, s = props.sizeRef.current;
    if (!m || !el || !s) return;
    const v = visibleRect(props.viewRef.current!, s);
    el.style.transform = `translate(${v.x * m.s + m.ox}px, ${v.y * m.s + m.oy}px)`;
    el.style.width = `${Math.max(4, v.w * m.s)}px`;
    el.style.height = `${Math.max(4, v.h * m.s)}px`;
  };

  const draw = () => {
    const box = boxRef.current, cv = canvasRef.current;
    if (!box || !cv) return;
    const size = { w: box.clientWidth, h: box.clientHeight };
    const rects = props.cards.map((c) => props.rectOf(c.id)!);
    const bounds = union([...rects, ...props.regions]);
    if (!bounds || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const m = miniMapping(bounds, size);
    map.current = m;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(box);
    const token = (name: string) => css.getPropertyValue(name).trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = token("--surface-2");
    for (const r of props.regions) ctx.fillRect(r.x * m.s + m.ox, r.y * m.s + m.oy, r.w * m.s, r.h * m.s);
    ctx.fillStyle = token("--ink-3");
    props.cards.forEach((c, i) => {
      if (c.id === props.selected) return;
      const r = rects[i];
      ctx.fillRect(r.x * m.s + m.ox, r.y * m.s + m.oy, Math.max(1, r.w * m.s), Math.max(1, r.h * m.s));
    });
    const sel = props.selected ? props.rectOf(props.selected) : null;
    if (sel) {
      ctx.fillStyle = token("--accent");
      ctx.fillRect(sel.x * m.s + m.ox - 1, sel.y * m.s + m.oy - 1, Math.max(3, sel.w * m.s + 2), Math.max(3, sel.h * m.s + 2));
    }
    place();
  };

  useLayoutEffect(() => {
    props.handleRef.current = { place };
    return () => { props.handleRef.current = null; };
  });
  useLayoutEffect(draw, [props.cards, props.regions, props.tick, props.selected]);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => draw();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  });

  const jump = (e: PointerEvent) => {
    const m = map.current, box = boxRef.current;
    if (!m || !box) return;
    const b = box.getBoundingClientRect();
    props.onJump({ x: (e.clientX - b.left - m.ox) / m.s, y: (e.clientY - b.top - m.oy) / m.s });
  };

  return (
    <div
      ref={boxRef}
      class="cv-minimap"
      aria-hidden="true"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        jump(e);
      }}
      onPointerMove={(e) => {
        if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) jump(e);
      }}
    >
      <canvas ref={canvasRef} />
      <div ref={viewEl} class="cv-minimap-view" />
    </div>
  );
}
