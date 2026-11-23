// Characters live on the server (/api/v1/characters...), in the session's
// account: a visitor's (an account without passkeys, made on the first save)
// or a signed-in one. The API's Character (src/shared/api.ts) is a tree of
// versions by parent_id and a head. Every edit adds a version; undo/redo
// move the head.
//
// A save that makes something new answers 401 account_required when this
// browser has no session yet: withVisitor gets it a visitor and tries again.
import { API, type Character, type CharacterSummary, type NewCharacter, type NewVersion, type Version } from "../../shared/api.ts";
import { ensureVisitor, markSignedOut } from "./account.ts";
import { api, type Result } from "./api.ts";

/** A list row: enough to show the name line without the versions. */
export type ListRow = { id: string; name: string; head: Version; updated_at: string };

export interface Backend {
  list(): Promise<ListRow[]>;
  get(id: string): Promise<Character>;
  create(body: NewCharacter): Promise<Character>;
  addVersion(id: string, body: NewVersion): Promise<{ version: Version; head_id: string }>;
  setHead(id: string, versionId: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string, versionId?: string): Promise<Character>;
  remove(id: string): Promise<void>;
}

const headOf = (c: Character): Version => c.versions.find((v) => v.id === c.head_id) ?? c.versions[c.versions.length - 1];

export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  if (r.status === 401) markSignedOut();
  throw new Error(r.error);
}

/** A request that makes something new: without a session (401), this browser becomes a visitor and it is sent again. */
export async function withVisitor<T>(send: () => Promise<Result<T>>): Promise<Result<T>> {
  const r = await send();
  if (r.ok || r.status !== 401) return r;
  markSignedOut();
  await ensureVisitor();
  return send();
}

const enc = encodeURIComponent;

export const characters: Backend = {
  async list() {
    const { characters } = unwrap(await api<{ characters: CharacterSummary[] }>(`${API}/characters`));
    return characters.map((c) => ({ id: c.id, name: c.name, head: c.head, updated_at: c.updated_at }));
  },
  async get(id) {
    return unwrap(await api<{ character: Character }>(`${API}/characters/${enc(id)}`)).character;
  },
  async create(body) {
    return unwrap(await withVisitor(() => api<{ character: Character }>(`${API}/characters`, { json: body }))).character;
  },
  async addVersion(id, body) {
    return unwrap(await api<{ version: Version; head_id: string }>(`${API}/characters/${enc(id)}/versions`, { json: body }));
  },
  async setHead(id, versionId) {
    unwrap(await api(`${API}/characters/${enc(id)}/head`, { json: { version_id: versionId } }));
  },
  async rename(id, name) {
    unwrap(await api(`${API}/characters/${enc(id)}/name`, { json: { name } }));
  },
  async duplicate(id, versionId) {
    return unwrap(await api<{ character: Character }>(`${API}/characters/${enc(id)}/duplicate`, { json: versionId ? { version_id: versionId } : {} })).character;
  },
  async remove(id) {
    unwrap(await api(`${API}/characters/${enc(id)}/delete`, { method: "POST" }));
  },
};

/** A share link's character into this browser's account (a visitor's if need be). */
export async function duplicateShared(token: string, versionId?: string): Promise<Character> {
  const out = unwrap(
    await withVisitor(() => api<{ character?: Character }>(`${API}/share/${enc(token)}/duplicate`, { json: versionId ? { version_id: versionId } : {} })),
  );
  if (!out.character) throw new Error("not_character");
  return out.character;
}

// ---------------------------------------------------------------------------
// The version tree
// ---------------------------------------------------------------------------

export const headVersion = headOf;

/** The head's parent (undo), or null at the root. */
export function undoTarget(c: Character): string | null {
  return headOf(c).parent_id;
}

/**
 * The head's child to redo to: `prefer` when it is one (the version undo
 * left), else the newest child; null at a leaf.
 */
export function redoTarget(c: Character, prefer?: string | null): string | null {
  const kids = c.versions.filter((v) => v.parent_id === c.head_id);
  if (!kids.length) return null;
  if (prefer && kids.some((k) => k.id === prefer)) return prefer;
  return kids[kids.length - 1].id;
}
