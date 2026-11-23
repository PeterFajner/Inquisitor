// Chip building blocks. Every word a chip prints is the book's (names,
// stats, dice, the book's labels); what an icon means is its aria-label
// and tooltip (../labels.ts).
import type { ComponentChildren, ComponentType } from "preact";
import { ChevronRight } from "lucide-preact";

export type IconType = ComponentType<{ size?: number | string; "aria-hidden"?: boolean | "true"; class?: string }>;

/** A meaningful icon inside a chip: role=img with its label as name and tooltip. */
export function Ic({ icon: I, label, size = 13 }: { icon: IconType; label: string; size?: number }) {
  return (
    <span class="ci" role="img" aria-label={label} title={label}>
      <I size={size} aria-hidden="true" />
    </span>
  );
}

export function Chip(p: { class?: string; title?: string; children: ComponentChildren }) {
  return (
    <span class={`chip${p.class ? ` ${p.class}` : ""}`} title={p.title}>
      {p.children}
    </span>
  );
}

/** A chip that holds other chips (pick, chance, if…). */
export function Group(p: { class?: string; lead: ComponentChildren; children?: ComponentChildren }) {
  return (
    <span class={`chip grp${p.class ? ` ${p.class}` : ""}`}>
      <span class="lead">{p.lead}</span>
      {p.children}
    </span>
  );
}

export const Arrow = () => <ChevronRight class="arrow" size={12} aria-hidden="true" />;
export const Sep = () => (
  <span class="sep" aria-hidden="true">
    ·
  </span>
);

/** Items with a separator between them. */
export function joined(items: ComponentChildren[]): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  items.forEach((x, i) => {
    if (i) out.push(<Sep key={`s${i}`} />);
    out.push(x);
  });
  return out;
}

export const V = (p: { children: ComponentChildren }) => <span class="v">{p.children}</span>;
