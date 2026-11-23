// Where characters live: signed out, in this browser (localStorage), signed
// in, in the account (/api/v1/characters...). Both keep the same shape, the
// API's Character (src/shared/api.ts): a tree of versions by parent_id and a
// head. Every edit adds a version; undo/redo move the head.
//
// On sign-in the browser's characters go to the account (POST /api/v1/import,
// or with the passkey step) and are removed here once the server has them.
import {
  API,
  type Character,
  type CharacterSummary,
  type ImportBody,
  type ImportResult,
  type NewCharacter,
  type NewVersion,
  type Version,
} from "../../shared/api.ts";
import { clearImportedWarbands, localWarbandImports } from "../warband/local.ts";
import { markSignedOut } from "./account.ts";
import { api, type Result } from "./api.ts";

/** A list row: enough to show the name line without the versions. */
export type ListRow = { id: string; name: string; head: Version; updated_at: string; local: boolean };

export interface Backend {
  local: boolean;
  list(): Promise<ListRow[]>;
  get(id: string): Promise<Character>;
  create(body: NewCharacter): Promise<Character>;
  addVersion(id: string, body: NewVersion): Promise<{ version: Version; head_id: string }>;
  setHead(id: string, versionId: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string, versionId?: string): Promise<Character>;
  remove(id: string): Promise<void>;
}

const now = () => new Date().toISOString();
const newId = (): string =>
  typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------------------
// This browser
// ---------------------------------------------------------------------------

const KEY = "inquisitor:characters:v1";

function readAll(): Character[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as { characters?: Character[] }) : null;
    return Array.isArray(data?.characters) ? data.characters : [];
  } catch {
    return [];
  }
}

function writeAll(characters: Character[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ characters }));
  } catch {
    throw new Error("storage");
  }
}

function mutate<T>(id: string, fn: (c: Character) => T): T {
  const all = readAll();
  const c = all.find((x) => x.id === id);
  if (!c) throw new Error("not_found");
  const out = fn(c);
  c.updated_at = now();
  writeAll(all);
  return out;
}

const headOf = (c: Character): Version => c.versions.find((v) => v.id === c.head_id) ?? c.versions[c.versions.length - 1];

function localCharacter(name: string, version: Omit<Version, "id" | "parent_id" | "created_at" | "author">): Character {
  const v: Version = { id: newId(), parent_id: null, created_at: now(), author: null, ...version };
  return { id: newId(), name, owner: null, mine: true, head_id: v.id, created_at: v.created_at, updated_at: v.created_at, versions: [v] };
}

export const localBackend: Backend = {
  local: true,
  async list() {
    return readAll()
      .map((c) => ({ id: c.id, name: c.name, head: headOf(c), updated_at: c.updated_at, local: true }))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  },
  async get(id) {
    const c = readAll().find((x) => x.id === id);
    if (!c) throw new Error("not_found");
    return c;
  },
  async create(body) {
    const c = localCharacter(body.name ?? "", {
      record: body.record,
      rules_version: body.rules_version ?? null,
      kind: body.kind ?? "manual",
      source_id: null,
    });
    writeAll([c, ...readAll()]);
    return c;
  },
  async addVersion(id, body) {
    return mutate(id, (c) => {
      if (!c.versions.some((v) => v.id === body.parent_id)) throw new Error("invalid:parent_id");
      const v: Version = {
        id: newId(),
        parent_id: body.parent_id,
        record: body.record,
        rules_version: body.rules_version ?? null,
        kind: body.kind,
        author: null,
        source_id: null,
        created_at: now(),
      };
      c.versions.push(v);
      if (body.head !== false) c.head_id = v.id;
      return { version: v, head_id: c.head_id };
    });
  },
  async setHead(id, versionId) {
    mutate(id, (c) => {
      if (!c.versions.some((v) => v.id === versionId)) throw new Error("invalid:version_id");
      c.head_id = versionId;
    });
  },
  async rename(id, name) {
    mutate(id, (c) => {
      c.name = name;
    });
  },
  async duplicate(id, versionId) {
    const src = await this.get(id);
    const v = src.versions.find((x) => x.id === (versionId ?? src.head_id)) ?? headOf(src);
    const c = localCharacter(src.name, { record: v.record, rules_version: v.rules_version, kind: "duplicate", source_id: v.id });
    writeAll([c, ...readAll()]);
    return c;
  },
  async remove(id) {
    writeAll(readAll().filter((c) => c.id !== id));
  },
};

/** The browser's characters as an import (POST /api/v1/import, or with the sign-in). */
export function localImportBody(): ImportBody | null {
  const all = readAll();
  // With this browser's warbands (src/client/warband/local.ts).
  const warbands = localWarbandImports(new Set(all.map((c) => c.id)));
  if (!all.length && !warbands.length) return null;
  return {
    ...(warbands.length ? { warbands } : {}),
    characters: all.map((c) => ({
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
  };
}

/** Removes the characters the server took (ImportResult's local ids). */
export function clearImported(result: ImportResult): void {
  clearImportedWarbands(result);
  const done = new Set(Object.keys(result.characters));
  try {
    writeAll(readAll().filter((c) => !done.has(c.id)));
  } catch {}
}

// ---------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------

function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  if (r.status === 401) markSignedOut();
  throw new Error(r.error);
}

const enc = encodeURIComponent;

export const serverBackend: Backend = {
  local: false,
  async list() {
    const { characters } = unwrap(await api<{ characters: CharacterSummary[] }>(`${API}/characters`));
    return characters.map((c) => ({ id: c.id, name: c.name, head: c.head, updated_at: c.updated_at, local: false }));
  },
  async get(id) {
    return unwrap(await api<{ character: Character }>(`${API}/characters/${enc(id)}`)).character;
  },
  async create(body) {
    return unwrap(await api<{ character: Character }>(`${API}/characters`, { json: body })).character;
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

/** A share link's character into the signed-in account. */
export async function duplicateShared(token: string, versionId?: string): Promise<Character> {
  const out = unwrap(await api<{ character?: Character }>(`${API}/share/${enc(token)}/duplicate`, { json: versionId ? { version_id: versionId } : {} }));
  if (!out.character) throw new Error("not_character");
  return out.character;
}

export const backendFor = (signedIn: boolean): Backend => (signedIn ? serverBackend : localBackend);

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
