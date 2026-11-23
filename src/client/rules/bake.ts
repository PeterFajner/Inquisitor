// The server's card heights and geometry (scripts/client.ts bundles this for
// Node: dist/layout/bake.js, loaded by src/lib/rules-heights.ts): every card
// of every pack, as the rules canvas draws them with no pack hidden. A card
// from the last time that still holds (same content, same names looked up)
// is kept rather than worked out again, so an edit costs one card.
import type { CardHeight, RulesGeometry, RulesHeights, RulesPayload } from "../../shared/api.ts";
import { GeoWriter } from "../../shared/layout/paint.ts";
import { buildCompendium } from "../../shared/rules/compendium.ts";
import { cardHeight, LAYOUT } from "./card-height.tsx";
import { namesOf } from "./ctx.ts";
import { holds } from "./sizes.ts";

export const build = LAYOUT;

export type Baked = { heights: RulesHeights; geometry: RulesGeometry };

/** Every card's height and geometry (the server runs this in a child process). */
export async function bakeHeights(payload: RulesPayload, prev: Baked | null): Promise<Baked> {
  const names = namesOf(buildCompendium(payload.packs));
  const same = prev?.heights.build === LAYOUT && prev.geometry?.build === LAYOUT;
  const old = same ? prev.heights.cards : {};
  const oldGeo = same ? prev.geometry.cards : {};
  // The looks table only grows, so kept cards' strings stay valid.
  const writer = new GeoWriter(same ? prev.geometry.looks : []);
  const cards: Record<string, CardHeight> = {};
  const geo: Record<string, string> = {};
  for (const { pack, entries } of payload.packs)
    for (const entry of entries) {
      const key = `${pack.id}:${entry.kind}/${entry.id}`;
      const meta = payload.meta?.[pack.id]?.[`${entry.kind}/${entry.id}`];
      const was = old[key];
      if (holds(was, entry, !!meta?.edited, names) && oldGeo[key] !== undefined) {
        cards[key] = was;
        geo[key] = oldGeo[key];
        continue;
      }
      const { ops, ...rec } = cardHeight(key, entry, meta, names);
      cards[key] = rec;
      geo[key] = writer.card(ops);
    }
  return { heights: { version: payload.version, build: LAYOUT, cards }, geometry: { version: payload.version, build: LAYOUT, looks: writer.looks, cards: geo } };
}
