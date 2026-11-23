// "/w/<id>": one of the viewer's warbands, in the builder (its list column
// and the warband in the main column: src/client/warband/WarbandView.tsx).
import type { PageData } from "../../shared/api.ts";
import { Builder } from "../builder/Builder.tsx";

export function WarbandPage({ data }: { data: PageData }) {
  return <Builder data={data} />;
}
