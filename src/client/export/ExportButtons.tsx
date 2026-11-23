// The export icons for one character or a warband: the GM's Word sheet
// (.docx) and the print view (three to a page). `rows` gives the
// characters' head versions when asked (a warband's may need loading).
import { FileDown, Printer } from "lucide-preact";
import { useState } from "preact/hooks";
import { ICON, IconButton } from "../builder/Icon.tsx";
import { W } from "../warband/labels.ts";
import { exportPrint, exportWord, type SheetSource } from "./sheets.ts";

/** `name`: the file's name (a warband's); else the characters' names. */
export function ExportButtons({ rows, disabled, name }: { rows: () => SheetSource[] | Promise<SheetSource[]>; disabled?: boolean; name?: string }) {
  const [busy, setBusy] = useState<"word" | "print" | null>(null);
  const run = async (what: "word" | "print") => {
    if (busy) return;
    setBusy(what);
    try {
      const r = await rows();
      if (what === "word") await exportWord(r, name);
      else await exportPrint(r, { onWord: () => void exportWord(r, name) });
    } catch {
      // Nothing saved or opened; the icon comes back.
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <IconButton label={W.word} disabled={disabled || busy === "word"} onClick={() => void run("word")}>
        <FileDown size={ICON} />
      </IconButton>
      <IconButton label={W.print} disabled={disabled || busy === "print"} onClick={() => void run("print")}>
        <Printer size={ICON} />
      </IconButton>
    </>
  );
}
