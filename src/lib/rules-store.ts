// The rules database: data/rules (RULES_DIR) is a git repository of rule
// packs (src/lib/rules-files.ts). This module keeps the loaded packs and
// each entry's git meta in memory, keyed by the repo's HEAD, and makes
// every edit one commit of one file authored by the editor's public id.
//
// - Reads (rulesPayload, rulesBody) are synchronous and cheap: HEAD is read
//   from .git directly, so a commit made outside the server (a hand edit,
//   a pull) reloads everything on the next read.
// - Writes run one at a time (a promise queue): check base, validate (the
//   schema, then the cross-references of every pack stack it's in), write
//   the file, commit it, update the memory in place, broadcast an event.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  entryRelPath,
  loadAllPacksIsolated,
  packRelPath,
  parseEntryText,
  RULES_DIR,
  serializeEntryLike,
  serializePack,
  withPos,
} from "./rules-files.ts";
import { Broadcaster } from "./events.ts";
import { buildCompendium, checkCompendium, entryKey, KIND_DIRS, withoutHidden, type PackEntries } from "../shared/rules/compendium.ts";
import { Entry, Id, Pack } from "../shared/rules/schema.ts";
import type { EntryMeta, EntryVersion, RulesEvent, RulesIssue, RulesPayload, RulesWriteResult } from "../shared/api.ts";

/** The author name of the book's transcription commits. */
export const TRANSCRIPTION = "transcription";
const EMAIL_DOMAIN = "accounts.inquisitor";
/** History reads at once (each runs two git processes). */
const HISTORY_CONCURRENT = 4;
let historyReads = 0;
/** Packs one account may create. */
export const PACKS_PER_ACCOUNT = 10;
const HISTORY_LIMIT = 500;

export const rulesEvents = new Broadcaster({ reset: () => ({ type: "reset", version: rulesVersion() }) });

// ---------------------------------------------------------------------------
// Errors a write can answer (the view turns them into replies)
// ---------------------------------------------------------------------------

export class RulesError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error));
    this.status = status;
    this.body = body;
  }
}
const invalid = (issues: RulesIssue[]) => new RulesError(422, { error: "invalid", issues });

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function git(args: string[], opts: { input?: string; env?: Record<string, string> } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", ["-C", RULES_DIR, ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (b: Buffer) => out.push(b));
    p.stderr.on("data", (b: Buffer) => err.push(b));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`git ${args[0]}: ${Buffer.concat(err).toString().trim()}`));
    });
    p.stdin.end(opts.input ?? "");
  });
}

const gitSync = (args: string[], input?: string): Buffer =>
  execFileSync("git", ["-C", RULES_DIR, ...args], { input, maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "ignore"] });

// HEAD without spawning git: .git/HEAD -> its ref (loose or packed).
export function rulesVersion(): string {
  try {
    const gitDir = join(RULES_DIR, ".git");
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    const loose = join(gitDir, ref);
    if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
    const packed = readFileSync(join(gitDir, "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
    if (packed) return packed.split(" ")[0];
  } catch {
    // not a plain repo: ask git
  }
  try {
    return gitSync(["rev-parse", "HEAD"]).toString().trim();
  } catch {
    return "uncommitted";
  }
}

// A git date (with its author's offset) as the API's UTC ISO 8601.
const utc = (d: string): string => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? d : t.toISOString();
};

// `git cat-file --batch` output: one blob (or null when missing) per request line.
function parseBatch(out: Buffer, count: number): (string | null)[] {
  const blobs: (string | null)[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const nl = out.indexOf(10, at);
    const header = out.subarray(at, nl).toString();
    at = nl + 1;
    const m = header.match(/^\S+ (\S+) (\d+)$/);
    if (!m) {
      blobs.push(null); // "<object> missing"
      continue;
    }
    const size = Number(m[2]);
    blobs.push(m[1] === "blob" ? out.subarray(at, at + size).toString("utf8") : null);
    at += size + 1;
  }
  return blobs;
}

// ---------------------------------------------------------------------------
// The loaded store
// ---------------------------------------------------------------------------

type FileLog = {
  commit: string;
  author: string;
  at: string;
  /** The last commit by TRANSCRIPTION touching the file. */
  transcribed: string | null;
};

type Store = {
  version: string;
  packs: PackEntries[];
  meta: Record<string, Record<string, EntryMeta>>;
  /** Every path git has seen (deleted files too), by path relative to RULES_DIR. */
  files: Map<string, FileLog>;
  /** The payload's JSON, made on first request per version. */
  body: string | null;
};

let store: Store | null = null;
let busy = 0;
// Transcribed entries (pos/points stripped) by "<commit>:<path>", for `edited`.
const transcribedCache = new Map<string, unknown>();

const stripped = (e: Entry | null): unknown => {
  if (!e) return null;
  const { pos: _p, points: _q, ...rest } = e as Entry & { pos?: unknown; points?: unknown };
  return JSON.parse(JSON.stringify(rest));
};

function load(): Store {
  const version = rulesVersion();
  // Hidden entries (`hidden: true`) stay in the files but the app never sees them.
  const packs = withoutHidden(loadAllPacksIsolated());
  // One pass over the whole history: each file's last commit and its last
  // transcription commit.
  const files = new Map<string, FileLog>();
  if (version !== "uncommitted") {
    let log = "";
    try {
      log = gitSync(["log", "--no-renames", "--format=%x01%H%x09%an%x09%aI", "--name-only"]).toString("utf8");
    } catch (e) {
      console.warn(`rules: git log: ${(e as Error).message}`);
    }
    for (const chunk of log.split("\x01")) {
      if (!chunk) continue;
      const lines = chunk.split("\n");
      const [commit, author, date] = lines[0].split("\t");
      const at = utc(date);
      for (const path of lines.slice(1)) {
        if (!path) continue;
        let f = files.get(path);
        if (!f) files.set(path, (f = { commit, author, at, transcribed: null }));
        if (!f.transcribed && author === TRANSCRIPTION) f.transcribed = commit;
      }
    }
  }
  // `edited`: only files edited after their transcription need the old text.
  const current = new Map<string, Entry>();
  for (const { pack, entries } of packs) for (const e of entries) current.set(entryRelPath(pack.id, e.kind, e.id), e);
  const need = [...current.keys()].filter((p) => {
    const f = files.get(p);
    return f?.transcribed && f.transcribed !== f.commit && !transcribedCache.has(`${f.transcribed}:${p}`);
  });
  if (need.length) {
    const reqs = need.map((p) => `${files.get(p)!.transcribed}:${p}`);
    const blobs = parseBatch(gitSync(["cat-file", "--batch"], reqs.join("\n") + "\n"), reqs.length);
    reqs.forEach((r, i) => transcribedCache.set(r, stripped(blobs[i] == null ? null : parseEntryText(blobs[i]!))));
  }
  const meta: Store["meta"] = {};
  for (const { pack, entries } of packs) {
    const m: Record<string, EntryMeta> = (meta[pack.id] = {});
    for (const e of entries) {
      const path = entryRelPath(pack.id, e.kind, e.id);
      const f = files.get(path);
      if (f) m[entryKey(e.kind, e.id)] = metaOf(f, path, e);
    }
  }
  return { version, packs, meta, files, body: null };
}

function metaOf(f: FileLog, path: string, e: Entry | null): EntryMeta {
  let edited = false;
  if (f.transcribed && f.transcribed !== f.commit) {
    const was = transcribedCache.get(`${f.transcribed}:${path}`);
    edited = !isDeepStrictEqual(was, stripped(e));
  }
  return { commit: f.commit, author: f.author, at: f.at, edited };
}

// The store for the current HEAD (reloaded when HEAD moved outside the server).
function current(): Store {
  if (!store || (!busy && store.version !== rulesVersion())) store = load();
  return store;
}

// Every pack with its entries and meta, as the browser receives it.
export function rulesPayload(): RulesPayload {
  const s = current();
  return { version: s.version, packs: s.packs, meta: s.meta };
}

// The same as JSON, made once per version.
export function rulesBody(): { version: string; body: string } {
  const s = current();
  s.body ??= JSON.stringify({ version: s.version, packs: s.packs, meta: s.meta } satisfies RulesPayload);
  return { version: s.version, body: s.body };
}

export function invalidateRules(): void {
  store = null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    // Pick up outside commits before taking the lock.
    current();
    busy++;
    try {
      return await fn();
    } finally {
      busy--;
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

const authorEnv = (publicId: string): Record<string, string> => {
  const email = `${publicId}@${EMAIL_DOMAIN}`;
  return { GIT_AUTHOR_NAME: publicId, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: publicId, GIT_COMMITTER_EMAIL: email };
};

// Commits exactly `path` (added, changed or deleted); returns the commit and its date.
async function commitFile(path: string, author: string, message: string, amend = false): Promise<{ commit: string; at: string }> {
  const env = authorEnv(author);
  await git(["add", "-A", "--", path], { env });
  try {
    await git(
      ["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", ...(amend ? ["--amend", "--reset-author", "--allow-empty"] : []), "-m", message, "--", path],
      { env },
    );
  } catch (e) {
    // Leave the file as committed.
    await git(["reset", "-q", "--", path]).catch(() => {});
    await git(["checkout", "-q", "HEAD", "--", path]).catch(() => {});
    throw e;
  }
  const [commit, date] = (await git(["log", "-1", "--format=%H%x09%aI"])).toString().trim().split("\t");
  return { commit, at: utc(date) };
}

function packEntries(s: Store, pack: string): PackEntries {
  const p = s.packs.find((p) => p.pack.id === pack);
  if (!p) throw new RulesError(404, { error: "unknown_pack" });
  return p;
}

const findEntry = (p: PackEntries, kind: string, id: string): Entry | null => p.entries.find((e) => e.kind === kind && e.id === id) ?? null;

// The packs a pack stacks on, then itself (the compendium a character with that pack sees).
function stackOf(s: Store, pack: string, seen = new Set<string>()): string[] {
  if (seen.has(pack)) return [];
  seen.add(pack);
  const p = s.packs.find((p) => p.pack.id === pack);
  if (!p) return [];
  return [...(p.pack.extends ?? []).flatMap((x) => stackOf(s, x, seen)), pack];
}

// Problems the change would add to any pack stack containing `pack`.
function newProblems(s: Store, pack: string, kind: string, id: string, next: Entry | null): RulesIssue[] {
  const added = new Set<string>();
  for (const top of s.packs.map((p) => p.pack.id)) {
    const ids = stackOf(s, top);
    if (!ids.includes(pack)) continue;
    const stack = ids.map((x) => packEntries(s, x));
    const changed = stack.map((p) => {
      if (p.pack.id !== pack) return p;
      const entries = p.entries.filter((e) => !(e.kind === kind && e.id === id));
      return { pack: p.pack, entries: next ? [...entries, next] : entries };
    });
    const before = new Set(checkCompendium(buildCompendium(stack)));
    for (const m of checkCompendium(buildCompendium(changed))) if (!before.has(m)) added.add(m);
  }
  return [...added].map((message) => ({ path: "", message }));
}

function checkBase(s: Store, path: string, now: Entry | null, base: unknown, pack: string, kind: string, id: string): void {
  const f = s.files.get(path);
  const meta = now && f ? s.meta[pack]?.[entryKey(kind, id)] ?? null : null;
  // An existing file: base must be its last commit. A missing one: null, or
  // the commit that deleted it.
  const ok = now ? f != null && base === f.commit : base == null || base === f?.commit;
  if (!ok) throw new RulesError(409, { error: "conflict", entry: now, meta: meta ?? (f && !now ? metaOf(f, path, null) : null) });
}

// Apply a committed change to memory and tell everyone.
function applied(s: Store, pack: string, kind: string, id: string, path: string, written: Entry | null, c: { commit: string; at: string }, author: string): RulesWriteResult {
  // An entry saved hidden leaves the app's rules like a deleted one.
  const next = written?.hidden ? null : written;
  const p = packEntries(s, pack);
  const i = p.entries.findIndex((e) => e.kind === kind && e.id === id);
  if (next) {
    if (i >= 0) p.entries[i] = next;
    else p.entries.push(next);
  } else if (i >= 0) p.entries.splice(i, 1);
  const prev = s.files.get(path);
  const f: FileLog = { commit: c.commit, author, at: c.at, transcribed: prev?.transcribed ?? null };
  s.files.set(path, f);
  const meta = metaOf(f, path, next);
  const key = entryKey(kind, id);
  if (next) (s.meta[pack] ??= {})[key] = meta;
  else delete s.meta[pack]?.[key];
  s.version = c.commit;
  s.body = null;
  rulesEvents.publish({ type: "entry", pack, kind, id, entry: next, meta, version: s.version } satisfies RulesEvent);
  return { version: s.version, pack, kind, id, entry: next, meta };
}

function unchanged(s: Store, pack: string, kind: string, id: string, now: Entry | null): RulesWriteResult {
  return { version: s.version, pack, kind, id, entry: now, meta: s.meta[pack]?.[entryKey(kind, id)] ?? null };
}

async function ensureTranscribed(s: Store, path: string): Promise<void> {
  const f = s.files.get(path);
  if (!f?.transcribed) return;
  const k = `${f.transcribed}:${path}`;
  if (transcribedCache.has(k)) return;
  const blob = parseBatch(await git(["cat-file", "--batch"], { input: k + "\n" }), 1)[0];
  transcribedCache.set(k, stripped(blob == null ? null : parseEntryText(blob)));
}

// Write (or delete) one entry's file and commit it, after the checks.
async function put(s: Store, author: string, pack: string, kind: string, id: string, next: Entry | null, message: string): Promise<RulesWriteResult> {
  const path = entryRelPath(pack, kind, id);
  const p = packEntries(s, pack);
  const now = findEntry(p, kind, id);
  if (isDeepStrictEqual(now, next)) return unchanged(s, pack, kind, id, now);
  const issues = newProblems(s, pack, kind, id, next);
  if (issues.length) throw invalid(issues);
  const abs = join(RULES_DIR, path);
  if (next) {
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, serializeEntryLike(next, existsSync(abs) ? readFileSync(abs, "utf8") : null));
  } else rmSync(abs, { force: true });
  const c = await commitFile(path, author, message);
  await ensureTranscribed(s, path);
  return applied(s, pack, kind, id, path, next, c, author);
}

// ---------------------------------------------------------------------------
// Request checks
// ---------------------------------------------------------------------------

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === "string" && Id.safeParse(x).success;
const isKind = (x: unknown): x is string => typeof x === "string" && Object.hasOwn(KIND_DIRS, x);
const isBase = (x: unknown): x is string | null | undefined => x == null || (typeof x === "string" && /^[0-9a-f]{7,64}$/.test(x));

function target(b: unknown): { pack: string; kind: string; id: string } {
  if (!isObject(b) || !isId(b.pack) || !isKind(b.kind) || !isId(b.id)) throw new RulesError(400, { error: "bad_request" });
  return { pack: b.pack, kind: b.kind, id: b.id };
}

// ---------------------------------------------------------------------------
// The operations (author = the editor's public id)
// ---------------------------------------------------------------------------

export function saveEntry(author: string, body: unknown): Promise<RulesWriteResult> {
  if (!isObject(body) || !isId(body.pack) || !isBase(body.base)) throw new RulesError(400, { error: "bad_request" });
  const r = Entry.safeParse(body.entry);
  if (!r.success) throw invalid(r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const entry = r.data;
  const pack = body.pack;
  return serial(async () => {
    const s = current();
    const now = findEntry(packEntries(s, pack), entry.kind, entry.id);
    checkBase(s, entryRelPath(pack, entry.kind, entry.id), now, body.base, pack, entry.kind, entry.id);
    return put(s, author, pack, entry.kind, entry.id, entry, `${entry.kind}/${entry.id}`);
  });
}

export function deleteEntry(author: string, body: unknown): Promise<RulesWriteResult> {
  const { pack, kind, id } = target(body);
  const base = (body as Record<string, unknown>).base;
  if (!isBase(base)) throw new RulesError(400, { error: "bad_request" });
  return serial(async () => {
    const s = current();
    const now = findEntry(packEntries(s, pack), kind, id);
    if (!now) throw new RulesError(404, { error: "not_found" });
    checkBase(s, entryRelPath(pack, kind, id), now, base, pack, kind, id);
    return put(s, author, pack, kind, id, null, `${kind}/${id}`);
  });
}

export function moveEntry(author: string, body: unknown): Promise<RulesWriteResult> {
  const { pack, kind, id } = target(body);
  const pos = (body as Record<string, unknown>).pos;
  if (!Array.isArray(pos) || pos.length !== 2 || !pos.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7)) {
    throw new RulesError(400, { error: "bad_request" });
  }
  const xy: [number, number] = [Math.round(pos[0]), Math.round(pos[1])];
  return serial(async () => {
    const s = current();
    const now = findEntry(packEntries(s, pack), kind, id);
    if (!now) throw new RulesError(404, { error: "not_found" });
    if (now.pos && now.pos[0] === xy[0] && now.pos[1] === xy[1]) return unchanged(s, pack, kind, id, now);
    const path = entryRelPath(pack, kind, id);
    const abs = join(RULES_DIR, path);
    const text = withPos(readFileSync(abs, "utf8"), xy);
    const next = parseEntryText(text) ?? { ...now, pos: xy };
    writeFileSync(abs, text);
    // A commit of its own: never amend one whose id other pages (and a
    // backup that pulls) already have.
    const c = await commitFile(path, author, `${kind}/${id}`);
    await ensureTranscribed(s, path);
    return applied(s, pack, kind, id, path, next, c, author);
  });
}

export async function entryHistory(pack: string, kind: string, id: string): Promise<EntryVersion[]> {
  if (!isId(pack) || !isKind(kind) || !isId(id)) throw new RulesError(400, { error: "bad_request" });
  const path = entryRelPath(pack, kind, id);
  // Read at the commit known now, outside the write queue (commits never
  // change), a few at a time.
  if (historyReads >= HISTORY_CONCURRENT) throw new RulesError(503, { error: "busy" });
  const at = current().version;
  historyReads++;
  try {
    const log = (await git(["log", "--no-renames", `-n${HISTORY_LIMIT}`, "--format=%H%x09%an%x09%aI%x09%s", at, "--", path])).toString("utf8");
    const rows = log.split("\n").filter(Boolean).map((l) => {
      const [commit, author, at, ...msg] = l.split("\t");
      return { commit, author, at: utc(at), message: msg.join("\t") };
    });
    if (!rows.length) return [];
    const reqs = rows.map((r) => `${r.commit}:${path}`);
    const blobs = parseBatch(await git(["cat-file", "--batch"], { input: reqs.join("\n") + "\n" }), reqs.length);
    return rows.map((r, i) => ({ ...r, entry: blobs[i] == null ? null : parseEntryText(blobs[i]!) }));
  } finally {
    historyReads--;
  }
}

export async function revertEntry(author: string, body: unknown): Promise<RulesWriteResult> {
  const { pack, kind, id } = target(body);
  const b = body as Record<string, unknown>;
  if (!isBase(b.base) || typeof b.commit !== "string" || !/^[0-9a-f]{7,64}$/.test(b.commit)) throw new RulesError(400, { error: "bad_request" });
  const history = await entryHistory(pack, kind, id);
  const commit = b.commit;
  const v = history.find((h) => h.commit === commit || h.commit.startsWith(commit));
  if (!v) throw new RulesError(404, { error: "unknown_commit" });
  return serial(async () => {
    const s = current();
    const now = findEntry(packEntries(s, pack), kind, id);
    checkBase(s, entryRelPath(pack, kind, id), now, b.base, pack, kind, id);
    if (v.entry && (v.entry.kind !== kind || v.entry.id !== id)) throw invalid([{ path: "", message: "the file held another entry then" }]);
    return put(s, author, pack, kind, id, v.entry, `${kind}/${id}\n\nRevert to ${v.commit}`);
  });
}

export function createPack(author: string, body: unknown): Promise<{ version: string; pack: Pack }> {
  if (!isObject(body)) throw new RulesError(400, { error: "bad_request" });
  const r = Pack.safeParse({ id: body.id, name: body.name, ...(body.extends == null ? {} : { extends: body.extends }) });
  if (!r.success) throw invalid(r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const pack = r.data;
  if (!pack.name.trim() || pack.name.length > 200) throw invalid([{ path: "name", message: "name" }]);
  return serial(async () => {
    const s = current();
    if (s.packs.some((p) => p.pack.id === pack.id) || existsSync(join(RULES_DIR, pack.id))) throw new RulesError(409, { error: "exists" });
    const mine = s.packs.filter((p) => s.files.get(packRelPath(p.pack.id))?.author === author).length;
    if (mine >= PACKS_PER_ACCOUNT) throw new RulesError(429, { error: "too_many_packs" });
    const unknown = (pack.extends ?? []).filter((x) => !s.packs.some((p) => p.pack.id === x));
    if (unknown.length) throw invalid(unknown.map((x) => ({ path: "extends", message: `unknown pack "${x}"` })));
    const path = packRelPath(pack.id);
    mkdirSync(join(RULES_DIR, pack.id), { recursive: true });
    writeFileSync(join(RULES_DIR, path), serializePack(pack));
    let c: { commit: string; at: string };
    try {
      c = await commitFile(path, author, `pack/${pack.id}`);
    } catch (e) {
      rmSync(join(RULES_DIR, pack.id), { recursive: true, force: true });
      throw e;
    }
    s.packs.push({ pack, entries: [] });
    s.packs.sort((a, b) => (a.pack.id < b.pack.id ? -1 : 1));
    s.meta[pack.id] = {};
    s.files.set(path, { commit: c.commit, author, at: c.at, transcribed: null });
    s.version = c.commit;
    s.body = null;
    rulesEvents.publish({ type: "pack", pack, version: s.version } satisfies RulesEvent);
    return { version: s.version, pack };
  });
}

// For tests: wait for queued writes.
export const settled = (): Promise<unknown> => queue;