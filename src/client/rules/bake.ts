// The server's card heights (scripts/client.ts bundles this for Node:
// dist/layout/bake.js, loaded by src/lib/rules-heights.ts): every card of
// every pack, as the rules canvas draws them with no pack hidden. A height
// from the last time that still holds (same content, same names looked up)
// is kept rather than worked out again, so an edit costs one card.
import type { CardHeight, RulesHeights, RulesPayload } from "../../shared/api.ts";
import { buildCompendium } from "../../shared/rules/compendium.ts";
import { cardHeight, LAYOUT } from "./card-height.tsx";
import { namesOf } from "./ctx.ts";
import { holds } from "./sizes.ts";

export const build = LAYOUT;

/** Every card's height (the server runs this in a worker thread). */
export async function bakeHeights(payload: RulesPayload, prev: RulesHeights | null): Promise<RulesHeights> {
  const names = namesOf(buildCompendium(payload.packs));
  const old = prev?.build === LAYOUT ? prev.cards : {};
  const cards: Record<string, CardHeight> = {};
  for (const { pack, entries } of payload.packs)
    for (const entry of entries) {
      const key = `${pack.id}:${entry.kind}/${entry.id}`;
      const meta = payload.meta?.[pack.id]?.[`${entry.kind}/${entry.id}`];
      const was = old[key];
      cards[key] = holds(was, entry, !!meta?.edited, names) ? was : cardHeight(key, entry, meta, names);
    }
  return { version: payload.version, build: LAYOUT, cards };
}
