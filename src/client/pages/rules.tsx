// /rules: the rules canvas (src/client/rules).
import type { PageData } from "../../shared/api.ts";
import { RulesCanvas } from "../rules/RulesCanvas.tsx";

export function RulesPage({ data }: { data: PageData }) {
  return <RulesCanvas data={data} />;
}
