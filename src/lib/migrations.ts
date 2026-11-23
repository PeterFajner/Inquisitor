import type { DatabaseSync } from "node:sqlite";

// Applies one migration file in a transaction; `record` runs inside it (the
// runner notes the file in schema_migrations). Shared by scripts/migrate.ts
// and the tests, so both apply files the same way.
//
// A file that rebuilds a table starts with "-- foreign_keys: off": the pragma
// can't change inside a transaction, and with it on, dropping the old table
// would cascade into every table that references it. The keys are checked
// before committing.
export function applyMigration(db: DatabaseSync, sql: string, record?: () => void): void {
  const keysOff = sql.startsWith("-- foreign_keys: off");
  if (keysOff) db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    db.exec(sql);
    if (keysOff) {
      const broken = db.prepare("PRAGMA foreign_key_check").all();
      if (broken.length) throw new Error(`foreign key check failed: ${JSON.stringify(broken.slice(0, 5))}`);
    }
    record?.();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  } finally {
    if (keysOff) db.exec("PRAGMA foreign_keys = ON");
  }
}
