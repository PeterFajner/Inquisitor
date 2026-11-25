// The bar on every page: the two pages' tabs ("Characters", "Rules") at the
// left, the account at the right; under it a second row with the page's own
// controls (`children`), which starts with its ☰ (MenuToggle) where the page
// has a list. Both rows are the same height on every page, so nothing moves
// when switching pages. `onHeight` gets the whole bar's height (both rows),
// for what sits under it (a drawer, a sticky sidebar, scroll offsets).
import { Menu } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { AccountButton } from "./account/AccountButton.tsx";
import "./sitebar.css";

/** The tabs' words: "Characters" (owner, November 2026) and "Rules" (already approved). */
export const TABS = { characters: "Characters", rules: "Rules" } as const;

type Props = {
  /** The page's tab, marked; null on pages that are neither (a share link). */
  page: keyof typeof TABS | null;
  children?: ComponentChildren;
  onHeight?: (h: number) => void;
  onSignedOut?: () => void;
};

export function SiteBar(p: Props) {
  const ref = useRef<HTMLElement>(null);
  const onHeight = useRef(p.onHeight);
  onHeight.current = p.onHeight;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // (None while the page is hidden: src/client/app.tsx.)
    const ro = new ResizeObserver(() => el.offsetHeight > 0 && onHeight.current?.(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tab = (id: keyof typeof TABS, href: string) => (
    <a class="site-tab" href={href} aria-current={p.page === id ? "page" : undefined}>
      {TABS[id]}
    </a>
  );
  return (
    <header class="site-bar" ref={ref}>
      <div class="site-top">
        <nav class="site-tabs">
          {tab("characters", "/")}
          {tab("rules", "/rules")}
        </nav>
        <AccountButton onSignedOut={p.onSignedOut} />
      </div>
      {p.children !== undefined && <div class="site-row">{p.children}</div>}
    </header>
  );
}

/** The second row's ☰: opens and closes the page's list (the characters, the Table of Contents). */
export function MenuToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" class="icon-btn site-menu" aria-label={label} title={label} aria-pressed={open} onClick={onToggle}>
      <Menu size={20} aria-hidden="true" />
    </button>
  );
}
