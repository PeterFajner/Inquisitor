// The shape a character record must have to be stored. Structural only: the
// engine (src/shared/engine) decides what a record means; the server keeps
// records opaquely and checks just this, so a broken client can't store
// something the engine will choke on at the top level.
import { EDIT_KINDS, MAX_RECORD, type CharacterRecord, type EditKind } from "./api.ts";

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

// null when it's fine, otherwise the field that isn't ("record.dice"...).
export function recordShapeError(x: unknown): string | null {
  if (!isObject(x)) return "record";
  if (!isInt(x.v) || x.v < 1) return "record.v";
  if (!Array.isArray(x.packs) || x.packs.length === 0 || !x.packs.every((p) => typeof p === "string" && p !== "")) return "record.packs";
  if (typeof x.archetype !== "string" || x.archetype === "") return "record.archetype";
  if (x.subtype !== null && typeof x.subtype !== "string") return "record.subtype";
  if (!isObject(x.dice)) return "record.dice";
  for (const d of Object.values(x.dice)) {
    if (!isInt(d) && !(Array.isArray(d) && d.every(isInt))) return "record.dice";
  }
  if (!isObject(x.choices)) return "record.choices";
  if (!isObject(x.overrides) && !Array.isArray(x.overrides)) return "record.overrides";
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(x)).length;
  } catch {
    return "record";
  }
  if (size > MAX_RECORD) return "record.size";
  return null;
}

export const isRecord = (x: unknown): x is CharacterRecord => recordShapeError(x) === null;

export const isEditKind = (x: unknown): x is EditKind => typeof x === "string" && (EDIT_KINDS as readonly string[]).includes(x);
