// New things: an entry of each kind, an effect of each type (the palette),
// with ids that are unique within the entry. Blanks carry no words: names
// and text are typed by the editor.
import { STATS, type Effect, type Entry } from "../../../shared/rules/schema.ts";

/** A subtype's stat line to start from. */
export const blankStats = (): Record<string, string> => Object.fromEntries(STATS.map((s) => [s, "50+2D10"]));

export function blankEntry(kind: Entry["kind"]): Entry {
  const base = { id: "", name: "", source: { page: 1 } };
  switch (kind) {
    case "archetype":
      return { ...base, kind, subtypes: [{ id: "", name: "", stats: blankStats() }], sections: [] } as unknown as Entry;
    case "item":
      return { ...base, kind, group: "" } as Entry;
    case "table":
      return { ...base, kind, die: "D100", rows: [{ range: [1, 100], label: "", effects: [] }] } as Entry;
    case "rule":
      return { ...base, kind, text: "" } as Entry;
    default:
      return { ...base, kind, text: "" } as Entry;
  }
}

/** kebab-case from a name ("Study Thy Weapon" → "study-thy-weapon"). */
export const kebab = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Every effect id (and option id) used in an entry. */
export function idsIn(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) x.forEach((v) => idsIn(v, out));
  else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      if (k === "id" && typeof v === "string") out.add(v);
      else idsIn(v, out);
    }
  }
  return out;
}

export function freshId(prefix: string, used: Set<string>): string {
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n++;
  const id = `${prefix}-${n}`;
  used.add(id);
  return id;
}

/** A new effect of a type, for the palette. `used`: the entry's ids (ids for decisions are made unique). */
export function blankEffect(type: string, used: Set<string>): Effect {
  const id = () => freshId(type, used);
  switch (type) {
    case "stat": return { stat: "WS", add: 10 };
    case "talent": return { talent: "" };
    case "exotic": return { exotic: "" };
    case "item": return { item: "" };
    case "mutation": return { mutation: "" };
    case "power": return { power: "" };
    case "pick": return { id: id(), pick: 1, from: [] };
    case "optional": return { id: id(), optional: [] };
    case "chance": return { id: id(), chance: 50, then: [] };
    case "roll": return { id: id(), roll: "" };
    case "when": return { when: { alignment: ["Radical"] }, then: [] };
    case "alignment": return { id: id(), alignment: ["Puritan", "Neutral", "Radical"] };
    case "gear": return { id: id(), gear: { count: "D6+3", availability: ["Common"] } };
    case "powers": return { id: id(), powers: { count: "D3" } };
    case "prose": return { prose: "", kind: "gameplay" };
    case "armour": return { armour: { av: 1 } };
    case "restrict": return { restrict: { pool: "item" } };
    case "exclusive": return { exclusive: { pool: "item" } };
    case "derived": return { derived: "Spd", add: 1 };
    case "attribute": return { attribute: "", add: 1 };
    case "wielded": return { wielded: [] };
    case "remove": return { remove: { talent: [] } };
    case "reloads": return { reloads: { add: 1 } };
    case "trade": return { id: id(), trade: { give: { lose: "talent" }, get: [] } };
    case "upgrade": return { id: id(), upgrade: 1 };
    case "bionics": return { id: id(), bionics: { count: 1 } };
    case "weapon": return { weapon: { profile: {} } };
    case "access": return { access: { pool: "talent", group: [] } };
    case "psyker": return { psyker: true };
    case "companion": return { companion: { archetype: "" } };
    case "warband": return { warband: { max: 1, archetype: [] } };
    case "location": return { id: id(), location: { from: ["Left Arm", "Right Arm"] } };
    default: return { prose: "", kind: "unfit" };
  }
}
