// Characters and warbands this browser kept itself, from before they lived
// only on the server (November 2026): localStorage "inquisitor:characters:v1"
// and "inquisitor:warbands:v1", in the API's Character and Warband shapes. On
// load they go once to POST /api/v1/import (as a visitor if this browser has
// no account yet), and the keys are removed only once the server has taken
// them. Import is idempotent (local ids), so a retry after a lost reply
// makes no copies.
import { API, type Character, type ImportBody, type ImportResult, type Warband } from "../../shared/api.ts";
import { api } from "./api.ts";
import { unwrap, withVisitor } from "./characters.ts";

const CHARACTERS = "inquisitor:characters:v1";
const WARBANDS = "inquisitor:warbands:v1";
// Share links remembered for this browser's characters (no longer made).
const SNAPSHOTS = "inquisitor:snapshots:v1";

function read<T>(key: string, field: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const list = data?.[field];
    return Array.isArray(list) ? (list as T[]) : [];
  } catch {
    return [];
  }
}

const has = (key: string): boolean => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

const drop = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {}
};

/** The kept characters and warbands as an import, or null when there are none. */
export function legacyImportBody(): ImportBody | null {
  const characters = read<Character>(CHARACTERS, "characters").filter((c) => c && typeof c.id === "string" && Array.isArray(c.versions) && c.versions.length);
  const ids = new Set(characters.map((c) => c.id));
  const warbands = read<Warband>(WARBANDS, "warbands").filter((w) => w && typeof w.id === "string");
  if (!characters.length && !warbands.length) return null;
  return {
    characters: characters.map((c) => ({
      local_id: c.id,
      name: c.name,
      head: c.head_id,
      versions: c.versions.map((v) => ({
        id: v.id,
        parent_id: v.parent_id,
        record: v.record,
        rules_version: v.rules_version,
        kind: v.kind,
        created_at: v.created_at,
      })),
    })),
    warbands: warbands.map((w) => ({
      local_id: w.id,
      name: w.name,
      characters: (Array.isArray(w.character_ids) ? w.character_ids : []).filter((id) => ids.has(id)),
    })),
  };
}

let running: Promise<ImportResult | null> | null = null;

/**
 * Sends this browser's kept characters and warbands to the server once and
 * then forgets them here; what they became (local id -> server id), or null
 * when there was nothing to send. Throws when the server didn't take them
 * (they stay here for the next load).
 */
export function migrateLegacy(): Promise<ImportResult | null> {
  running ??= (async () => {
    try {
      const body = legacyImportBody();
      if (!body) {
        // Empty lists left behind, and the old share-link memo.
        for (const k of [CHARACTERS, WARBANDS, SNAPSHOTS]) if (has(k)) drop(k);
        return null;
      }
      let result: ImportResult;
      // The server parses one large body at a time ("busy"): try again shortly.
      for (let attempt = 1; ; attempt++) {
        const out = await withVisitor(() => api<ImportResult>(`${API}/import`, { json: body }));
        if (out.ok || out.error !== "busy" || attempt >= 5) {
          result = unwrap(out);
          break;
        }
        await new Promise((done) => setTimeout(done, 1500 * attempt));
      }
      // All or nothing on the server: every local id is mapped.
      for (const k of [CHARACTERS, WARBANDS, SNAPSHOTS]) drop(k);
      return result;
    } finally {
      running = null;
    }
  })();
  return running;
}
