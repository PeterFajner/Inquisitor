// The rules store over HTTP, against a throwaway git repo: the payload's
// meta, create / replace / conflict / invalid / delete / move (batched) /
// history / revert / new packs, who may write, the rate limit, and the
// live events.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

// A rules repo transcribed by "transcription", before the app loads it.
const dir = mkdtempSync(join(tmpdir(), "inquisitor-rules-"));
process.env.RULES_DIR = dir;
const sh = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
const put = (path: string, value: unknown) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), stringify(value, { lineWidth: 100 }));
};
const stats = { WS: "60+2D10", BS: "60+2D10", S: "60+2D10", T: "60+2D10", I: "60+2D10", Wp: "60+2D10", Sg: "60+2D10", Nv: "60+2D10", Ld: "60+2D10" };
put("core/pack.yaml", { id: "core", name: "Core" });
put("core/talents/academic.yaml", { id: "academic", kind: "talent", name: "Academic", points: 5, source: { page: 24, text: "Re-roll." }, text: "Re-roll." });
put("core/talents/awareness.yaml", { id: "awareness", kind: "talent", name: "Awareness", source: { page: 24 }, text: "See." });
put("core/archetypes/sage.yaml", {
  id: "sage",
  kind: "archetype",
  name: "Sage",
  source: { page: 5 },
  subtypes: [{ id: "sage", name: "Sage", stats }],
  sections: [{ name: "Talents", effects: [{ talent: "academic" }] }],
});
sh("init", "-q", "-b", "main");
sh("add", "-A");
execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "Transcribe"], {
  env: { ...process.env, GIT_AUTHOR_NAME: "transcription", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "transcription", GIT_COMMITTER_EMAIL: "t@example.test" },
});
const transcribed = sh("rev-parse", "HEAD");

const { Browser, base, newAccount, server } = await import("./support/server.ts");
const { rulesEvents } = await import("../src/lib/rules-store.ts");

after(() => {
  rulesEvents.closeAll();
  server.closeAllConnections();
  server.close();
});

const editor = await newAccount();
const other = await newAccount();
const anon = new Browser();

const rules = async () => (await anon.get("/api/v1/rules")).body;
const metaOf = async (kind: string, id: string, pack = "core") => (await rules()).meta[pack]?.[`${kind}/${id}`];
const academic = (text: string, extra: object = {}) => ({
  id: "academic",
  kind: "talent",
  name: "Academic",
  points: 5,
  source: { page: 24, text: "Re-roll." },
  text,
  ...extra,
});

// An event stream reader: next() resolves with the next `data:` event.
async function listen(lastEventId?: string) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/v1/rules/events`, { signal: ctl.signal, headers: lastEventId ? { "last-event-id": lastEventId } : {} });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: { id: string; data: any }[] = [];
  const waiting: ((e: { id: string; data: any }) => void)[] = [];
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const id = frame.match(/^id: (.*)$/m)?.[1] ?? "";
          const data = frame.match(/^data: (.*)$/m)?.[1];
          if (data == null) continue;
          const e = { id, data: JSON.parse(data) };
          const w = waiting.shift();
          if (w) w(e);
          else events.push(e);
        }
      }
    } catch {
      // aborted
    }
  })();
  return {
    next: () =>
      new Promise<{ id: string; data: any }>((resolve, reject) => {
        const e = events.shift();
        if (e) return resolve(e);
        const t = setTimeout(() => reject(new Error("no event")), 3000);
        waiting.push((e) => {
          clearTimeout(t);
          resolve(e);
        });
      }),
    close: () => ctl.abort(),
  };
}

test("GET /rules: packs, entries and their meta from one git log", async () => {
  const r = await anon.get("/api/v1/rules");
  assert.equal(r.status, 200);
  assert.equal(r.body.version, transcribed);
  assert.equal(r.headers.get("etag"), `"${transcribed}"`);
  assert.deepEqual(r.body.packs.map((p: any) => p.pack.id), ["core"]);
  assert.equal(r.body.packs[0].entries.length, 3);
  assert.deepEqual(r.body.meta.core["talent/academic"], { commit: transcribed, author: "transcription", at: r.body.meta.core["talent/academic"].at, edited: false });
  assert.match(r.body.meta.core["talent/academic"].at, /^\d{4}-\d\d-\d\dT/);
  const again = await anon.req("GET", "/api/v1/rules", undefined, { "if-none-match": `"${transcribed}"` });
  assert.equal(again.status, 304);
});

test("writes need an account, and same origin", async () => {
  const r = await anon.post("/api/v1/rules/entries", { pack: "core", entry: academic("x"), base: transcribed });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: "account_required", account: "required" });
  // A visitor (an account without passkeys, which saves characters) doesn't edit the rules.
  const visitor = new Browser();
  assert.equal((await visitor.post("/api/v1/account/visitor")).status, 200);
  assert.ok(visitor.cookies.get("inquisitor_session"));
  for (const [path, body] of [
    ["/api/v1/rules/entries", { pack: "core", entry: academic("x"), base: transcribed }],
    ["/api/v1/rules/entries/delete", { pack: "core", kind: "talent", id: "academic", base: transcribed }],
    ["/api/v1/rules/move", { pack: "core", kind: "talent", id: "academic", pos: { x: 1, y: 1 } }],
    ["/api/v1/rules/revert", { pack: "core", kind: "talent", id: "academic", commit: transcribed }],
    ["/api/v1/rules/packs", { pack: { id: "mine", name: "Mine" } }],
  ] as const) {
    const v = await visitor.post(path, body);
    assert.equal(v.status, 401, path);
    assert.equal(v.body.error, "account_required");
  }
  assert.equal((await anon.get("/api/v1/rules")).body.version, transcribed, "nothing was committed");
  const foreign = Object.assign(new Browser(), { cookies: editor.cookies, origin: "https://evil.test" });
  assert.equal((await foreign.post("/api/v1/rules/entries", { pack: "core", entry: academic("x"), base: transcribed })).status, 403);
});

let edit1 = "";
test("replace: one commit of one file, authored by the public id; events; edited", async () => {
  const stream = await listen();
  const r = await editor.post("/api/v1/rules/entries", { pack: "core", entry: academic("Re-roll failed Sagacity Tests."), base: transcribed });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  edit1 = r.body.version;
  assert.notEqual(edit1, transcribed);
  assert.equal(r.body.entry.text, "Re-roll failed Sagacity Tests.");
  assert.deepEqual(r.body.meta, { commit: edit1, author: editor.publicId, at: r.body.meta.at, edited: true });
  assert.equal(sh("log", "-1", "--format=%an <%ae>|%cn|%s"), `${editor.publicId} <${editor.publicId}@accounts.inquisitor>|${editor.publicId}|talent/academic`);
  assert.equal(sh("show", "--name-only", "--format=", "HEAD"), "core/talents/academic.yaml");
  assert.equal(sh("status", "--porcelain"), "");
  // The file keeps its key order: only the changed line differs.
  assert.deepEqual(
    sh("diff", "-U0", `${transcribed}`, "HEAD").split("\n").filter((l) => /^[+-][^+-]/.test(l)),
    ["-text: Re-roll.", "+text: Re-roll failed Sagacity Tests."],
  );
  const e = await stream.next();
  assert.deepEqual(e.data, { type: "entry", pack: "core", kind: "talent", id: "academic", entry: r.body.entry, meta: r.body.meta, version: edit1 });
  assert.match(e.id, /^[0-9a-f]+-\d+$/);
  stream.close();
  const p = await rules();
  assert.equal(p.version, edit1);
  assert.equal(p.packs[0].entries.find((x: any) => x.id === "academic").text, "Re-roll failed Sagacity Tests.");
  assert.equal(p.meta.core["talent/academic"].edited, true);
  assert.equal(p.meta.core["talent/awareness"].edited, false);
});

test("conflict: a stale base is refused and handed the current entry", async () => {
  const r = await other.post("/api/v1/rules/entries", { pack: "core", entry: academic("Mine."), base: transcribed });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "conflict");
  assert.equal(r.body.entry.text, "Re-roll failed Sagacity Tests.");
  assert.equal(r.body.meta.commit, edit1);
  assert.equal((await other.post("/api/v1/rules/entries", { pack: "core", entry: academic("Mine."), base: null })).status, 409);
  assert.equal(sh("rev-parse", "HEAD"), edit1);
});

test("invalid: schema issues and broken cross-references are refused", async () => {
  const bad = await editor.post("/api/v1/rules/entries", { pack: "core", entry: { ...academic("x"), name: 3, extra: true }, base: edit1 });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error, "invalid");
  assert.ok(bad.body.issues.some((i: any) => i.path === "name"), JSON.stringify(bad.body.issues));
  const ref = await editor.post("/api/v1/rules/entries", { pack: "core", entry: academic("x", { effects: [{ talent: "no-such" }] }), base: edit1 });
  assert.equal(ref.status, 422);
  assert.match(ref.body.issues[0].message, /unknown talent "no-such"/);
  assert.equal((await editor.post("/api/v1/rules/entries", { pack: "nope", entry: academic("x"), base: edit1 })).status, 404);
  assert.equal((await editor.post("/api/v1/rules/entries", { pack: "../x", entry: academic("x"), base: edit1 })).status, 400);
  assert.equal(sh("rev-parse", "HEAD"), edit1);
});

test("unchanged: saving the same entry makes no commit", async () => {
  const r = await editor.post("/api/v1/rules/entries", { pack: "core", entry: academic("Re-roll failed Sagacity Tests."), base: edit1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, edit1);
  assert.equal(sh("rev-parse", "HEAD"), edit1);
});

let created = "";
test("create and delete; a delete that breaks a reference is refused", async () => {
  const entry = { id: "dodge", kind: "talent", name: "Dodge", source: { page: 25 }, text: "Dodge." };
  const r = await editor.post("/api/v1/rules/entries", { pack: "core", entry, base: null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  created = r.body.meta.commit;
  assert.equal(r.body.meta.edited, false);
  assert.equal(readFileSync(join(dir, "core/talents/dodge.yaml"), "utf8").split("\n")[0], "id: dodge");
  assert.equal((await editor.post("/api/v1/rules/entries/delete", { pack: "core", kind: "talent", id: "dodge", base: transcribed })).status, 409);
  const d = await editor.post("/api/v1/rules/entries/delete", { pack: "core", kind: "talent", id: "dodge", base: created });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.entry, null);
  assert.equal(await metaOf("talent", "dodge"), undefined);
  assert.equal(sh("log", "-1", "--format=%s"), "talent/dodge");
  assert.equal((await editor.post("/api/v1/rules/entries/delete", { pack: "core", kind: "talent", id: "dodge", base: d.body.meta.commit })).status, 404);
  const meta = await metaOf("talent", "academic");
  const refused = await editor.post("/api/v1/rules/entries/delete", { pack: "core", kind: "talent", id: "academic", base: meta.commit });
  assert.equal(refused.status, 422);
  assert.match(refused.body.issues[0].message, /archetype\/sage .*unknown talent "academic"/);
});

test("move: position only, no base; every move its own commit (never amended); not 'edited'", async () => {
  const before = sh("rev-list", "--count", "HEAD");
  const m1 = await other.post("/api/v1/rules/move", { pack: "core", kind: "talent", id: "awareness", pos: [10.4, 20] });
  assert.equal(m1.status, 200, JSON.stringify(m1.body));
  assert.deepEqual(m1.body.entry.pos, [10, 20]);
  const m2 = await other.post("/api/v1/rules/move", { pack: "core", kind: "talent", id: "awareness", pos: [30, 40] });
  assert.equal(m2.status, 200);
  assert.notEqual(m2.body.meta.commit, m1.body.meta.commit);
  assert.equal(sh("rev-list", "--count", "HEAD"), String(Number(before) + 2));
  assert.equal(sh("rev-parse", "HEAD~1"), m1.body.meta.commit, "the first move's commit is still in the history");
  assert.equal(m2.body.meta.author, other.publicId);
  assert.equal(m2.body.meta.edited, false);
  assert.match(readFileSync(join(dir, "core/talents/awareness.yaml"), "utf8"), /^pos: \[ 30, 40 \]$/m);
  // Another card: a new commit.
  const m3 = await other.post("/api/v1/rules/move", { pack: "core", kind: "archetype", id: "sage", pos: [1, 2] });
  assert.equal(sh("rev-list", "--count", "HEAD"), String(Number(before) + 3));
  assert.equal(m3.body.meta.edited, false);
  assert.equal((await other.post("/api/v1/rules/move", { pack: "core", kind: "talent", id: "awareness", pos: ["a", 1] })).status, 400);
  assert.equal((await other.post("/api/v1/rules/move", { pack: "core", kind: "talent", id: "nope", pos: [1, 1] })).status, 404);
  assert.equal((await metaOf("talent", "awareness")).commit, m2.body.meta.commit);
});

test("history and revert", async () => {
  const h = await anon.get("/api/v1/rules/history?pack=core&kind=talent&id=academic");
  assert.equal(h.status, 200);
  assert.deepEqual(h.body.commits.map((c: any) => c.author), [editor.publicId, "transcription"]);
  assert.equal(h.body.commits[0].commit, edit1);
  assert.equal(h.body.commits[0].message, "talent/academic");
  assert.equal(h.body.commits[1].entry.text, "Re-roll.");
  const gone = await anon.get("/api/v1/rules/history?pack=core&kind=talent&id=dodge");
  assert.deepEqual(gone.body.commits.map((c: any) => c.entry?.id ?? null), [null, "dodge"]);
  assert.equal((await anon.get("/api/v1/rules/history?pack=core&kind=nope&id=x")).status, 400);

  assert.equal((await editor.post("/api/v1/rules/revert", { pack: "core", kind: "talent", id: "academic", commit: transcribed, base: transcribed })).status, 409);
  assert.equal((await editor.post("/api/v1/rules/revert", { pack: "core", kind: "talent", id: "academic", commit: "deadbeef", base: edit1 })).status, 404);
  const r = await editor.post("/api/v1/rules/revert", { pack: "core", kind: "talent", id: "academic", commit: transcribed, base: edit1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.entry.text, "Re-roll.");
  assert.equal(r.body.meta.edited, false); // back to the book's wording
  assert.equal(sh("log", "-1", "--format=%s"), "talent/academic");
  assert.equal(sh("diff", transcribed, "HEAD", "--", "core/talents/academic.yaml"), "");
  // A deleted entry comes back by reverting to a version that had it.
  const back = await editor.post("/api/v1/rules/revert", { pack: "core", kind: "talent", id: "dodge", commit: created, base: null });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(back.body.entry.name, "Dodge");
});

test("new packs", async () => {
  const stream = await listen();
  const r = await editor.post("/api/v1/rules/packs", { id: "homebrew", name: "Homebrew", extends: ["core"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.pack, { id: "homebrew", name: "Homebrew", extends: ["core"] });
  assert.equal((await stream.next()).data.type, "pack");
  stream.close();
  assert.equal((await editor.post("/api/v1/rules/packs", { id: "homebrew", name: "Again" })).status, 409);
  assert.equal((await editor.post("/api/v1/rules/packs", { id: "x", name: "X", extends: ["nope"] })).status, 422);
  assert.equal((await editor.post("/api/v1/rules/packs", { id: "Bad Id", name: "X" })).status, 422);
  assert.deepEqual((await rules()).packs.map((p: any) => p.pack.id), ["core", "homebrew"]);
  // An entry in the new pack may refer to the pack it extends.
  const e = await editor.post("/api/v1/rules/entries", {
    pack: "homebrew",
    entry: { id: "scholar", kind: "talent", name: "Scholar", source: { page: 1 }, text: "x", effects: [{ talent: "academic" }] },
    base: null,
  });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal((await metaOf("talent", "scholar", "homebrew")).author, editor.publicId);
  // A core entry the homebrew pack relies on can't go.
  const m = await metaOf("talent", "dodge");
  const hb = await editor.post("/api/v1/rules/entries", {
    pack: "homebrew",
    entry: { id: "nimble", kind: "talent", name: "Nimble", source: { page: 1 }, text: "x", effects: [{ talent: "dodge" }] },
    base: null,
  });
  assert.equal(hb.status, 200);
  const del = await editor.post("/api/v1/rules/entries/delete", { pack: "core", kind: "talent", id: "dodge", base: m.commit });
  assert.equal(del.status, 422);
});

test("events: Last-Event-ID replays what was missed; an unknown one resets", async () => {
  const s1 = await listen();
  const m = await other.post("/api/v1/rules/move", { pack: "core", kind: "talent", id: "academic", pos: [5, 5] });
  const first = await s1.next();
  s1.close();
  await other.post("/api/v1/rules/move", { pack: "core", kind: "talent", id: "dodge", pos: [6, 6] });
  const s2 = await listen(first.id);
  const missed = await s2.next();
  assert.equal(missed.data.id, "dodge");
  s2.close();
  const s3 = await listen("old-12");
  const reset = await s3.next();
  assert.equal(reset.data.type, "reset");
  assert.equal(reset.data.version, sh("rev-parse", "HEAD"));
  s3.close();
  assert.equal(first.data.meta.commit, m.body.meta.commit);
});

test("a commit made outside the server is picked up", async () => {
  writeFileSync(join(dir, "core/talents/awareness.yaml"), stringify({ id: "awareness", kind: "talent", name: "Awareness", source: { page: 24 }, text: "Look." }));
  sh("add", "-A");
  execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "hand edit"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "someone", GIT_AUTHOR_EMAIL: "s@example.test", GIT_COMMITTER_NAME: "someone", GIT_COMMITTER_EMAIL: "s@example.test" },
  });
  const p = await rules();
  assert.equal(p.version, sh("rev-parse", "HEAD"));
  assert.equal(p.packs[0].entries.find((e: any) => e.id === "awareness").text, "Look.");
  assert.deepEqual([p.meta.core["talent/awareness"].author, p.meta.core["talent/awareness"].edited], ["someone", true]);
  assert.equal(p.meta.core["talent/academic"].edited, false);
});

test("hidden entries stay in the files but aren't served: no rules canvas, picker or balance pair", async () => {
  put("core/archetypes/beasts.yaml", {
    id: "beasts",
    kind: "archetype",
    name: "Bestiary",
    hidden: true,
    source: { page: 16 },
    subtypes: [{ id: "rat", name: "Giant Rat", stats }],
    sections: [],
  });
  put("core/rules/specials.yaml", { id: "specials", kind: "rule", name: "Special Characters", hidden: true, source: { page: 20 }, text: "Rumours." });
  sh("add", "-A");
  execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "hidden"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "transcription", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "transcription", GIT_COMMITTER_EMAIL: "t@example.test" },
  });
  const p = await rules();
  assert.equal(p.version, sh("rev-parse", "HEAD"));
  const served = p.packs.flatMap((x: any) => x.entries.map((e: any) => `${e.kind}/${e.id}`));
  assert.ok(served.includes("archetype/sage"));
  assert.ok(!served.includes("archetype/beasts") && !served.includes("rule/specials"), served.join(", "));
  assert.equal(p.meta.core["archetype/beasts"], undefined);
  const balance = (a: string, s: string) => anon.get(`/api/v1/balance?version=${p.version}&archetype=${a}&subtype=${s}`);
  assert.equal((await balance("beasts", "rat")).status, 404);
  assert.notEqual((await balance("sage", "sage")).status, 404);
});

test("writes are serialised: concurrent moves all land", async () => {
  const ids = ["academic", "awareness", "dodge"];
  const rs = await Promise.all(ids.map((id, i) => editor.post("/api/v1/rules/move", { pack: "core", kind: "talent", id, pos: [100 + i, 0] })));
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
  assert.equal(sh("status", "--porcelain"), "");
  const p = await rules();
  assert.deepEqual(ids.map((id) => p.packs[0].entries.find((e: any) => e.id === id).pos), [[100, 0], [101, 0], [102, 0]]);
});

test("rate limit: 60 writes a minute per account", async () => {
  const quick = await newAccount();
  let last = 0;
  for (let i = 0; i < 61; i++) {
    const r = await quick.post("/api/v1/rules/move", { pack: "core", kind: "talent", id: "nope", pos: [0, 0] });
    last = r.status;
    if (i < 60) assert.equal(r.status, 404);
  }
  assert.equal(last, 429);
});
