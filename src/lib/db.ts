import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// One shared connection for the process. node:sqlite is synchronous, which
// suits SQLite on local disk: queries take microseconds, and a transaction
// is a plain function call (transaction() below).

export const DEFAULT_DATABASE_PATH = "data/inquisitor.db";

export function openDatabase(): DatabaseSync {
  const path = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout first: switching to WAL takes a lock, and a script may have
  // the file open.
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
  return db;
}

export const db: DatabaseSync = openDatabase();

// Prepared statements are cached by their SQL. Each one holds native SQLite
// memory the garbage collector can't see (in speci, preparing per query made
// the process grow by ~100 MB over a few hundred page loads).
const statements = new Map<string, StatementSync>();

function prepared(text: string): StatementSync {
  let stmt = statements.get(text);
  if (!stmt) {
    stmt = db.prepare(text);
    statements.set(text, stmt);
  }
  return stmt;
}

// Positional params bind to ?1, ?2, … in the SQL. Use the numbered form, not
// bare `?`, so a param can appear more than once.
export function all<T extends object = Record<string, unknown>>(text: string, params: SQLInputValue[] = []): T[] {
  // node:sqlite returns null-prototype objects; copy into plain ones.
  return prepared(text)
    .all(...params)
    .map((row) => ({ ...row }) as T);
}

export function get<T extends object = Record<string, unknown>>(text: string, params: SQLInputValue[] = []): T | undefined {
  const row = prepared(text).get(...params);
  return row ? ({ ...row } as T) : undefined;
}

export function run(text: string, params: SQLInputValue[] = []): { changes: number } {
  return { changes: Number(prepared(text).run(...params).changes) };
}

// Runs `fn` in one write transaction (BEGIN IMMEDIATE), rolled back if it
// throws. Not reentrant: don't nest.
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// ISO 8601 UTC with milliseconds, as every table stores timestamps.
export const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
