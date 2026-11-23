// Minimal forward-only SQL migration runner.
// Applies every *.sql file in db/migrations in lexical order exactly once,
// tracked in a schema_migrations table. No down migrations by design — roll
// forward with a new file.
import { readdir, readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigration } from "../src/lib/migrations.ts";

// Relative to the project directory, not this file: in production this runs
// from dist/scripts/, and the .sql files stay in db/migrations.
const migrationsDir = join(process.env.APP_ROOT || process.cwd(), "db", "migrations");

// Same default as DEFAULT_DATABASE_PATH in src/lib/db.ts (not imported, so
// that opening it doesn't run first).
const path = process.env.DATABASE_PATH || "data/inquisitor.db";
await mkdir(dirname(path), { recursive: true });

const db = new DatabaseSync(path);
db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set(
    (db.prepare("SELECT filename FROM schema_migrations").all() as { filename: string }[]).map((r) => r.filename),
  );

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    process.stdout.write(`applying ${file} ... `);
    try {
      applyMigration(db, sql, () => db.prepare("INSERT INTO schema_migrations (filename) VALUES (?1)").run(file));
      console.log("ok");
      ran++;
    } catch (err) {
      console.log("FAILED");
      throw err;
    }
  }
  console.log(ran === 0 ? "nothing to apply — up to date." : `applied ${ran} migration(s).`);
} finally {
  db.close();
}
