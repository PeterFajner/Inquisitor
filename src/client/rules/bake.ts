// The server's card heights (scripts/client.ts bundles this for Node:
// dist/layout/bake.js, loaded by src/lib/rules-heights.ts): every card of
// every pack, at its own width, with no pack hidden. A card from the last
// time that still holds (same content, same names looked up) is kept rather
// than worked out again, so an edit costs one card. (The shelved rules
// canvas also had each card's geometry baked, to draw cards too small to
// read: no longer, docs/CANVAS.md.)
import type { CardHeight, RulesHeights, RulesPayload } from "../../shared/api.ts";
import { buildCompendium } from "../../shared/rules/compendium.ts";
import { cardHeight, LAYOUT } from "./card-height.tsx";
import { namesOf } from "./ctx.ts";
import { holds } from "./sizes.ts";

export const build = LAYOUT;

export type Baked = { heights: RulesHeights };

/** Every card's height (the server runs this in a child process). */
export async function bakeHeights(payload: RulesPayload, prev: Baked | null): Promise<Baked> {
  const names = namesOf(buildCompendium(payload.packs));
  const old = prev?.heights.build === LAYOUT ? prev.heights.cards : {};
  const cards: Record<string, CardHeight> = {};
  for (const { pack, entries } of payload.packs)
    for (const entry of entries) {
      const key = `${pack.id}:${entry.kind}/${entry.id}`;
      const meta = payload.meta?.[pack.id]?.[`${entry.kind}/${entry.id}`];
      const was = old[key];
      if (holds(was, entry, !!meta?.edited, names)) {
        cards[key] = was;
        continue;
      }
      const { ops: _, ...rec } = cardHeight(key, entry, meta, names, false, false);
      cards[key] = rec;
    }
  return { heights: { version: payload.version, build: LAYOUT, cards } };
}
