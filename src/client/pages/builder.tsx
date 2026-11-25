// "/", "/c/<id>": the builder; "/w/<id>": one of the viewer's warbands, in
// the builder (its list column and the warband in the main column:
// src/client/warband/WarbandView.tsx). One page for all three: it's kept
// while another is shown (src/client/lib/router.ts), and `seq` says when
// it's sent to another character or warband.
import type { PageProps } from "../lib/router.ts";
import { Builder } from "../builder/Builder.tsx";

export function BuilderPage({ data, seq }: PageProps) {
  return <Builder data={data} seq={seq} />;
}
