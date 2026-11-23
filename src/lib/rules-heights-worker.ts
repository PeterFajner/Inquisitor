// The card heights' child process (src/lib/rules-heights.ts): the bake runs
// here, so the memory it takes (rendering ~1,000 cards makes a lot of
// short-lived garbage) is given back to the system when it exits. Gets
// {file, payload, prev} over IPC, answers with the heights.
import { pathToFileURL } from "node:url";
import type { RulesHeights, RulesPayload } from "../shared/api.ts";

type Bake = { bakeHeights(payload: RulesPayload, prev: RulesHeights | null): Promise<RulesHeights> };

process.once("message", async (m: { file: string; payload: RulesPayload; prev: RulesHeights | null }) => {
  const bake = (await import(pathToFileURL(m.file).href)) as Bake;
  process.send!(await bake.bakeHeights(m.payload, m.prev), () => process.exit(0));
});
