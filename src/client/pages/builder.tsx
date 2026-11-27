// "/", "/c/<id>": the builder. One page for both: it's kept while another
// is shown (src/client/lib/router.ts), and `seq` says when it's sent to
// another character.
import type { PageProps } from "../lib/router.ts";
import { Builder } from "../builder/Builder.tsx";

export function BuilderPage({ data, seq }: PageProps) {
  return <Builder data={data} seq={seq} />;
}
