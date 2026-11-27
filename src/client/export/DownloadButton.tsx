// The Download button (owner, November 2026): the GM's sheet as a Word file
// or a PDF, split with a small arrow that opens its dropdown. The dropdown
// holds the Docx/PDF toggle and, for one of the viewer's own characters,
// "Include other characters": a searchable list of their characters to
// download with it, three to a page. With any picked the caption says
// "Warband". The format and each character's picks are kept with the
// account (src/client/lib/settings.ts).
import { ChevronDown, FileDown } from "lucide-preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ICON } from "../builder/Icon.tsx";
import { L, T } from "../builder/labels.ts";
import type { ListRow } from "../lib/characters.ts";
import { loadSettings, setFormat, setWith, settings } from "../lib/settings.ts";
import { useStore } from "../lib/store.ts";
import { exportPdf, exportWord, type SheetSource } from "./sheets.ts";
import "./download.css";

type Props = {
  /** The character shown: its id (the viewer's own, for "Include other characters") and its sheet's source. */
  self: SheetSource & { id?: string };
  /** The viewer's characters, to include (none: the dropdown has only the toggle). */
  list?: ListRow[];
  /** A list row's archetype and subtype, under its name. */
  tagOf?: (r: ListRow) => string;
  /** "bar": an icon, captioned on a wide screen (the top bar); "foot": a text button (under the card). */
  variant: "bar" | "foot";
  disabled?: boolean;
};

export function caption(format: "docx" | "pdf", warband: boolean): string {
  if (format === "pdf") return warband ? T.downloadWarbandPdf : T.downloadPdf;
  return warband ? T.downloadWarbandDocx : T.downloadDocx;
}

export function DownloadButton(p: Props) {
  const s = useStore(settings);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => void loadSettings(), []);
  const others = p.self.id && p.list ? p.list.filter((r) => r.id !== p.self.id && (s.with[p.self.id!] ?? []).includes(r.id)) : [];
  const label = caption(s.format, others.length > 0);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const rows: SheetSource[] = [{ name: p.self.name, head: p.self.head }, ...others.map((r) => ({ name: r.name, head: r.head }))];
      if (s.format === "pdf") await exportPdf(rows);
      else await exportWord(rows);
    } catch {
      // Nothing saved; the button comes back.
    } finally {
      setBusy(false);
    }
  };

  const group = useRef<HTMLSpanElement>(null);
  const arrowLabel = p.list ? T.includeOthers : `${T.docx} / ${T.pdf}`;
  return (
    <span class={`dl-split dl-${p.variant}`} ref={group}>
      {p.variant === "bar" ? (
        <button type="button" class="icon-btn captioned dl-main" aria-label={label} title={label} disabled={p.disabled || busy} onClick={() => void run()}>
          <FileDown size={ICON} />
          <span class="btn-caption" aria-hidden="true">
            {label}
          </span>
        </button>
      ) : (
        <button type="button" class="text-btn dl-main" disabled={p.disabled || busy} onClick={() => void run()}>
          {label}
        </button>
      )}
      <button
        type="button"
        class={`${p.variant === "bar" ? "icon-btn" : "text-btn"} dl-arrow`}
        aria-label={arrowLabel}
        title={arrowLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={p.disabled}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={p.variant === "bar" ? 16 : 14} />
      </button>
      {open && <Dropdown {...p} anchor={group} title={arrowLabel} onClose={() => setOpen(false)} />}
    </span>
  );
}

function Dropdown(p: Props & { anchor: { current: HTMLElement | null }; title: string; onClose: () => void }) {
  const s = useStore(settings);
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState<{ top?: number; bottom?: number; left: number; max: number } | null>(null);

  // By the button, below it or above when there's more room there, kept
  // inside the window (fixed: the top bar scrolls sideways and would clip it).
  useLayoutEffect(() => {
    const place = () => {
      const a = p.anchor.current?.getBoundingClientRect();
      const w = box.current?.offsetWidth ?? 300;
      if (!a) return;
      const left = Math.max(8, Math.min(a.right - w, window.innerWidth - w - 8));
      const below = window.innerHeight - a.bottom - 14;
      const above = a.top - 14;
      if (below >= 320 || below >= above) setAt({ top: a.bottom + 6, left, max: below });
      else setAt({ bottom: window.innerHeight - a.top + 6, left, max: above });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, []);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !p.anchor.current?.contains(t)) p.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      p.onClose();
      p.anchor.current?.querySelector<HTMLElement>(".dl-arrow")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, []);

  const id = p.self.id;
  const chosen = new Set(id ? (s.with[id] ?? []) : []);
  const rows = (p.list ?? []).filter((r) => r.id !== id);
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.name} ${p.tagOf?.(r) ?? ""}`.toLowerCase().includes(q)) : rows;
  const toggle = (rid: string) => {
    if (!id) return;
    const next = new Set(chosen);
    if (next.has(rid)) next.delete(rid);
    else next.add(rid);
    // In the list's order.
    setWith(id, rows.filter((r) => next.has(r.id)).map((r) => r.id));
  };

  return (
    <div class="dl-drop" role="dialog" aria-label={p.title} ref={box} style={
        at
          ? { left: `${at.left}px`, maxHeight: `${Math.max(160, Math.min(at.max, 480))}px`, ...(at.top !== undefined ? { top: `${at.top}px` } : { bottom: `${at.bottom}px` }) }
          : { visibility: "hidden" }
      }>
      <div class="dl-format" role="group" aria-label={`${T.docx} / ${T.pdf}`}>
        {(["docx", "pdf"] as const).map((f) => (
          <button type="button" class="dl-format-opt" aria-pressed={s.format === f} onClick={() => setFormat(f)}>
            {f === "docx" ? T.docx : T.pdf}
          </button>
        ))}
      </div>
      {p.list && id && (
        <>
          <div class="dl-title">{T.includeOthers}</div>
          <input class="dl-search" type="search" aria-label={L.search} title={L.search} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          <ul class="dl-list">
            {shown.map((r) => (
              <li>
                <label class="dl-row">
                  <input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r.id)} />
                  <span class="dl-row-text">
                    <span class="dl-row-name">{r.name || "–"}</span>
                    {p.tagOf && <span class="dl-row-tag">{p.tagOf(r)}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
