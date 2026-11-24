// /rules: the rules, a tab per kind (src/client/rules/RulesBook.tsx). The
// rules canvas (../rules/RulesCanvas.tsx) is shelved: docs/CANVAS.md.
import type { PageData } from "../../shared/api.ts";
import { RulesBook } from "../rules/RulesBook.tsx";

export function RulesPage({ data }: { data: PageData }) {
  return <RulesBook data={data} />;
}
