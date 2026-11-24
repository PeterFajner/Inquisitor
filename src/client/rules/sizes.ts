// Card sizes on the rules canvas. A card's width follows its kind and
// content; its height is worked out from its content (./card-height.tsx,
// src/shared/layout), not measured: the server works out every card's
// (GET /api/v1/rules/heights) and the browser the few it has to (an entry
// edited since, a pack hidden that renames what a card names).
//
// A card is as wide as widthOf says, or wider when a table in it wouldn't fit
// (it would scroll). A size holds while what it was worked out from holds:
// the entry (its JSON) and edited mark (contentKey), and every name,
// die or column the card looked up in other entries (its deps: hashed, so
// the browser checks them against its own compendium). Pure.
import type { CardHeight } from "../../shared/api.ts";
import type { Entry } from "../../shared/rules/schema.ts";
import type { Names, RefKind } from "./ctx.ts";

export const COL = 320;
export const GAP = 16;
export const WIDE = 2 * COL + GAP;
export const XWIDE = 3 * COL + 2 * GAP;

const jsonCache = new WeakMap<Entry, string>();
export const jsonOf = (e: Entry): string => {
  let j = jsonCache.get(e);
  if (j === undefined) jsonCache.set(e, (j = JSON.stringify(e)));
  return j;
};

/** A card's width to begin with: wide for archetypes, rules and tables with columns or long rows; a third column for very long entries (Cherubim). */
export function widthOf(e: Entry): number {
  switch (e.kind) {
    case "archetype":
      return jsonOf(e).length > 14000 ? XWIDE : WIDE;
    case "rule":
      return WIDE;
    case "table":
      if ((e.columns?.length ?? 0) > 5) return XWIDE;
      return e.columns?.length || e.rows.some((r) => r.label.length > 48 || r.effects.length > 2) ? WIDE : COL;
    case "item":
      return e.profile && Object.keys(e.profile).length > 4 ? WIDE : COL;
    default:
      return COL;
  }
}

/** FNV-1a, 32 bits, as 8 hex digits. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** What a card's size depends on in the card itself (its entry, its edited mark), as a short key. */
export const contentKey = (e: Entry, edited: boolean): string => {
  const j = jsonOf(e);
  return `${edited ? "e" : ""}${j.length}:${fnv1a(j)}`;
};

/** The widths a card may take, narrowest first: its own, then wider ones (for a table that wouldn't fit). */
export const widthsFor = (e: Entry): number[] => [COL, WIDE, XWIDE].filter((w) => w >= widthOf(e));

/** Names that write down every lookup ("n talent/dodge" → its value) into `log`. */
export function recordingNames(names: Names, log: Map<string, string>): Names {
  return {
    name(k, id) {
      const v = names.name(k, id);
      log.set(`n ${k}/${id}`, v);
      return v;
    },
    has(k, id) {
      const v = names.has(k, id);
      log.set(`h ${k}/${id}`, v ? "1" : "");
      return v;
    },
    die(t) {
      const v = names.die(t);
      log.set(`d ${t}`, v ?? "");
      return v;
    },
    columns(t) {
      const v = names.columns(t);
      log.set(`c ${t}`, v.join("\u0001"));
      return v;
    },
    list(k) {
      const v = names.list(k);
      log.set(`l ${k}`, fnv1a(JSON.stringify(v)));
      return v;
    },
    rolledBy(t) {
      const v = names.rolledBy(t);
      log.set(`r ${t}`, v.map((x) => x.join("/")).join("\u0001"));
      return v;
    },
  };
}

/** A lookup's value, as recordingNames writes it. */
export function depValue(names: Names, dep: string): string {
  const what = dep.slice(2);
  const slash = what.indexOf("/");
  const kind = what.slice(0, slash) as RefKind;
  const id = what.slice(slash + 1);
  switch (dep[0]) {
    case "n":
      return names.name(kind, id);
    case "h":
      return names.has(kind, id) ? "1" : "";
    case "d":
      return names.die(what) ?? "";
    case "c":
      return names.columns(what).join("\u0001");
    case "l":
      return fnv1a(JSON.stringify(names.list(what as RefKind)));
    case "r":
      return names.rolledBy(what).map((x) => x.join("/")).join("\u0001");
  }
  return "";
}

export const depsHash = (values: string[]): string => fnv1a(values.join("\u0000"));

/** Whether a record still holds for this entry and these names. */
export function holds(rec: CardHeight | undefined, e: Entry, edited: boolean, names: Names): rec is CardHeight {
  if (!rec || rec.c !== contentKey(e, edited)) return false;
  return depsHash(rec.d.map((d) => depValue(names, d))) === rec.dh;
}
