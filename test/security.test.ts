// Security and data integrity: request sizes under the production heap
// cap, prototype-named ids, framing, event streams.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { base, newAccount, server } from "./support/server.ts";

after(() => {
  server.closeAllConnections();
  server.close();
});

// Import: local ids and warband members are looked up in null-prototype
// maps, so "__proto__" keeps its mapping and "constructor" isn't Object.
test("import with prototype-named local ids", async () => {
  const a = await newAccount();
  const record = { v: 1, packs: ["loyalist"], archetype: "inquisitor", subtype: null, dice: {}, choices: {}, overrides: [] };
  const r = await a.post("/api/v1/import", {
    characters: [{ local_id: "__proto__", name: "A", versions: [{ id: "v1", parent_id: null, record }] }],
    warbands: [{ local_id: "w1", name: "W", characters: ["__proto__", "constructor"] }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(typeof Object.getOwnPropertyDescriptor(r.body.characters, "__proto__")?.value, "string", "the __proto__ character has a mapping");
});

// The service runs with --max-old-space-size=48 (deploy/inquisitor.service).
// A server under that cap, with a signed-in browser's cookie.
async function cappedServer(): Promise<{ base: string; cookie: string; stderr: () => string; kill: () => void }> {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--max-old-space-size=48",
      "--max-semi-space-size=1",
      "--input-type=module",
      "-e",
      `const { base, newAccount } = await import(${JSON.stringify(new URL("./support/server.ts", import.meta.url).href)});
       const a = await newAccount();
       console.log("BASE " + base + " COOKIE " + [...a.cookies].map(([k, v]) => k + "=" + v).join("; "));`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (b: Buffer) => (stderr += b));
  const [base, cookie] = await new Promise<[string, string]>((done, fail) => {
    let out = "";
    child.stdout.on("data", (b: Buffer) => {
      out += b;
      const m = out.match(/BASE (\S+) COOKIE ([^\n]*)\n/);
      if (m) done([m[1], m[2]]);
    });
    child.on("exit", (code) => fail(new Error(`server exited ${code}: ${stderr.slice(0, 300)}`)));
  });
  return { base, cookie, stderr: () => stderr, kill: () => child.kill() };
}

// Small arrays: the most heap per byte JSON.parse can be made to spend.
function arrays(bytes: number, wrap: (items: string) => string): string {
  const item = "[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],";
  return wrap(item.repeat(Math.floor((bytes - 200) / item.length)) + "0");
}

test("large bodies don't crash the server under the production heap cap", { timeout: 120_000 }, async () => {
  const s = await cappedServer();
  const alive = async () => fetch(`${s.base}/api/v1/health`).then((r) => r.status, () => 0);
  const post = (path: string, body: string, cookie = "") =>
    fetch(`${s.base}${path}`, { method: "POST", headers: { origin: s.base, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body }).then(
      (r) => r.status,
      () => 0,
    );
  try {
    // Signed out, 8 MB at the passkey step (it takes 64 KB) and at a snapshot (1 MB).
    const big = arrays(8 * 1024 * 1024, (x) => `{"step":"x","import":[${x}]}`);
    // (413, or the connection reset: the server stops reading past the cap)
    assert.ok([0, 413].includes(await post("/api/v1/account/passkey", big)));
    assert.ok([0, 413].includes(await post("/api/v1/share", big)));
    assert.equal(await alive(), 200, s.stderr());
    // Signed in, imports just under the 2 MB cap, three at once: one parses, the others wait their turn (503).
    const imp = arrays(2 * 1024 * 1024 - 1, (x) => `{"characters":[],"warbands":[],"x":[${x}]}`);
    const statuses = await Promise.all([1, 2, 3].map(() => post("/api/v1/import", imp, s.cookie)));
    assert.ok(statuses.every((x) => x === 200 || x === 503), String(statuses));
    assert.ok(statuses.includes(200), String(statuses));
    assert.equal(await alive(), 200, `the server died: ${s.stderr().split("\n").find((l) => /FATAL|heap/.test(l)) ?? s.stderr().slice(0, 300)}`);
    // Snapshots just under 1 MB, one after another.
    for (let i = 0; i < 3; i++) await post("/api/v1/share", arrays(1024 * 1024 - 1, (x) => `{"character":{"name":"x","record":[${x}]}}`));
    assert.equal(await alive(), 200, s.stderr());
  } finally {
    s.kill();
  }
});

test("pages can't be framed by another site", async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.match(r.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});

test("rules event streams are capped (503 past the cap)", async () => {
  const { rulesEvents } = await import("../src/lib/rules-store.ts");
  assert.equal(rulesEvents.max, 500);
  const { Broadcaster } = await import("../src/lib/events.ts");
  const b = new Broadcaster({ max: 1 });
  const fake = () => {
    const written: { status?: number } = {};
    const res = { writeHead: (s: number) => ((written.status = s), res), write: () => true, end: () => {}, on: () => res } as any;
    const req = { headers: {}, on: () => req } as any;
    return { ctx: { req, res, url: new URL("http://x/") } as any, written };
  };
  const one = fake();
  b.subscribe(one.ctx);
  assert.equal(one.written.status, 200);
  const two = fake();
  b.subscribe(two.ctx);
  assert.equal(two.written.status, 503);
  b.closeAll();
});
