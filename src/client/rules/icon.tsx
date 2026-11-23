// Icons on rule cards, drawn as <img>s of their SVG instead of inline <svg>s.
// Every inline <svg> is its own clipped, transformed piece of the page that
// the browser must re-sort on every frame the canvas moves (a few hundred
// icons on screen cost a slow phone tens of milliseconds a frame); an image
// costs nothing. The image is the same lucide icon, coloured with the colour
// its place in the card gives it (read once when mounted).
import { render, type ComponentType } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export type IconType = ComponentType<{ size?: number | string; color?: string; "aria-hidden"?: boolean | "true" }>;

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const urls = new Map<IconType, Map<string, string>>();
let scratch: HTMLDivElement | null = null;

/** A data: URL of the icon's SVG at a size and colour (cached). */
export function iconUrl(I: IconType, size: number, color: string): string {
  let bySpec = urls.get(I);
  if (!bySpec) urls.set(I, (bySpec = new Map()));
  const key = `${size} ${color}`;
  let url = bySpec.get(key);
  if (!url) {
    scratch ??= document.createElement("div");
    render(<I size={size} color={color} />, scratch);
    let svg = scratch.innerHTML;
    render(null, scratch);
    if (!svg.includes("xmlns=")) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    bySpec.set(key, url);
  }
  return url;
}

export function Icon({ icon, size, class: cls }: { icon: IconType; size: number; class?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    // Not in a real document (rendered to work out a card's height: card-height.tsx).
    if (!el || typeof Element === "undefined" || !(el instanceof Element)) return;
    const src = iconUrl(icon, size, getComputedStyle(el).color);
    if (el.getAttribute("src") !== src) el.src = src;
  });
  return <img ref={ref} class={cls ? `ic-img ${cls}` : "ic-img"} width={size} height={size} alt="" aria-hidden="true" draggable={false} src={BLANK} />;
}
