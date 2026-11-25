// "/s/<token>": a share link, read-only ("/s/<token>?print": as the print sheet).
import type { PageProps } from "../lib/router.ts";
import { SharedView } from "../builder/Shared.tsx";
import { isPrintView, SharePrint } from "../print/SharePrint.tsx";

export function SharePage({ data }: PageProps) {
  if (!data.share) return <main />;
  return isPrintView() ? <SharePrint share={data.share} /> : <SharedView share={data.share} />;
}
