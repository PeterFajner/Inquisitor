// The rules in the browser: GET /api/v1/rules (every pack, version = the
// rules repo's HEAD commit) stacked into a compendium. The payload is kept
// in IndexedDB by version: offline, the last one seen loads from there
// (online, an ETag makes an unchanged answer a cheap 304), and older
// versions stay around so a character pinned to them can show what an
// update changes (diff needs the old rules too).
import { API, type RulesPayload } from "../../shared/api.ts";
import { buildCompendium, type Compendium } from "../../shared/rules/compendium.ts";
import { store } from "./store.ts";

export type Rules = { version: string; payload: RulesPayload; compendium: Compendium };

/** How many rules versions IndexedDB keeps (newest first). */
const KEEP = 6;
const DB = "inquisitor-rules";
const STORE = "payloads";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((done) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "version" });
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      req.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });
}

type Row = { version: string; payload: RulesPayload; at: number };

async function readRow(version: string): Promise<Row | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((done) => {
    try {
      const req = db.transaction(STORE).objectStore(STORE).get(version);
      req.onsuccess = () => done((req.result as Row | undefined) ?? null);
      req.onerror = () => done(null);
    } catch {
      done(null);
    }
  });
}

async function allRows(): Promise<Row[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((done) => {
    try {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => done((req.result as Row[]) ?? []);
      req.onerror = () => done([]);
    } catch {
      done([]);
    }
  });
}

async function writeRow(payload: RulesPayload): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const rows = await allRows();
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    os.put({ version: payload.version, payload, at: Date.now() } satisfies Row);
    const old = rows.filter((r) => r.version !== payload.version).sort((a, b) => b.at - a.at).slice(KEEP - 1);
    for (const r of old) os.delete(r.version);
  } catch {}
}

const LAST = "inquisitor:rules-version";
const compendiums = new Map<string, Rules>();

function rulesOf(payload: RulesPayload): Rules {
  let r = compendiums.get(payload.version);
  if (!r) {
    r = { version: payload.version, payload, compendium: buildCompendium(payload.packs) };
    compendiums.set(payload.version, r);
  }
  return r;
}

/** The current rules (null until loaded). */
export const currentRules = store<{ rules: Rules | null }>({ rules: null });

let loading: Promise<Rules> | null = null;

/** The current rules: the network's, or offline the last ones this browser kept. */
export function loadRules(): Promise<Rules> {
  if (loading) return loading;
  loading = (async () => {
    const net = fetch(`${API}/rules`, { credentials: "same-origin" }).then(async (res) => {
      if (!res.ok) throw new Error(`http_${res.status}`);
      return (await res.json()) as RulesPayload;
    });
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST);
    } catch {}
    try {
      const payload = await net;
      const r = rulesOf(payload);
      currentRules.set({ rules: r });
      try {
        localStorage.setItem(LAST, payload.version);
      } catch {}
      void writeRow(payload);
      return r;
    } catch (e) {
      // Offline: the last rules this browser saw.
      const row = last ? await readRow(last) : null;
      if (!row) throw e;
      const r = rulesOf(row.payload);
      currentRules.set({ rules: r });
      return r;
    }
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Rules at an older version, if this browser kept them. */
export async function rulesAt(version: string | null | undefined): Promise<Rules | null> {
  if (!version) return null;
  const have = compendiums.get(version);
  if (have) return have;
  const row = await readRow(version);
  return row ? rulesOf(row.payload) : null;
}
