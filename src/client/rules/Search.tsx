// Search the shown cards by name: an icon that opens a field (no
// placeholder: the icon says what it is), the names that match as you type
// (those starting with it first, then a word starting with it, then the
// rest; A–Z), each with its kind's icon. Choosing one
// (click, tap, or arrows and Enter) selects its card and flies there.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Search } from "lucide-preact";
import { KIND_ICON, KIND_LABEL } from "./chips/index.ts";
import { Ic } from "./chips/ui.tsx";
import { L } from "./labels.ts";
import { matches, type Searchable } from "./find.ts";

export function SearchBox({ cards, onPick }: { cards: readonly Searchable[]; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const list = useMemo(() => matches(cards, q), [cards, q]);
  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", out, true);
    return () => document.removeEventListener("pointerdown", out, true);
  }, [open]);
  const choose = (key: string) => {
    setOpen(false);
    onPick(key);
  };
  const id = (i: number) => `rs-opt-${i}`;
  return (
    <div class="menu-wrap" ref={ref}>
      <button type="button" class="icon-btn" aria-label={L.search} title={L.search} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Search size={20} aria-hidden="true" />
      </button>
      {open && (
        <div class="menu search-menu" role="search">
          <input
            type="search"
            class="in"
            aria-label={L.search}
            title={L.search}
            aria-controls="rs-list"
            aria-activedescendant={list.length ? id(at) : undefined}
            autoComplete="off"
            value={q}
            ref={input}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((i) => Math.min(list.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && list[at]) {
                e.preventDefault();
                choose(list[at].key);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
          {list.length > 0 && (
            <ul class="search-list" id="rs-list" role="listbox" aria-label={L.search}>
              {list.map((c, i) => (
                <li
                  id={id(i)}
                  role="option"
                  aria-selected={i === at}
                  class={i === at ? "on" : undefined}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(c.key)}
                  onPointerEnter={() => setAt(i)}
                >
                  <Ic icon={KIND_ICON[c.kind]} label={KIND_LABEL[c.kind]} size={14} />
                  <span class="search-name">{c.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
