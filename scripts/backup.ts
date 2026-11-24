// Nightly snapshot (same pattern as speci): SQLite's online backup of the
// database (safe while the app is running, unlike copying the file in WAL
// mode) and a git bundle of the rules repo, into data/backups/, keeping the
// last 7 of each. panoramix pulls data/backups/ off the box afterwards and
// copies it to OneDrive (deploy/panoramix/). The rules repo has no remote and
// is never pushed anywhere; the bundle is its backup.
//
//   node dist/scripts/backup.js        (deploy/inquisitor-snapshot.timer, 04:40)
import { backup, DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const KEEP = 7;
const dbPath = process.env.DATABASE_PATH || "data/inquisitor.db";
const rulesDir = process.env.RULES_DIR || "data/rules";
const dir = join(dirname(dbPath), "backups");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);

// 1. The database. One self-contained file (the copy inherits WAL mode, which
// leaves -wal and -shm files beside it), then a check that it opens and has
// the tables.
const out = join(dir, `inquisitor-${stamp}.db`);
const source = new DatabaseSync(dbPath, { readOnly: true });
const pages = await backup(source, out);
source.close();
const copy = new DatabaseSync(out);
copy.exec("PRAGMA journal_mode = DELETE");
const count = (table: string) => (copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const accounts = count("accounts");
const characters = count("characters");
const warbands = count("warbands");
copy.close();

// 2. The rules repo: a bundle of every ref, verified, renamed into place only
// once whole.
const git = (...args: string[]) => execFileSync("git", ["-C", rulesDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const bundle = join(dir, `rules-${stamp}.bundle`);
const part = `${bundle}.part`;
git("bundle", "create", "--quiet", part, "--all");
git("bundle", "verify", "--quiet", part);
renameSync(part, bundle);
const head = git("rev-parse", "--short", "HEAD").trim();

const prune = (re: RegExp) => {
  const old = readdirSync(dir).filter((f) => re.test(f)).sort().slice(0, -KEEP);
  for (const f of old) rmSync(join(dir, f));
  return old.length;
};
const removed = prune(/^inquisitor-\d{4}-\d{2}-\d{2}\.db$/) + prune(/^rules-\d{4}-\d{2}-\d{2}\.bundle$/);
console.log(
  `backup: ${out} (${pages} pages, ${accounts} accounts, ${characters} characters, ${warbands} warbands); ` +
    `${bundle} (rules at ${head}); removed ${removed} old`,
);
