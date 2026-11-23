// An icon-only control (base.css .icon-btn): the label is its aria-label and
// its tooltip, never printed.
import type { ComponentChildren } from "preact";

type Props = {
  label: string;
  onClick?: () => void;
  children: ComponentChildren;
  pressed?: boolean;
  disabled?: boolean;
  class?: string;
  small?: boolean;
  href?: string;
  type?: "button" | "submit";
};

export function IconButton(p: Props) {
  const cls = `icon-btn${p.small ? " icon-sm" : ""}${p.class ? ` ${p.class}` : ""}`;
  if (p.href)
    return (
      <a class={cls} href={p.href} aria-label={p.label} title={p.label}>
        {p.children}
      </a>
    );
  return (
    <button
      type={p.type ?? "button"}
      class={cls}
      aria-label={p.label}
      title={p.label}
      aria-pressed={p.pressed === undefined ? undefined : p.pressed}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  );
}

/** Lucide icon size for a control. */
export const ICON = 20;
export const ICON_SM = 16;
