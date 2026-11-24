// The rules page's data (and the shelved canvas's): every pack's entries with their EntryMeta, kept
// current by the live event stream (GET /api/v1/rules/events), and the
// writes (src/shared/api.ts: SaveEntry, DeleteEntry, MoveEntry, RevertEntry,
// NewPack). Keys are "<pack>:<kind>/<id>".
import {
  API, type EntryMeta, type NewPackResult, type RulesConflict, type RulesEvent, type RulesGeometry, type RulesHeights, type RulesHistory,
  type RulesIssue, type RulesPayload, type RulesWriteResult,
} from "../../shared/api.ts";
import type { Entry, Pack } from "../../shared/rules/schema.ts";
import { markSignedOut } from "../lib/account.ts";
import { loadRules } from "../lib/rules.ts";
import { store } from "../lib/store.ts";

export type Key = string;
export const keyOf = (pack: string, kind: string, id: string): Key => `${pack}:${kind}/${id}`;
export function parseKey(k: Key): { pack: string; kind: string; id: string } {
  const i = k.indexOf(":");
  const j = k.indexOf("/", i);
  return { pack: k.slice(0, i), kind: k.slice(i + 1, j), id: k.slice(j + 1) };
}

export type Item = { pack: string; entry: Entry; meta: EntryMeta | undefined };

export type RulesState = {
  loaded: boolean;
  failed: boolean;
  version: string;
  packs: Pack[];
  /** In payload order (pack, then the order the server lists them). */
  items: ReadonlyMap<Key, Item>;
  /** Cards just changed by someone (live): key → time, for a brief highlight. */
  flash: ReadonlyMap<Key, number>;
  /** Card sizes the server worked out (./sizes.ts), as of when the rules loaded; null if it couldn't. */
  heights: RulesHeights | null;
  /** What those cards look like laid out (src/shared/layout/paint.ts), for the shelved canvas: no longer served, so null. */
  geometry: RulesGeometry | null;
};

export const rules = store<RulesState>({ loaded: false, failed: false, version: "", packs: [], items: new Map(), flash: new Map(), heights: null, geometry: null });

/** The server's card sizes; it may still be working them out (202) for a moment. */
async function loadHeights(): Promise<RulesHeights | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${API}/rules/heights`, { credentials: "same-origin" });
      if (res.status === 200) return (await res.json()) as RulesHeights;
      if (res.status !== 202) return null;
    } catch {
      return null;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

function fromPayload(p: RulesPayload): Pick<RulesState, "version" | "packs" | "items"> {
  const items = new Map<Key, Item>();
  for (const { pack, entries } of p.packs)
    for (const entry of entries) items.set(keyOf(pack.id, entry.kind, entry.id), { pack: pack.id, entry, meta: p.meta?.[pack.id]?.[`${entry.kind}/${entry.id}`] });
  return { version: p.version, packs: p.packs.map((x) => x.pack), items };
}

export async function load(fresh = false): Promise<void> {
  const heights = loadHeights();
  try {
    let payload: RulesPayload;
    if (fresh) {
      const res = await fetch(`${API}/rules`, { credentials: "same-origin", cache: "no-cache" });
      if (!res.ok) throw new Error(`http_${res.status}`);
      payload = (await res.json()) as RulesPayload;
    } else payload = (await loadRules()).payload;
    rules.set({ loaded: true, failed: false, ...fromPayload(payload), heights: await heights });
  } catch {
    rules.set({ loaded: true, failed: true });
  }
}

const FLASH_MS = 1800;
let flashTimer = 0;
function sweep() {
  const now = Date.now();
  const next = new Map([...rules.get().flash].filter(([, t]) => now - t < FLASH_MS));
  rules.set({ flash: next });
  flashTimer = next.size ? window.setTimeout(sweep, FLASH_MS / 2) : 0;
}
function flash(key: Key) {
  const f = new Map(rules.get().flash);
  f.set(key, Date.now());
  rules.set({ flash: f });
  if (!flashTimer) flashTimer = window.setTimeout(sweep, FLASH_MS);
}

/** An entry's new state (from a write's answer or an event). */
export function applyEntry(pack: string, kind: string, id: string, entry: Entry | null, meta: EntryMeta | null, version: string, live = false): void {
  const s = rules.get();
  const items = new Map(s.items);
  const key = keyOf(pack, kind, id);
  if (entry) items.set(key, { pack, entry, meta: meta ?? undefined });
  else items.delete(key);
  rules.set({ items, version: version || s.version });
  if (live && entry) flash(key);
}

function applyEvent(ev: RulesEvent): void {
  if (ev.type === "entry") applyEntry(ev.pack, ev.kind, ev.id, ev.entry, ev.meta, ev.version, true);
  else if (ev.type === "pack") {
    const s = rules.get();
    const packs = s.packs.some((p) => p.id === ev.pack.id) ? s.packs.map((p) => (p.id === ev.pack.id ? ev.pack : p)) : [...s.packs, ev.pack];
    rules.set({ packs, version: ev.version });
  } else if (ev.type === "reset") {
    if (ev.version !== rules.get().version) void load(true);
  }
}

let source: EventSource | null = null;
/** Live updates; reconnects by itself (EventSource), resuming with Last-Event-ID. */
export function connect(): () => void {
  if (typeof EventSource === "undefined") return () => {};
  source?.close();
  const es = new EventSource(`${API}/rules/events`);
  source = es;
  es.onmessage = (m) => {
    try {
      applyEvent(JSON.parse(m.data) as RulesEvent);
    } catch {}
  };
  return () => {
    es.close();
    if (source === es) source = null;
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type WriteOutcome =
  | { ok: true; result: RulesWriteResult }
  | { ok: false; conflict: RulesConflict }
  | { ok: false; invalid: RulesIssue[] }
  | { ok: false; error: string; status: number };

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T | null }> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let out: T | null = null;
    try {
      out = (await res.json()) as T;
    } catch {}
    if (res.status === 401) markSignedOut();
    return { status: res.status, body: out };
  } catch {
    return { status: 0, body: null };
  }
}

async function write(path: string, body: unknown): Promise<WriteOutcome> {
  const r = await post<Record<string, unknown>>(path, body);
  const b = r.body as (RulesWriteResult & { error?: string; issues?: RulesIssue[] }) | null;
  if (r.status === 200 && b && !b.error) {
    applyEntry(b.pack, b.kind, b.id, b.entry, b.meta, b.version);
    return { ok: true, result: b };
  }
  if (r.status === 409 && b?.error === "conflict") return { ok: false, conflict: b as unknown as RulesConflict };
  if (r.status === 422 && b?.error === "invalid") return { ok: false, invalid: b.issues ?? [] };
  return { ok: false, error: b?.error ?? (r.status ? `http_${r.status}` : "network"), status: r.status };
}

export const saveEntry = (pack: string, entry: Entry, base: string | null) => write("/rules/entries", { pack, entry, base });
export const deleteEntry = (pack: string, kind: string, id: string, base: string | null) => write("/rules/entries/delete", { pack, kind, id, base });
export const revertEntry = (pack: string, kind: string, id: string, commit: string, base: string | null) =>
  write("/rules/revert", { pack, kind, id, commit, base });

/** A card's position: shown at once, then saved (last write wins). */
export function moveEntry(key: Key, pos: [number, number]): Promise<WriteOutcome> | null {
  const it = rules.get().items.get(key);
  if (!it) return null;
  const items = new Map(rules.get().items);
  items.set(key, { ...it, entry: { ...it.entry, pos } });
  rules.set({ items });
  return write("/rules/move", { pack: it.pack, kind: it.entry.kind, id: it.entry.id, pos });
}

export async function history(pack: string, kind: string, id: string): Promise<RulesHistory | null> {
  try {
    const q = new URLSearchParams({ pack, kind, id });
    const res = await fetch(`${API}/rules/history?${q}`, { credentials: "same-origin", cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as RulesHistory;
  } catch {
    return null;
  }
}

export async function newPack(id: string, name: string, ext: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await post<NewPackResult & { error?: string }>("/rules/packs", { id, name, ...(ext.length ? { extends: ext } : {}) });
  if (r.status === 200 && r.body && !r.body.error) {
    const s = rules.get();
    const pack = r.body.pack;
    if (!s.packs.some((p) => p.id === pack.id)) rules.set({ packs: [...s.packs, pack], version: r.body.version });
    return { ok: true };
  }
  return { ok: false, error: r.body?.error ?? `http_${r.status}` };
}
