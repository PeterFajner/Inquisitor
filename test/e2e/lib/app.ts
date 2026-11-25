// The app as a shard runs it: its own temporary directory with a copy of
// the rules (a git clone of data/rules, so rule edits commit there), a fresh
// database with every migration, a free port, and the browser bundle built
// once per source state into .e2e/client/<hash> (shared by every shard; a
// lock directory makes concurrent shards wait for one build). Never the
// preview or the live site.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { stop, track } from "./procs.ts";
import { ROOT, RULES } from "./rules.ts";

const NODE = [process.execPath, "--disable-warning=ExperimentalWarning"];

function hashTree(h: ReturnType<typeof createHash>, dir: string): void {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) hashTree(h, p);
    else h.update(relative(ROOT, p)).update("\0").update(readFileSync(p)).update("\0");
  }
}

/** The client and card layout bundles for the sources as they are now (built if need be). */
export async function clientBuild(): Promise<{ client: string; layout: string }> {
  const h = createHash("sha256");
  hashTree(h, join(ROOT, "src"));
  for (const f of ["scripts/client.ts", "package-lock.json"]) h.update(readFileSync(join(ROOT, f)));
  const id = h.digest("hex").slice(0, 16);
  const base = join(ROOT, ".e2e/client");
  const dir = join(base, id);
  const out = { client: join(dir, "client"), layout: join(dir, "layout") };
  if (existsSync(join(out.client, "manifest.json"))) return out;
  mkdirSync(base, { recursive: true });
  const lock = join(base, `${id}.lock`);
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // Another shard is building it (or a stale lock: older than 5 minutes).
      if (existsSync(join(out.client, "manifest.json"))) return out;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 300_000) rmSync(lock, { recursive: true, force: true });
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
      if (i > 1200) throw new Error("waited 10 minutes for the client build");
    }
  }
  try {
    const tmp = `${dir}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    const r = spawnSync(NODE[0], [...NODE.slice(1), join(import.meta.dirname, "build-client.ts")], {
      cwd: ROOT,
      env: { ...process.env, CLIENT_OUT: join(tmp, "client"), LAYOUT_OUT: join(tmp, "layout") },
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (r.status !== 0) throw new Error(`client build failed: ${r.stderr}`);
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
    // Older builds go.
    for (const f of readdirSync(base)) if (f !== id && !f.endsWith(".lock") && !f.includes(".tmp-")) rmSync(join(base, f), { recursive: true, force: true });
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
  return out;
}

export const freePort = () =>
  new Promise<number>((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });

export type App = {
  /** http://localhost:<port>: a secure context (passkeys), same origin as PUBLIC_ORIGIN. */
  url: string;
  port: number;
  dir: string;
  rulesDir: string;
  dbPath: string;
  log: string;
  proc: ChildProcess;
  stop(): Promise<void>;
  /** The server stopped and started again on the same port, database and rules (a deploy, a crash). */
  restart(): Promise<void>;
};

/** A server of our own: temporary rules, database and port. `balance`: warm the balance distributions (off by default: ~130 MB). */
export async function startApp(opts: { balance?: boolean } = {}): Promise<App> {
  const build = await clientBuild();
  const dir = mkdtempSync(join(tmpdir(), "inquisitor-e2e-"));
  const rulesDir = join(dir, "rules");
  const clone = spawnSync("git", ["clone", "--quiet", RULES, rulesDir], { stdio: ["ignore", "ignore", "pipe"] });
  if (clone.status !== 0) throw new Error(`git clone of the rules failed: ${clone.stderr}`);
  const dbPath = join(dir, "e2e.db");
  for (let attempt = 0; ; attempt++) {
    const port = await freePort();
    const env = {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ROOT: ROOT,
      DATABASE_PATH: dbPath,
      RULES_DIR: rulesDir,
      CLIENT_OUT: build.client,
      LAYOUT_OUT: build.layout,
      BALANCE_WARM: opts.balance ? "1" : "0",
      BALANCE_DIR: join(dir, "balance"),
      PUBLIC_ORIGIN: `http://localhost:${port}`,
    };
    delete (env as Record<string, string | undefined>).PASSKEY_RP_ID;
    const m = spawnSync(NODE[0], [...NODE.slice(1), "scripts/migrate.ts"], { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });
    if (m.status !== 0) throw new Error(`migrations failed: ${m.stderr}`);
    const log = join(dir, "server.log");
    const out = createWriteStream(log, { flags: "a" });
    const proc = track(spawn(NODE[0], [...NODE.slice(1), "src/server.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] }));
    proc.stdout!.pipe(out, { end: false });
    proc.stderr!.pipe(out, { end: false });
    const url = `http://localhost:${port}`;
    let up = false;
    for (let i = 0; i < 300 && proc.exitCode === null; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).ok) {
          up = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!up) {
      await stop(proc);
      if (attempt < 3) continue; // the port was taken meanwhile: another
      throw new Error(`server didn't start: ${readFileSync(log, "utf8").slice(-2000)}`);
    }
    const up2 = async (p: ChildProcess) => {
      for (let i = 0; i < 300 && p.exitCode === null; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`server didn't start again: ${readFileSync(log, "utf8").slice(-2000)}`);
    };
    const app: App = {
      url,
      port,
      dir,
      rulesDir,
      dbPath,
      log,
      proc,
      async stop() {
        await stop(app.proc);
        rmSync(dir, { recursive: true, force: true });
      },
      async restart() {
        await stop(app.proc);
        const p = track(spawn(NODE[0], [...NODE.slice(1), "src/server.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] }));
        p.stdout!.pipe(out, { end: false });
        p.stderr!.pipe(out, { end: false });
        app.proc = p;
        await up2(p);
      },
    };
    return app;
  }
}
