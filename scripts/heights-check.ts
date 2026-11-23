// Checks the worked-out card heights (src/client/rules/card-height.tsx,
// src/shared/layout) against Chrome: every card of data/rules rendered for
// real in headless Chrome, at a desktop and a phone viewport, next to the
// height worked out for it, and every text node's line boxes next to the
// geometry worked out for it (src/shared/layout/paint.ts: the drawings of
// cards too small to read). Run it after changing the cards' markup or CSS:
//
//   npm run heights:check [-- --url http://127.0.0.1:3000] [--out report.json] [--show 15]
//
// Without --url it builds the client into a temporary directory and starts
// its own server (temporary database, RULES_DIR or data/rules). Needs Chrome
// (CHROME=/path/to/chrome, else the usual places); talks to it over the
// DevTools protocol, no dependencies. Exits 1 when a card is taller than
// worked out by more than half a pixel (it would overflow its slot until
// mounted and measured), or when a card's text is more than a pixel from
// where its geometry puts it (its drawing wouldn't line up with it).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const ROOT = resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({ options: { url: { type: "string" }, out: { type: "string" }, show: { type: "string", default: "12" } } });
// Our own server's client build goes to a temporary directory (client.ts reads CLIENT_OUT when loaded).
const TMP = mkdtempSync(join(tmpdir(), "heights-check-"));
if (!args.url) {
  process.env.CLIENT_OUT = join(TMP, "client");
  process.env.LAYOUT_OUT = join(TMP, "layout");
}
const { clientOptions, cssTextPlugin, layoutBuild } = await import("./client.ts");

type Row = { key: string; w: number; real: number; calc: number; geo: { x: number; r: number; y: number; unpaired: number; approx: boolean } };
/** How far (px) a card's text may be from its geometry. */
const GEO_TOLERANCE = 1;

const CHROMES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean) as string[];

// --- a minimal DevTools protocol client --------------------------------------

type Page = { send<T = unknown>(method: string, params?: object): Promise<T>; eval<T = unknown>(expr: string): Promise<T> };

async function chrome(): Promise<{ page(view: { width: number; height: number; mobile: boolean; dpr: number }): Promise<Page>; close(): void }> {
  const bin = CHROMES.find((c) => existsSync(c));
  if (!bin) throw new Error("Chrome not found: set CHROME=/path/to/chrome");
  const dir = mkdtempSync(join(tmpdir(), "heights-chrome-"));
  const proc = spawn(bin, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise<string>((ok, fail) => {
    let err = "";
    proc.stderr!.on("data", (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) ok(m[1]);
    });
    proc.on("exit", () => fail(new Error(`Chrome exited: ${err}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
  let id = 0;
  const waiting = new Map<number, { ok(v: unknown): void; fail(e: Error): void }>();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data)) as { id?: number; error?: unknown; result?: unknown };
    const w = m.id !== undefined ? waiting.get(m.id) : undefined;
    if (!w) return;
    waiting.delete(m.id!);
    if (m.error) w.fail(new Error(JSON.stringify(m.error)));
    else w.ok(m.result);
  });
  const call = <T,>(method: string, params: object = {}, sessionId?: string) =>
    new Promise<T>((ok, fail) => {
      const i = ++id;
      waiting.set(i, { ok: ok as (v: unknown) => void, fail });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return {
    async page(view) {
      const { targetId } = await call<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await call<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      const send = <T,>(m: string, p: object = {}) => call<T>(m, p, sessionId);
      await send("Runtime.enable");
      await send("Emulation.setDeviceMetricsOverride", { width: view.width, height: view.height, deviceScaleFactor: view.dpr, mobile: view.mobile });
      if (view.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      return {
        send,
        async eval<T>(expression: string) {
          const r = await send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          return r.result.value;
        },
      };
    },
    close() {
      ws.close();
      proc.kill();
      setTimeout(() => rmSync(dir, { recursive: true, force: true }), 500);
    },
  };
}

// --- a server to check against -----------------------------------------------

const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });

async function ownServer(): Promise<{ url: string; stop(): void }> {
  const env = {
    ...process.env,
    DATABASE_PATH: join(TMP, "check.db"),
    RULES_DIR: process.env.RULES_DIR ?? join(ROOT, "data/rules"),
    BALANCE_WARM: "0",
    PORT: String(await freePort()),
  };
  await build({ ...clientOptions("development"), logLevel: "warning" });
  const node = [process.execPath, "--disable-warning=ExperimentalWarning"];
  const m = spawnSync(node[0], [...node.slice(1), "scripts/migrate.ts"], { cwd: ROOT, env, stdio: "ignore" });
  if (m.status !== 0) throw new Error("migrations failed");
  const srv: ChildProcess = spawn(node[0], [...node.slice(1), "src/server.ts"], { cwd: ROOT, env, stdio: "ignore" });
  const url = `http://127.0.0.1:${env.PORT}`;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`${url}/api/v1/rules`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    stop() {
      srv.kill();
    },
  };
}

// --- the check -----------------------------------------------------------------

const probe = await build({
  absWorkingDir: ROOT,
  entryPoints: ["src/client/rules/sizes-probe.tsx"],
  bundle: true,
  write: false,
  format: "iife",
  target: ["es2022"],
  jsx: "automatic",
  jsxImportSource: "preact",
  define: { "process.env.NODE_ENV": '"development"', LAYOUT_BUILD: JSON.stringify(await layoutBuild()) },
  external: ["/static/*"],
  plugins: [cssTextPlugin],
  logLevel: "warning",
});
const probeJs = probe.outputFiles[0].text;

const server = args.url ? { url: args.url.replace(/\/$/, ""), stop() {} } : await ownServer();
const browser = await chrome();
const VIEWS = [
  { name: "desktop", width: 1280, height: 800, mobile: false, dpr: 1 },
  { name: "phone", width: 390, height: 844, mobile: true, dpr: 3 },
];
const report: Record<string, { rows: Row[]; calcMs: number }> = {};
let failed = false;
const show = Number(args.show);
try {
  for (const v of VIEWS) {
    const page = await browser.page(v);
    await page.send("Page.enable");
    await page.send("Page.navigate", { url: `${server.url}/rules` });
    for (let i = 0; i < 300 && (await page.eval<string>("document.readyState").catch(() => "")) !== "complete"; i++) await new Promise((r) => setTimeout(r, 100));
    await page.eval(probeJs);
    const r = await page.eval<{ rows: Row[]; calcMs: number }>("heightsProbe()");
    report[v.name] = r;
    const d = r.rows.map((x) => ({ ...x, d: x.real - x.calc }));
    const under = d.filter((x) => x.d > 0.5).sort((a, b) => b.d - a.d);
    const over = d.filter((x) => x.d < -0.5).sort((a, b) => a.d - b.d);
    const exact = d.filter((x) => Math.abs(x.d) <= 0.5).length;
    const maxUnder = Math.max(0, ...d.map((x) => x.d));
    const maxOver = Math.max(0, ...d.map((x) => -x.d));
    console.log(
      `${v.name} (${v.width}×${v.height}): ${d.length} cards, ${exact} within 0.5 px, ${under.length} taller than worked out (max ${maxUnder.toFixed(2)} px), ${over.length} shorter (max ${maxOver.toFixed(2)} px); worked out in ${r.calcMs.toFixed(0)} ms (${(r.calcMs / d.length).toFixed(2)} ms a card)`,
    );
    for (const x of [...under.slice(0, show), ...over.slice(0, show)])
      console.log(`  ${x.d > 0 ? "taller" : "shorter"} ${Math.abs(x.d).toFixed(2).padStart(7)}  real ${x.real.toFixed(2).padStart(8)}  calc ${x.calc.toFixed(2).padStart(8)}  w ${x.w}  ${x.key}`);
    if (under.length) failed = true;
    // Text against geometry.
    const off = r.rows.map((x) => ({ ...x, worst: Math.max(x.geo.x, x.geo.r, x.geo.y) })).sort((a, b) => b.worst - a.worst || b.geo.unpaired - a.geo.unpaired);
    // A card with a character the fonts lack (drawn by a system font) is only as close as that guess.
    const bad = off.filter((x) => !x.geo.approx && (x.worst > GEO_TOLERANCE || x.geo.unpaired));
    const approx = off.filter((x) => x.geo.approx && (x.worst > GEO_TOLERANCE || x.geo.unpaired));
    const q = (k: "x" | "r" | "y") => Math.max(0, ...r.rows.filter((x) => !x.geo.approx).map((x) => x.geo[k])).toFixed(2);
    console.log(
      `  text vs geometry: ${r.rows.length - bad.length - approx.length} cards within ${GEO_TOLERANCE} px (max left ${q("x")}, right ${q("r")}, baseline ${q("y")} px), ${bad.length} not` +
        (approx.length ? `, ${approx.length} with a character the fonts lack (${approx.map((x) => x.key).join(", ")})` : ""),
    );
    for (const x of bad.slice(0, show))
      console.log(`    left ${x.geo.x.toFixed(2)}  right ${x.geo.r.toFixed(2)}  baseline ${x.geo.y.toFixed(2)}  unpaired ${x.geo.unpaired}  ${x.key}`);
    if (bad.length) failed = true;
  }
} finally {
  browser.close();
  server.stop();
  rmSync(TMP, { recursive: true, force: true });
}
if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1));
process.exit(failed ? 1 : 0);
