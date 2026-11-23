// Inquisitor's API, version 1 (/api/v1): the shapes its endpoints take and
// return, which are also what pages embed (PageData). src/lib builds them,
// src/client renders them. Types only, plus constants both sides need.
//
// Timestamps are ISO 8601 (UTC). Field names are snake_case. Errors are
// {error: "<code>"} (codes, not sentences: the app shows no text but the
// book's), with account: "required" when the request needs a signed-in
// account. New fields may be added within v1; existing ones keep their
// meaning.

export const API = "/api/v1";

// What made a version. 'duplicate' is only ever a character's first version
// (copied from another character's version, named by source_id); 'import'
// is a version that came from a browser's local storage or a file.
export const EDIT_KINDS = ["roll", "choice", "override", "reroll", "luna", "manual", "import", "duplicate"] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

// A character record, as the engine (src/shared/engine) reads it. The
// server stores it opaquely and only checks its shape
// (src/shared/record-shape.ts): these fields must be there, anything else
// is kept as sent.
export type CharacterRecord = {
  /** Record format version. */
  v: number;
  /** Rule packs, in stacking order (e.g. ["loyalist"]). */
  packs: string[];
  archetype: string;
  subtype: string | null;
  /** Dice results by decision key (`<entry id>/<effect id>[#n]`). */
  dice: Record<string, number | number[]>;
  /** Choices by decision key. */
  choices: Record<string, unknown>;
  /** Rule overrides (the engine's format). */
  overrides: Record<string, unknown> | unknown[];
  [key: string]: unknown;
};

export type Version = {
  id: string;
  /** null only for a character's first version. Any version may be a parent (branches). */
  parent_id: string | null;
  record: CharacterRecord;
  /** The rules version (rules repo commit) the record was built against. */
  rules_version: string | null;
  kind: EditKind;
  /** The editor's public account id (AccountInfo.public_id); null when made signed out. */
  author: string | null;
  /** On a 'duplicate' version: the version it was copied from. */
  source_id: string | null;
  created_at: string;
};

export type Character = {
  id: string;
  name: string;
  /** The owner's public id; null for a character shared from a browser that wasn't signed in. */
  owner: string | null;
  /** The viewer owns it (may edit). */
  mine: boolean;
  head_id: string;
  created_at: string;
  updated_at: string;
  /** Every version, oldest first: a tree by parent_id. */
  versions: Version[];
  /** Its share tokens (/s/<token>); only on the owner's own characters. */
  shares?: string[];
};

// A list row: the head version only.
export type CharacterSummary = Omit<Character, "versions" | "shares"> & { head: Version; version_count: number };

export type Warband = {
  id: string;
  name: string;
  owner: string | null;
  mine: boolean;
  /** In order. */
  character_ids: string[];
  created_at: string;
  updated_at: string;
  shares?: string[];
};

export type AccountInfo = { signed_in: boolean; public_id: string | null };

// What a share link (/s/<token>, GET /api/v1/share/<token>) shows.
export type Shared =
  | { kind: "character"; token: string; character: Character }
  | { kind: "warband"; token: string; warband: Warband; characters: Character[] };

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export type NewCharacter = { name?: string; record: CharacterRecord; rules_version?: string | null; kind?: EditKind };
export type NewVersion = {
  parent_id: string;
  record: CharacterRecord;
  rules_version?: string | null;
  kind: EditKind;
  /** Move the head to the new version (default true). */
  head?: boolean;
};
export type NewWarband = { name?: string; character_ids?: string[] };

// Characters and warbands kept in a browser before signing in, moved into
// the account (POST /api/v1/import, or `import` on the passkey sign-in and
// register steps). local_id is the browser's own id: importing the same one
// again returns the same character instead of a copy. Versions keep their
// tree (ids are the browser's, remapped); head names one of them (default:
// the last). A warband's characters are local_ids from this import or ids of
// the account's characters.
export type ImportVersion = {
  id: string;
  parent_id: string | null;
  record: CharacterRecord;
  rules_version?: string | null;
  kind?: EditKind;
  created_at?: string;
};
export type ImportCharacter = { local_id: string; name?: string; versions: ImportVersion[]; head?: string };
export type ImportWarband = { local_id: string; name?: string; characters: string[] };
export type ImportBody = { characters?: ImportCharacter[]; warbands?: ImportWarband[] };
/** local_id -> server id. */
export type ImportResult = { characters: Record<string, string>; warbands: Record<string, string> };

// A read-only link to something that isn't saved in an account (POST /api/v1/share).
export type ShareSnapshot =
  | { character: NewCharacter }
  | { warband: { name?: string; characters: NewCharacter[] } };

export type ApiError = { error: string; account?: "required" };

// The page shell's data (<script id="data">, src/views/shell.ts), the same
// shapes the API answers with.
export type PageData = {
  account: AccountInfo;
  /** On /s/<token>. */
  share?: Shared;
  /** On /c/<id> (the viewer's own character). */
  character?: Character;
  /** On /w/<id> (the viewer's own warband). */
  warband?: { warband: Warband; characters: CharacterSummary[] };
  /** Set on an error page (404...). */
  status?: number;
};

export const MAX_NAME = 200;
/** Bytes of JSON per record. */
export const MAX_RECORD = 64 * 1024;
