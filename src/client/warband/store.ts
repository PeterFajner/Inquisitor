// Warbands live on the server (/api/v1/warbands...), in the session's
// account, like the characters (src/client/lib/characters.ts). A warband's
// members are list rows (the head version is all the sheet, the warnings
// and the exports need).
import { API, type CharacterSummary, type NewWarband, type Warband } from "../../shared/api.ts";
import { api } from "../lib/api.ts";
import { unwrap, withVisitor, type ListRow } from "../lib/characters.ts";

export type WarbandWithMembers = { warband: Warband; members: ListRow[] };
export type WarbandPatch = { name?: string; character_ids?: string[] };

export interface WarbandBackend {
  list(): Promise<Warband[]>;
  get(id: string): Promise<WarbandWithMembers>;
  create(body: NewWarband): Promise<Warband>;
  update(id: string, patch: WarbandPatch): Promise<Warband>;
  /** A copy with copies of its characters. */
  duplicate(id: string): Promise<Warband>;
  remove(id: string): Promise<void>;
}

const enc = encodeURIComponent;
const row = (c: CharacterSummary): ListRow => ({ id: c.id, name: c.name, head: c.head, updated_at: c.updated_at });

export const warbands: WarbandBackend = {
  async list() {
    return unwrap(await api<{ warbands: Warband[] }>(`${API}/warbands`)).warbands;
  },
  async get(id) {
    const out = unwrap(await api<{ warband: Warband; characters: CharacterSummary[] }>(`${API}/warbands/${enc(id)}`));
    return { warband: out.warband, members: out.characters.map(row) };
  },
  async create(body) {
    return unwrap(await withVisitor(() => api<{ warband: Warband }>(`${API}/warbands`, { json: body }))).warband;
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
