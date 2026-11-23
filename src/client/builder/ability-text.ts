// What the builder's cards say about an ability: the book's text for it.
import type { ThingKind } from "../../shared/engine/record.ts";
import { effectLists, walkEffects, type Compendium } from "../../shared/rules/compendium.ts";
import type { Effect, Entry } from "../../shared/rules/schema.ts";

/**
 * An ability's book text (its effect), for the card lists: its lines kept (a
 * list stays a list), blank lines dropped. Where the character chose among
 * named options that have their own text (Word of the Emperor's prayers), the
 * lines of the options not chosen go, and so does the "Choose one of the
 * following …:" sentence that introduced them.
 */
export function abilityText(c: Compendium, kind: ThingKind, id: string, chosen: string[] = []): string {
  const map = { talent: c.talents, exotic: c.exotics, mutation: c.mutations, power: c.powers, item: c.items }[kind];
  const e = map.get(id) as (Entry & { text?: string; effects?: Effect[] }) | undefined;
  let lines = (e?.text ?? e?.source.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!e || !chosen.length) return lines.join("\n");
  const dropped = new Set<string>();
  const options = new Set<string>();
  for (const { effects } of effectLists(e))
    walkEffects(effects, (x) => {
      if (!("pick" in x) || !x.from) return;
      const named = x.from.filter((o): o is typeof o & { name: string; text: string } => "name" in o && !!o.name && "text" in o && !!o.text);
      if (!named.some((o) => chosen.includes(o.name))) return;
      for (const o of named) {
        options.add(`${o.name}:`);
        if (!chosen.includes(o.name)) dropped.add(`${o.name}:`);
      }
    });
  if (!dropped.size) return lines.join("\n");
  const first = lines.findIndex((l) => [...options].some((d) => l.startsWith(d)));
  const isDropped = (l: string) => [...dropped].some((d) => l.startsWith(d));
  return lines
    .map((l, i) => {
      if (isDropped(l)) return "";
      // the sentence introducing the options ("Choose one of the following prayers …:") goes; what came before it stays
      if (i === first - 1 && l.endsWith(":")) return l.match(/^(.*[.!?])\s+[^.!?]*:$/)?.[1] ?? "";
      return l;
    })
    .filter(Boolean)
    .join("\n");
}
