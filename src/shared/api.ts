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

/** signed_in: the session's account has a passkey (a visitor's hasn't: signed_in false, public_id null). */
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

// Characters and warbands a browser kept itself (localStorage, before
// visitors in November 2026), moved into the session's account once (POST
// /api/v1/import, as a visitor or signed in). local_id is the browser's own id: importing the same one
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
  /** Which view a path shows when it isn't implied by the data above. */
  view?: "history" | "rules";
};

export const MAX_NAME = 200;

// ---------------------------------------------------------------------------
// The rules (src/views/rules.ts, src/lib/rules-store.ts)
// ---------------------------------------------------------------------------
// data/rules is a git repository; every write below is one commit of one
// file, authored by the editor's public id (history shows "transcription"
// for the book's transcription). Writes need a signed-in account, one with a
// passkey (a visitor's or no session: 401 {error: "account_required",
// account: "required"}), are limited per
// account (429 {error: "rate_limited"}) and answer RulesWriteResult. Each
// commit is also sent to everyone on GET /api/v1/rules/events.

type RulesEntry = import("./rules/schema.ts").Entry;
type RulesPack = import("./rules/schema.ts").Pack;

/** What the rules repo knows about one entry's file. */
export type EntryMeta = {
  /** The last commit touching the file: the `base` to send when editing it. */
  commit: string;
  /** Its author: a public account id, or "transcription". */
  author: string;
  at: string;
  /** The entry changed (beyond pos/points) since its transcription: the book's quote (source.text) may be stale. */
  edited: boolean;
};

/**
 * GET /api/v1/rules: every rule pack and its entries; version = the rules
 * repo's HEAD commit (also the ETag). meta[pack]["<kind>/<id>"] is each
 * entry's EntryMeta (missing only for files never committed).
 */
export type RulesPayload = {
  version: string;
  packs: import("./rules/compendium.ts").PackEntries[];
  meta: Record<string, Record<string, EntryMeta>>;
};

/**
 * GET /api/v1/rules/heights: every card's height on the rules canvas at the
 * current rules version, worked out on the server (src/lib/rules-heights.ts,
 * src/client/rules/sizes.ts), by card key ("<pack>:<kind>/<id>"). `build`
 * names the card layout code that worked them out; the browser uses them
 * only when it runs the same. 202 {pending: true} while being worked out.
 */
export type RulesHeights = { version: string; build: string; cards: Record<string, CardHeight> };
/** A card's width and height (px), its content key, the names it looked up (deps) and their values' hash. */
export type CardHeight = { c: string; w: number; h: number; d: string[]; dh: string };

/**
 * GET /api/v1/rules/geometry: what every card of /rules/heights looks like
 * laid out (src/shared/layout/paint.ts), for the canvas to draw cards too
 * small to read: per card key, its pieces as a string against the table of
 * looks. Same version and build as the heights (a card's geometry holds
 * whenever its height does); 202 {pending: true} while being worked out.
 */
export type RulesGeometry = { version: string; build: string; looks: import("./layout/paint.ts").Look[]; cards: Record<string, string> };

/**
 * POST /api/v1/rules/entries: create or replace one entry (its file is
 * <pack>/<kind dir>/<entry.id>.yaml). base = meta.commit as last seen, or
 * null for an entry that doesn't exist yet. 404 {error: "unknown_pack"};
 * 409 RulesConflict when the file changed since base; 422 RulesInvalid when
 * the entry fails the schema or would break a cross-reference.
 */
export type SaveEntry = { pack: string; entry: RulesEntry; base: string | null };
/** POST /api/v1/rules/entries/delete. 404 when it doesn't exist; 409 / 422 as above (422: something refers to it). */
export type DeleteEntry = { pack: string; kind: string; id: string; base: string | null };
/**
 * POST /api/v1/rules/move: the card's canvas position only. No base: last
 * write wins. Rapid moves of the same card by the same account (within 5 s
 * of each other) amend one commit, so meta.commit changes with each.
 */
export type MoveEntry = { pack: string; kind: string; id: string; pos: [number, number] };
/** POST /api/v1/rules/packs: a new, empty pack. 409 {error: "exists"}; 422 for a bad id or an unknown pack in extends. */
export type NewPack = { id: string; name: string; extends?: string[] };
/**
 * POST /api/v1/rules/revert: make the entry what it was at `commit` (one of
 * its history's commits; an entry that didn't exist there is deleted), as a
 * new commit. base as for SaveEntry. 404 {error: "unknown_commit"}.
 */
export type RevertEntry = { pack: string; kind: string; id: string; commit: string; base: string | null };

/** What a write answers (200). entry null: deleted. A write that changes nothing answers the current state without a commit. */
export type RulesWriteResult = { version: string; pack: string; kind: string; id: string; entry: RulesEntry | null; meta: EntryMeta | null };
/** 409: the file changed since base; here is what it is now (entry null: deleted since; meta.commit is the new base). */
export type RulesConflict = { error: "conflict"; entry: RulesEntry | null; meta: EntryMeta | null };
/** 422: path is the schema path ("sections.0.effects.1.talent") or "" for a cross-reference problem. */
export type RulesIssue = { path: string; message: string };
export type RulesInvalid = { error: "invalid"; issues: RulesIssue[] };

/** POST /api/v1/rules/packs answers this. */
export type NewPackResult = { version: string; pack: RulesPack };

/** One commit of an entry's file. entry null: the file didn't exist after it (deleted). */
export type EntryVersion = { commit: string; author: string; at: string; message: string; entry: RulesEntry | null };
/** GET /api/v1/rules/history?pack=&kind=&id=: newest first (at most 500). */
export type RulesHistory = { pack: string; kind: string; id: string; commits: EntryVersion[] };

/**
 * GET /api/v1/rules/events (text/event-stream). Each `data:` is one
 * RulesEvent, sent after its commit; ids let EventSource resume
 * (Last-Event-ID). `reset`: events were missed (server restart, too far
 * behind): fetch GET /api/v1/rules again. ": ping" comments every 25 s.
 */
export type RulesEvent =
  | { type: "entry"; pack: string; kind: string; id: string; entry: RulesEntry | null; meta: EntryMeta | null; version: string }
  | { type: "pack"; pack: RulesPack; version: string }
  | { type: "reset"; version: string };
/** Bytes of JSON per record. */
export const MAX_RECORD = 64 * 1024;
