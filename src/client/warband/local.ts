// Warbands kept in this browser (signed out), like the builder's characters
// (src/client/lib/characters.ts): the API's Warband shape, its
// character_ids naming this browser's characters. They move into the
// account with the characters on sign-in (ImportBody.warbands). Storage
// only: no imports from the character store, so it can use this.
import type { ImportResult, ImportWarband, Warband } from "../../shared/api.ts";

const KEY = "inquisitor:warbands:v1";

export function readWarbands(): Warband[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as { warbands?: Warband[] }) : null;
    return Array.isArray(data?.warbands) ? data.warbands : [];
  } catch {
    return [];
  }
}

export function writeWarbands(warbands: Warband[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ warbands }));
  } catch {
    throw new Error("storage");
  }
}

/** The browser's warbands as ImportWarbands, keeping only members that are among `characterIds` (the import's local ids). */
export function localWarbandImports(characterIds: Set<string>): ImportWarband[] {
  return readWarbands().map((w) => ({ local_id: w.id, name: w.name, characters: w.character_ids.filter((id) => characterIds.has(id)) }));
}

/** Removes the warbands the server took. */
export function clearImportedWarbands(result: ImportResult): void {
  const done = new Set(Object.keys(result.warbands ?? {}));
  if (!done.size) return;
  try {
    writeWarbands(readWarbands().filter((w) => !done.has(w.id)));
  } catch {}
}
