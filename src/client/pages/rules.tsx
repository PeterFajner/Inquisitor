// /rules: the rules, a tab per kind (src/client/rules/RulesBook.tsx). The
// rules canvas (../rules/RulesCanvas.tsx) is shelved: docs/CANVAS.md.
import type { PageProps } from "../lib/router.ts";
import { RulesBook } from "../rules/RulesBook.tsx";

export function RulesPage({ seq, active }: PageProps) {
  return <RulesBook seq={seq} live={active} />;
}
