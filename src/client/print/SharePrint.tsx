// A share link as the print sheet ("/s/<token>?print"): the GM's sheet,
// three to a page, read-only: the sheet's online read-only format.
import { FileDown } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import type { Shared } from "../../shared/api.ts";
import type { SheetCharacter } from "../../shared/sheet.ts";
import { ICON, IconButton } from "../builder/Icon.tsx";
import { exportWord, sheetsOf, type SheetSource } from "../export/sheets.ts";
import { headVersion } from "../lib/characters.ts";
import { E } from "../export/labels.ts";
import { PrintPage } from "./open.tsx";

export const isPrintView = (): boolean => new URLSearchParams(location.search).has("print");

export function SharePrint({ share }: { share: Shared }) {
  const rows: SheetSource[] = [{ name: share.character.name, head: headVersion(share.character) }];
  const [sheets, setSheets] = useState<SheetCharacter[] | null>(null);
  useEffect(() => {
    void sheetsOf(rows).then(setSheets, () => setSheets([]));
  }, [share.token]);
  if (!sheets) return <main class="loading" aria-busy="true" />;
  return (
    <PrintPage
      sheets={sheets}
      tools={
        <IconButton label={E.word} onClick={() => void exportWord(rows)}>
          <FileDown size={ICON} />
        </IconButton>
      }
    />
  );
}
