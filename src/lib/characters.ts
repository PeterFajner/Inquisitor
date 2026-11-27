// Saved characters and share links. Every read and write of them goes
// through here, and so does the permission rule:
//
// - A character with an owner is private to that account: only the owner
//   reads it by id or changes it. Anyone else sees 404.
// - A share link (/s/<token>) shows its character, read-only, to
//   anyone (its head and its whole history).
// - One without an owner was shared from a browser that kept its characters
//   itself (before visitors, November 2026): read-only for everyone, through
//   its link only. No new ones are made.
//
// Making something new needs an account, a visitor's at least (401
// account_required without a session: the browser then gets a visitor,
// src/lib/accounts.ts, and tries again). Reading lists without one gives
// empty lists.
//
// Records are opaque here beyond their shape (src/shared/record-shape.ts).
// A version is never changed or deleted on its own: edits add versions, and
// any version may be a parent, so history branches; the head says which
// version is current.
import { randomBytes } from "node:crypto";
import { all, get, NOW, run, transaction } from "./db.ts";
import { HttpError } from "./http.ts";
import type { Viewer } from "./accounts.ts";
import {
  MAX_NAME,
  type Character,
  type CharacterRecord,
  type CharacterSummary,
  type EditKind,
  type ImportResult,
  type Shared,
  type Version,
} from "../shared/api.ts";
import { isEditKind, recordShapeError } from "../shared/record-shape.ts";

export const MAX_IMPORT_CHARACTERS = 500;
export const MAX_IMPORT_VERSIONS = 1000;

const newId = (): string => randomBytes(12).toString("base64url");
const newToken = (): string => randomBytes(16).toString("base64url");

const fail = (status: number, code: string): never => {
  throw new HttpError(status, code);
};
const invalid = (field: string): never => fail(400, `invalid:${field}`);

export function requireAccount(viewer: Viewer): string {
  return viewer.accountId ?? fail(401, "account_required");
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const body = (x: unknown): Record<string, unknown> => (isObject(x) ? x : invalid("body"));

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function parseName(x: unknown, fallback = ""): string {
  if (x === undefined || x === null) return fallback;
  if (typeof x !== "string") return invalid("name");
  const name = x.trim();
  return name.length > MAX_NAME ? invalid("name") : name;
}

function parseRecord(x: unknown, field = "record"): CharacterRecord {
  const err = recordShapeError(x);
  // err is "record" or "record.<field>"; reported under `field`.
  return err ? invalid(field + err.slice("record".length)) : (x as CharacterRecord);
}

// rules_version as sent, or else the record's own rulesVersion (the
// engine's field), or null.
function parseRulesVersion(x: unknown, record?: CharacterRecord): string | null {
  if (x === undefined || x === null) {
    const own = record?.rulesVersion;
    return typeof own === "string" && own.length <= 100 ? own : null;
  }
  return typeof x === "string" && x.length <= 100 ? x : invalid("rules_version");
}

// 'duplicate' only ever comes from duplicating (or an import).
function parseKind(x: unknown, fallback: EditKind | null, allowDuplicate = false): EditKind {
  if (x === undefined && fallback) return fallback;
  if (!isEditKind(x) || (x === "duplicate" && !allowDuplicate)) return invalid("kind");
  return x;
}

const parseId = (x: unknown, field: string): string => (typeof x === "string" && x !== "" && x.length <= 100 ? x : invalid(field));

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type CharRow = { id: string; owner_id: string | null; owner_public: string | null; name: string; head_id: string; created_at: string; updated_at: string };
type VersionRow = Omit<Version, "record"> & { record: string; character_id: string };

const CHAR_SELECT = `SELECT c.id, c.owner_id, a.public_id AS owner_public, c.name, c.head_id, c.created_at, c.updated_at
  FROM characters c LEFT JOIN accounts a ON a.id = c.owner_id`;
const VERSION_COLUMNS = `v.id, v.character_id, v.parent_id, v.record, v.rules_version, v.kind, v.author, v.source_id, v.created_at`;

const characterRow = (id: string): CharRow | undefined => get<CharRow>(`${CHAR_SELECT} WHERE c.id = ?1`, [id]);

function ownedCharacter(viewer: Viewer, id: string): CharRow {
  const row = characterRow(id);
  if (!row || row.owner_id === null || row.owner_id !== viewer.accountId) return fail(404, "not_found");
  return row;
}

const toVersion = (r: VersionRow): Version => ({
  id: r.id,
  parent_id: r.parent_id,
  record: JSON.parse(r.record) as CharacterRecord,
  rules_version: r.rules_version,
  kind: r.kind,
  author: r.author,
  source_id: r.source_id,
  created_at: r.created_at,
});

const versionsOf = (characterId: string): Version[] =>
  all<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM character_versions v WHERE v.character_id = ?1 ORDER BY v.created_at, v.rowid`, [
    characterId,
  ]).map(toVersion);

const versionRow = (characterId: string, versionId: string): VersionRow | undefined =>
  get<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM character_versions v WHERE v.id = ?1 AND v.character_id = ?2`, [versionId, characterId]);

const sharesOf = (characterId: string): string[] =>
  all<{ token: string }>(`SELECT token FROM shares WHERE character_id = ?1 ORDER BY created_at, rowid`, [characterId]).map((r) => r.token);

function characterOut(row: CharRow, viewer: Viewer): Character {
  const mine = row.owner_id !== null && row.owner_id === viewer.accountId;
  return {
    id: row.id,
    name: row.name,
    owner: row.owner_public,
    mine,
    head_id: row.head_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    versions: versionsOf(row.id),
    ...(mine ? { shares: sharesOf(row.id) } : {}),
  };
}

function insertVersion(o: {
  characterId: string;
  parentId: string | null;
  record: CharacterRecord;
  rulesVersion: string | null;
  kind: EditKind;
  author: string | null;
  sourceId?: string | null;
  createdAt?: string | null;
}): string {
  const id = newId();
  run(
    `INSERT INTO character_versions (id, character_id, parent_id, record, rules_version, kind, author, source_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, COALESCE(?9, ${NOW}))`,
    [id, o.characterId, o.parentId, JSON.stringify(o.record), o.rulesVersion, o.kind, o.author, o.sourceId ?? null, o.createdAt ?? null],
  );
  return id;
}

// A new character with its first version; returns its id.
function insertCharacter(o: {
  ownerId: string | null;
  name: string;
  record: CharacterRecord;
  rulesVersion: string | null;
  kind: EditKind;
  author: string | null;
  sourceId?: string | null;
}): string {
  const id = newId();
  run(`INSERT INTO characters (id, owner_id, name) VALUES (?1, ?2, ?3)`, [id, o.ownerId, o.name]);
  const head = insertVersion({ characterId: id, parentId: null, ...o });
  run(`UPDATE characters SET head_id = ?2 WHERE id = ?1`, [id, head]);
  return id;
}

const touchCharacter = (id: string, headId?: string): void => {
  if (headId) run(`UPDATE characters SET head_id = ?2, updated_at = ${NOW} WHERE id = ?1`, [id, headId]);
  else run(`UPDATE characters SET updated_at = ${NOW} WHERE id = ?1`, [id]);
};

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export function listCharacters(viewer: Viewer): CharacterSummary[] {
  const accountId = viewer.accountId;
  if (!accountId) return [];
  type Row = CharRow & { version_count: number } & { [K in keyof VersionRow as `v_${K}`]: VersionRow[K] };
  const rows = all<Row>(
    `SELECT c.id, c.owner_id, a.public_id AS owner_public, c.name, c.head_id, c.created_at, c.updated_at,
            (SELECT count(*) FROM character_versions x WHERE x.character_id = c.id) AS version_count,
            v.id AS v_id, v.character_id AS v_character_id, v.parent_id AS v_parent_id, v.record AS v_record,
            v.rules_version AS v_rules_version, v.kind AS v_kind, v.author AS v_author, v.source_id AS v_source_id,
            v.created_at AS v_created_at
       FROM characters c JOIN accounts a ON a.id = c.owner_id JOIN character_versions v ON v.id = c.head_id
      WHERE c.owner_id = ?1
      ORDER BY c.updated_at DESC, c.rowid DESC`,
    [accountId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    owner: r.owner_public,
    mine: true,
    head_id: r.head_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    version_count: r.version_count,
    head: toVersion({
      id: r.v_id,
      character_id: r.v_character_id,
      parent_id: r.v_parent_id,
      record: r.v_record,
      rules_version: r.v_rules_version,
      kind: r.v_kind,
      author: r.v_author,
      source_id: r.v_source_id,
      created_at: r.v_created_at,
    }),
  }));
}

export function getCharacter(viewer: Viewer, id: string): Character {
  return characterOut(ownedCharacter(viewer, id), viewer);
}

export function createCharacter(viewer: Viewer, input: unknown): Character {
  const accountId = requireAccount(viewer);
  const b = body(input);
  const id = transaction(() =>
    insertCharacter({
      ownerId: accountId,
      name: parseName(b.name),
      record: parseRecord(b.record),
      rulesVersion: parseRulesVersion(b.rules_version, b.record as CharacterRecord),
      kind: parseKind(b.kind, "manual"),
      author: viewer.publicId,
    }),
  );
  return getCharacter(viewer, id);
}

export function addVersion(viewer: Viewer, id: string, input: unknown): { version: Version; head_id: string } {
  const row = ownedCharacter(viewer, id);
  const b = body(input);
  const parentId = parseId(b.parent_id, "parent_id");
  const record = parseRecord(b.record);
  const rulesVersion = parseRulesVersion(b.rules_version, record);
  const kind = parseKind(b.kind, null);
  if (b.head !== undefined && typeof b.head !== "boolean") invalid("head");
  if (!versionRow(row.id, parentId)) invalid("parent_id");
  const versionId = transaction(() => {
    const v = insertVersion({ characterId: row.id, parentId, record, rulesVersion, kind, author: viewer.publicId });
    touchCharacter(row.id, b.head === false ? undefined : v);
    return v;
  });
  return { version: toVersion(versionRow(row.id, versionId)!), head_id: b.head === false ? row.head_id : versionId };
}

export function setHead(viewer: Viewer, id: string, input: unknown): { head_id: string } {
  const row = ownedCharacter(viewer, id);
  const versionId = parseId(body(input).version_id, "version_id");
  if (!versionRow(row.id, versionId)) invalid("version_id");
  touchCharacter(row.id, versionId);
  return { head_id: versionId };
}

export function renameCharacter(viewer: Viewer, id: string, input: unknown): { name: string } {
  const row = ownedCharacter(viewer, id);
  const b = body(input);
  if (b.name === undefined) invalid("name");
  const name = parseName(b.name);
  run(`UPDATE characters SET name = ?2, updated_at = ${NOW} WHERE id = ?1`, [row.id, name]);
  return { name };
}

export function deleteCharacter(viewer: Viewer, id: string): void {
  const row = ownedCharacter(viewer, id);
  run(`DELETE FROM characters WHERE id = ?1`, [row.id]);
}

// Copies one version of `source` (default its head) into a new character
// of the viewer's, whose first version is a 'duplicate' naming it.
function duplicateInto(viewer: Viewer, accountId: string, source: CharRow, versionId: string | undefined, name: string | undefined): string {
  const v = versionRow(source.id, versionId ?? source.head_id) ?? invalid("version_id");
  return insertCharacter({
    ownerId: accountId,
    name: name ?? source.name,
    record: JSON.parse(v.record) as CharacterRecord,
    rulesVersion: v.rules_version,
    kind: "duplicate",
    author: viewer.publicId,
    sourceId: v.id,
  });
}

function duplicateArgs(input: unknown): { versionId?: string; name?: string } {
  const b = input === undefined || input === null ? {} : body(input);
  return {
    versionId: b.version_id === undefined ? undefined : parseId(b.version_id, "version_id"),
    name: b.name === undefined ? undefined : parseName(b.name),
  };
}

export function duplicateCharacter(viewer: Viewer, id: string, input: unknown): Character {
  const source = ownedCharacter(viewer, id);
  const accountId = source.owner_id!;
  const { versionId, name } = duplicateArgs(input);
  const newId = transaction(() => duplicateInto(viewer, accountId, source, versionId, name));
  return getCharacter(viewer, newId);
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

// The character's link (made the first time, the same one after).
export function shareCharacter(viewer: Viewer, id: string): { token: string } {
  const row = ownedCharacter(viewer, id);
  const token = sharesOf(row.id)[0] ?? newToken();
  run(`INSERT OR IGNORE INTO shares (token, character_id) VALUES (?1, ?2)`, [token, row.id]);
  return { token };
}

type ShareRow = { character_id: string };
const shareRow = (token: string): ShareRow | undefined => get<ShareRow>(`SELECT character_id FROM shares WHERE token = ?1`, [token]);

// The link stops working. Only the owner of what it shows can.
export function revokeShare(viewer: Viewer, token: string): void {
  const share = shareRow(token) ?? fail(404, "not_found");
  ownedCharacter(viewer, share.character_id);
  run(`DELETE FROM shares WHERE token = ?1`, [token]);
}


export function resolveShare(viewer: Viewer, token: string): Shared {
  const share = shareRow(token) ?? fail(404, "not_found");
  return { kind: "character", token, character: characterOut(characterRow(share.character_id)!, viewer) };
}

// What a share link shows, copied into the viewer's account (one version,
// default its head).
export function duplicateShared(viewer: Viewer, token: string, input: unknown): { character: Character } {
  const accountId = requireAccount(viewer);
  const share = shareRow(token) ?? fail(404, "not_found");
  const { versionId, name } = duplicateArgs(input);
  const source = characterRow(share.character_id)!;
  const id = transaction(() => duplicateInto(viewer, accountId, source, versionId, name));
  return { character: getCharacter(viewer, id) };
}

// ---------------------------------------------------------------------------
// Import: the browser's characters move into the account
// ---------------------------------------------------------------------------

// Characters a browser kept itself (before visitors, November
// 2026: localStorage) become the account's, with their history (ImportBody
// in src/shared/api.ts); the browser sends them once, as a visitor or
// signed in. It's safe to repeat: a local_id already imported into this
// account maps to what it became. All or nothing: one bad record and
// nothing is imported. The warbands it kept are left behind (warbands went,
// November 2026).
export function importBrowser(viewer: Viewer, input: unknown): ImportResult {
  const accountId = requireAccount(viewer);
  const b = body(input);
  const chars = b.characters === undefined ? [] : b.characters;
  if (!Array.isArray(chars) || chars.length > MAX_IMPORT_CHARACTERS) invalid("characters");

  // Check everything before writing anything.
  type V = { id: string; parentId: string | null; record: CharacterRecord; rulesVersion: string | null; kind: EditKind; createdAt: string | null };
  const parsedChars = (chars as unknown[]).map((x, i) => {
    const f = `characters.${i}`;
    const c = isObject(x) ? x : invalid(f);
    const localId = parseId(c.local_id, `${f}.local_id`);
    const versions = c.versions;
    if (!Array.isArray(versions) || versions.length === 0 || versions.length > MAX_IMPORT_VERSIONS) invalid(`${f}.versions`);
    const seen = new Set<string>();
    const vs: V[] = (versions as unknown[]).map((y, j) => {
      const vf = `${f}.versions.${j}`;
      const v = isObject(y) ? y : invalid(vf);
      const id = parseId(v.id, `${vf}.id`);
      // Parents come first: the first version is the root, every other
      // names one listed before it.
      const parentId = j === 0 ? (v.parent_id === null || v.parent_id === undefined ? null : invalid(`${vf}.parent_id`)) : parseId(v.parent_id, `${vf}.parent_id`);
      if (seen.has(id) || (parentId !== null && !seen.has(parentId))) invalid(`${vf}.${seen.has(id) ? "id" : "parent_id"}`);
      seen.add(id);
      const createdAt = typeof v.created_at === "string" && ISO.test(v.created_at) ? v.created_at : null;
      return {
        id,
        parentId,
        record: parseRecord(v.record, `${vf}.record`),
        rulesVersion: parseRulesVersion(v.rules_version, v.record as CharacterRecord),
        kind: parseKind(v.kind, "import", true),
        createdAt,
      };
    });
    const head = c.head === undefined ? vs[vs.length - 1].id : parseId(c.head, `${f}.head`);
    if (!seen.has(head)) invalid(`${f}.head`);
    return { localId, name: parseName(c.name), versions: vs, head };
  });
  return transaction(() => {
    // (null-prototype maps: a local id may be "__proto__" or "constructor")
    const out: ImportResult = { characters: Object.create(null) };
    for (const c of parsedChars) {
      const existing = get<{ id: string }>(`SELECT id FROM characters WHERE owner_id = ?1 AND import_key = ?2`, [accountId, c.localId]);
      if (existing) {
        out.characters[c.localId] = existing.id;
        continue;
      }
      const id = newId();
      run(`INSERT INTO characters (id, owner_id, name, import_key) VALUES (?1, ?2, ?3, ?4)`, [id, accountId, c.name, c.localId]);
      const ids = new Map<string, string>();
      for (const v of c.versions) {
        ids.set(
          v.id,
          insertVersion({
            characterId: id,
            parentId: v.parentId === null ? null : ids.get(v.parentId)!,
            record: v.record,
            rulesVersion: v.rulesVersion,
            kind: v.kind,
            author: viewer.publicId,
            createdAt: v.createdAt,
          }),
        );
      }
      run(`UPDATE characters SET head_id = ?2 WHERE id = ?1`, [id, ids.get(c.head)!]);
      out.characters[c.localId] = id;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// A visitor signing in: its things move into the account
// ---------------------------------------------------------------------------

// Every character of account `from` becomes `to`'s, ids and
// share links unchanged; versions `from` wrote name `to` as their author
// (the same person). An import key `to` already has is dropped from the
// moved one (both came from the same browser). Run inside a transaction.
export function moveAccountData(from: string, to: string): void {
  const fromPublic = get<{ public_id: string }>(`SELECT public_id FROM accounts WHERE id = ?1`, [from])?.public_id;
  const toPublic = get<{ public_id: string }>(`SELECT public_id FROM accounts WHERE id = ?1`, [to])?.public_id;
  if (!fromPublic || !toPublic) return;
  run(
    `UPDATE characters SET import_key = NULL
      WHERE owner_id = ?1 AND import_key IN (SELECT import_key FROM characters WHERE owner_id = ?2 AND import_key IS NOT NULL)`,
    [from, to],
  );
  run(
    `UPDATE character_versions SET author = ?3
      WHERE author = ?2 AND character_id IN (SELECT id FROM characters WHERE owner_id = ?1)`,
    [from, fromPublic, toPublic],
  );
  run(`UPDATE characters SET owner_id = ?2 WHERE owner_id = ?1`, [from, to]);
}
