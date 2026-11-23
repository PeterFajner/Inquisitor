// Where warbands live: signed out, in this browser (./local.ts); signed in,
// in the account (/api/v1/warbands...). One interface for both, like the
// characters' Backend (src/client/lib/characters.ts). A warband's members
// are list rows (the head version is all the sheet, the warnings and the
// exports need).
import { API, type CharacterSummary, type NewWarband, type Warband } from "../../shared/api.ts";
import { markSignedOut } from "../lib/account.ts";
import { api, type Result } from "../lib/api.ts";
import { localBackend, type ListRow } from "../lib/characters.ts";
import { readWarbands, writeWarbands } from "./local.ts";

export type WarbandWithMembers = { warband: Warband; members: ListRow[] };
export type WarbandPatch = { name?: string; character_ids?: string[] };

export interface WarbandBackend {
  local: boolean;
  list(): Promise<Warband[]>;
  get(id: string): Promise<WarbandWithMembers>;
  create(body: NewWarband): Promise<Warband>;
  update(id: string, patch: WarbandPatch): Promise<Warband>;
  /** A copy with copies of its characters. */
  duplicate(id: string): Promise<Warband>;
  remove(id: string): Promise<void>;
}

const now = () => new Date().toISOString();
const newId = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

function mutate(id: string, fn: (w: Warband) => void): Warband {
  const all = readWarbands();
  const w = all.find((x) => x.id === id);
  if (!w) throw new Error("not_found");
  fn(w);
  w.updated_at = now();
  writeWarbands(all);
  return w;
}

export const localWarbands: WarbandBackend = {
  local: true,
  async list() {
    return readWarbands().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  },
  async get(id) {
    const warband = readWarbands().find((w) => w.id === id);
    if (!warband) throw new Error("not_found");
    const rows = new Map((await localBackend.list()).map((r) => [r.id, r]));
    // A character deleted since simply isn't there any more.
    const members = warband.character_ids.map((cid) => rows.get(cid)).filter((r): r is ListRow => !!r);
    return { warband: { ...warband, character_ids: members.map((m) => m.id) }, members };
  },
  async create(body) {
    const t = now();
    const w: Warband = { id: newId(), name: body.name ?? "", owner: null, mine: true, character_ids: [...(body.character_ids ?? [])], created_at: t, updated_at: t };
    writeWarbands([w, ...readWarbands()]);
    return w;
  },
  async update(id, patch) {
    return mutate(id, (w) => {
      if (patch.name !== undefined) w.name = patch.name;
      if (patch.character_ids) w.character_ids = [...new Set(patch.character_ids)];
    });
  },
  async duplicate(id) {
    const { warband, members } = await this.get(id);
    const copies = [];
    for (const m of members) copies.push((await localBackend.duplicate(m.id)).id);
    return this.create({ name: warband.name, character_ids: copies });
  },
  async remove(id) {
    writeWarbands(readWarbands().filter((w) => w.id !== id));
  },
};

function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  if (r.status === 401) markSignedOut();
  throw new Error(r.error);
}
const enc = encodeURIComponent;
const row = (c: CharacterSummary): ListRow => ({ id: c.id, name: c.name, head: c.head, updated_at: c.updated_at, local: false });

export const serverWarbands: WarbandBackend = {
  local: false,
  async list() {
    return unwrap(await api<{ warbands: Warband[] }>(`${API}/warbands`)).warbands;
  },
  async get(id) {
    const out = unwrap(await api<{ warband: Warband; characters: CharacterSummary[] }>(`${API}/warbands/${enc(id)}`));
    return { warband: out.warband, members: out.characters.map(row) };
  },
  async create(body) {
    return unwrap(await api<{ warband: Warband }>(`${API}/warbands`, { json: body })).warband;
  },
  async update(id, patch) {
    return unwrap(await api<{ warband: Warband }>(`${API}/warbands/${enc(id)}`, { json: patch })).warband;
  },
  async duplicate(id) {
    return unwrap(await api<{ warband: Warband }>(`${API}/warbands/${enc(id)}/duplicate`, { method: "POST" })).warband;
  },
  async remove(id) {
    unwrap(await api(`${API}/warbands/${enc(id)}/delete`, { method: "POST" }));
  },
};

export const warbandsFor = (signedIn: boolean): WarbandBackend => (signedIn ? serverWarbands : localWarbands);

/** The members' ids with one moved by `by` places (clamped). */
export function moved(ids: string[], id: string, by: number): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return ids;
  const j = Math.max(0, Math.min(ids.length - 1, i + by));
  const out = ids.slice();
  out.splice(i, 1);
  out.splice(j, 0, id);
  return out;
}
