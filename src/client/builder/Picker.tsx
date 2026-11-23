// A modal list of the book's names to choose from: one tap picks when one
// is wanted; several are ticked and confirmed with the check icon. Long
// lists get a search field (no placeholder: its icon says what it is).
// Groups (the book's sub-headings) head their options.
import { Check, Search, X } from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ICON, IconButton } from "./Icon.tsx";
import { L } from "./labels.ts";

export type PickerOption = { id: string; label: string; group?: string; detail?: string };

type Props = {
  /** The book's name for what's being chosen: the dialog's accessible name, and printed as its heading. */
  label: string;
  options: PickerOption[];
  count?: number;
  chosen?: string[];
  /** Tabs (book words, e.g. "Talents", "Exotic Abilities"): choosing one calls onTab. */
  tabs?: { id: string; label: string }[];
  tab?: string;
  onTab?: (id: string) => void;
  onDone: (ids: string[]) => void;
  onClose: () => void;
};

const SEARCH_FROM = 10;

export function Picker(p: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const count = p.count ?? 1;
  const [sel, setSel] = useState<string[]>(p.chosen ?? []);
  const [q, setQ] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? p.options.filter((o) => o.label.toLowerCase().includes(needle) || o.group?.toLowerCase().includes(needle)) : p.options;
  }, [q, p.options]);

  const groups = useMemo(() => {
    const out: { group: string; options: PickerOption[] }[] = [];
    for (const o of shown) {
      const g = o.group ?? "";
      const last = out[out.length - 1];
      if (last && last.group === g) last.options.push(o);
      else out.push({ group: g, options: [o] });
    }
    return out;
  }, [shown]);

  const tap = (id: string) => {
    if (count === 1) return p.onDone([id]);
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < count ? [...s, id] : s));
  };

  return (
    <dialog
      ref={ref}
      class="bpick"
      aria-label={p.label}
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) p.onClose();
      }}
    >
      <div class="bpick-head">
        <strong class="bpick-title">{p.label}</strong>
        {count > 1 && (
          <IconButton label={L.save} onClick={() => p.onDone(sel)} disabled={sel.length === 0}>
            <Check size={ICON} />
          </IconButton>
        )}
        <IconButton label={L.close} onClick={p.onClose}>
          <X size={ICON} />
        </IconButton>
      </div>
      {p.tabs && (
        <div class="bpick-tabs" role="tablist">
          {p.tabs.map((t) => (
            <button type="button" role="tab" aria-selected={t.id === p.tab} class="bpick-tab" onClick={() => p.onTab?.(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {p.options.length >= SEARCH_FROM && (
        <label class="bpick-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label={L.search} title={L.search} value={q} onInput={(e) => setQ(e.currentTarget.value)} autoFocus />
        </label>
      )}
      <div class="bpick-list">
        {groups.map((g) => (
          <div role="group" aria-label={g.group || undefined}>
            {g.group && <div class="bpick-group">{g.group}</div>}
            {g.options.map((o) => {
              const on = sel.includes(o.id);
              return (
                <button type="button" class={`bpick-opt${on ? " on" : ""}`} aria-pressed={count > 1 ? on : undefined} onClick={() => tap(o.id)}>
                  <span class="bpick-opt-label">{o.label}</span>
                  {o.detail && <span class="bpick-opt-detail">{o.detail}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </dialog>
  );
}
