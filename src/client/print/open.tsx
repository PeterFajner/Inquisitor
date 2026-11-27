// The print view: a share link with ?print, the sheet's online read-only
// format. Printing switches the page to the light tokens so ink lands on white paper.
import { Printer, X } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { SheetCharacter } from "../../shared/sheet.ts";
import { ICON, IconButton } from "../builder/Icon.tsx";
import { E } from "../export/labels.ts";
import { PrintSheets } from "./PrintSheets.tsx";

/** Prints with the light tokens (base.css honours data-theme="light"), then puts the theme back. */
export function printLight(): void {
  const root = document.documentElement;
  const had = root.getAttribute("data-theme");
  const restore = () => {
    if (had === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", had);
    window.removeEventListener("afterprint", restore);
  };
  root.setAttribute("data-theme", "light");
  window.addEventListener("afterprint", restore);
  window.print();
  // Browsers whose print() returns before printing still fire afterprint; this covers those that don't.
  setTimeout(() => {
    if (!matchMedia("print").matches) restore();
  }, 1000);
}

/** The sheet paper zoomed to fit the viewport's width (never larger). */
function Paper({ sheets }: { sheets: SheetCharacter[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      const paper = ref.current?.querySelector<HTMLElement>(".pb-paper");
      if (!paper || !ref.current) return;
      const natural = paper.offsetWidth / (Number(paper.style.zoom) || 1);
      const room = ref.current.clientWidth - 16;
      setZoom(Math.min(1, Math.max(0.3, room / natural)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useLayoutEffect(() => {
    const paper = ref.current?.querySelector<HTMLElement>(".pb-paper");
    if (paper) paper.style.zoom = String(zoom);
  }, [zoom]);
  return (
    <div class="print-sheet" ref={ref}>
      <PrintSheets sheets={sheets} />
    </div>
  );
}

export function PrintPage(p: { sheets: SheetCharacter[]; tools?: ComponentChildren; onClose?: () => void; autoPrint?: boolean }) {
  const closeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeRef.current?.querySelector<HTMLElement>("button")?.focus();
    if (!p.autoPrint) return;
    // After the blocks are laid out.
    const t = setTimeout(printLight, 150);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!p.onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.onClose]);
  return (
    <div class="print-page">
      <header class="print-toolbar" ref={closeRef}>
        {p.onClose ? (
          <IconButton label={E.close} onClick={p.onClose}>
            <X size={ICON} />
          </IconButton>
        ) : (
          <a class="home" href="/" aria-label="Inquisitor" title="Inquisitor">
            <img src="/static/icon.svg" alt="" width={28} height={28} />
          </a>
        )}
        <span class="gap" />
        {p.tools}
        <IconButton label={E.print} onClick={printLight}>
          <Printer size={ICON} />
        </IconButton>
      </header>
      <Paper sheets={p.sheets} />
    </div>
  );
}
