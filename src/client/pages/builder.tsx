// "/", "/c/<id>": the builder; "/s/<token>": a share link, read-only
// ("/s/<token>?print": as the print sheet).
import type { PageData } from "../../shared/api.ts";
import { Builder } from "../builder/Builder.tsx";
import { SharedView } from "../builder/Shared.tsx";
import { isPrintView, SharePrint } from "../print/SharePrint.tsx";

export function BuilderPage({ data }: { data: PageData }) {
  if (data.share && isPrintView()) return <SharePrint share={data.share} />;
  return data.share ? <SharedView share={data.share} /> : <Builder data={data} />;
}
