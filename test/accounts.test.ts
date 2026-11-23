// Accounts over HTTP, as a browser would use them: create an account with a
// passkey, sign out, sign back in, add a second passkey, the challenge
// rules, the same-origin check, and deletion taking the account's
// characters with it. A software authenticator stands in for the device.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Browser, db, ORIGIN, server } from "./support/server.ts";
import { SoftAuthenticator, UP } from "./support/soft-authenticator.ts";
import { rpId } from "../src/lib/passkeys.ts";

after(() => {
  server.closeAllConnections();
  server.close();
});

const RECORD = { v: 1, packs: ["loyalist"], name: "", archetype: "inquisitor", subtype: "psyker", dice: { "a/b": [7] }, choices: {}, overrides: [] };

async function options(b: Browser, step: string) {
  const r = await b.post("/api/v1/account/passkey", { step });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.options;
}

async function register(b: Browser, a: SoftAuthenticator, extra: object = {}) {
  const o = await options(b, "register-options");
  return b.post("/api/v1/account/passkey", { step: "register", response: a.register({ challenge: o.challenge }), ...extra });
}

async function signIn(b: Browser, a: SoftAuthenticator, extra: object = {}) {
  const o = await options(b, "sign-in-options");
  return b.post("/api/v1/account/passkey", { step: "sign-in", response: a.authenticate({ challenge: o.challenge }), ...extra });
}

const phone = new SoftAuthenticator(ORIGIN);
const laptop = new SoftAuthenticator(ORIGIN);
let publicId = "";

test("signed out: no account, and the account's endpoints say so", async () => {
  const b = new Browser();
  assert.deepEqual((await b.get("/api/v1/account")).body, { signed_in: false, public_id: null, passkeys: 0 });
  const list = await b.get("/api/v1/characters");
  assert.equal(list.status, 401);
  assert.deepEqual(list.body, { error: "account_required", account: "required" });
});

test("register options name the RP ID from PUBLIC_ORIGIN and require a discoverable, verified passkey", async () => {
  const o = await options(new Browser(), "register-options");
  assert.equal(o.domain, "inquisitor.test");
  assert.equal(o.discoverable, "required");
  assert.equal(o.userVerification, "required");
  assert.equal(o.attestation, false);
  assert.match(o.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.match(o.user.id, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(o.exclude, []);
});

test("creating an account signs in with a session cookie; the session is stored hashed", async () => {
  const b = new Browser();
  const r = await register(b, phone);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.account.signed_in, true);
  publicId = r.body.account.public_id;
  assert.match(publicId, /^[A-Za-z0-9_-]{10}$/);
  const cookie = b.cookies.get("inquisitor_session")!;
  assert.ok(cookie);
  // Never the cookie itself in the database, never the account id in public.
  const sessions = db.prepare("SELECT token_hash, account_id FROM account_sessions").all() as { token_hash: string; account_id: string }[];
  assert.equal(sessions.length, 1);
  assert.notEqual(sessions[0].token_hash, cookie);
  assert.notEqual(sessions[0].account_id, publicId);
  assert.deepEqual((await b.get("/api/v1/account")).body, { signed_in: true, public_id: publicId, passkeys: 1 });
});

test("a register challenge is single use", async () => {
  const b = new Browser();
  const o = await options(b, "register-options");
  const a = new SoftAuthenticator(ORIGIN);
  assert.equal((await b.post("/api/v1/account/passkey", { step: "register", response: a.register({ challenge: o.challenge }) })).status, 200);
  const again = new SoftAuthenticator(ORIGIN);
  const r = await b.post("/api/v1/account/passkey", { step: "register", response: again.register({ challenge: o.challenge }) });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "passkey_rejected");
});

test("a passkey for another site, or without user verification, is refused", async () => {
  const b = new Browser();
  for (const make of [
    (c: string) => new SoftAuthenticator("https://evil.example").register({ challenge: c }),
    (c: string) => new SoftAuthenticator(ORIGIN).register({ challenge: c, flags: UP | 0x40 }),
    (c: string) => new SoftAuthenticator(ORIGIN).register({ challenge: c, origin: "https://evil.example" }),
  ]) {
    const o = await options(b, "register-options");
    const r = await b.post("/api/v1/account/passkey", { step: "register", response: make(o.challenge) });
    assert.equal(r.status, 400);
  }
  assert.equal(b.cookies.size, 0);
});

test("sign out, then sign back in with the same passkey: the same public id", async () => {
  const b = new Browser();
  assert.equal((await signIn(b, phone)).status, 200);
  assert.equal((await b.get("/api/v1/account")).body.public_id, publicId);
  assert.deepEqual((await b.post("/api/v1/account/sign-out")).body, { ok: true });
  assert.equal(b.cookies.size, 0);
  assert.equal((await b.get("/api/v1/account")).body.signed_in, false);

  const r = await signIn(b, phone);
  assert.equal(r.body.account.public_id, publicId);
});

test("sign-in refuses an unknown passkey, a replayed challenge and a counter that didn't go up", async () => {
  const b = new Browser();
  const stranger = new SoftAuthenticator(ORIGIN);
  const r1 = await signIn(b, stranger);
  assert.equal(r1.status, 400);
  assert.equal(r1.body.error, "passkey_unknown");

  const o = await options(b, "sign-in-options");
  const resp = phone.authenticate({ challenge: o.challenge });
  assert.equal((await b.post("/api/v1/account/passkey", { step: "sign-in", response: resp })).status, 200);
  assert.equal((await b.post("/api/v1/account/passkey", { step: "sign-in", response: resp })).status, 400);

  const o2 = await options(b, "sign-in-options");
  const stale = phone.authenticate({ challenge: o2.challenge, counter: 1 });
  assert.equal((await b.post("/api/v1/account/passkey", { step: "sign-in", response: stale })).status, 400);
  phone.counter = 100; // back ahead of the stored counter
});

test("a second passkey joins the signed-in account and signs into it", async () => {
  const b = new Browser();
  assert.equal((await b.post("/api/v1/account/passkey", { step: "add-options" })).status, 401);
  await signIn(b, phone);
  const o = await options(b, "add-options");
  assert.equal(o.exclude.length, 1, "the existing passkey is excluded");
  const r = await b.post("/api/v1/account/passkey", { step: "add", response: laptop.register({ challenge: o.challenge }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await b.get("/api/v1/account")).body.passkeys, 2);

  const other = new Browser();
  assert.equal((await signIn(other, laptop)).body.account.public_id, publicId);
});

test("an add challenge belongs to its account", async () => {
  const a = new Browser();
  await signIn(a, phone);
  const o = await options(a, "add-options");
  // Another account tries to use it.
  const b = new Browser();
  await register(b, new SoftAuthenticator(ORIGIN));
  const r = await b.post("/api/v1/account/passkey", { step: "add", response: new SoftAuthenticator(ORIGIN).register({ challenge: o.challenge }) });
  assert.equal(r.status, 400);
});

test("posts from another origin, or with no origin, are refused", async () => {
  const b = new Browser();
  await signIn(b, phone);
  b.origin = "https://evil.example";
  const r = await b.post("/api/v1/characters", { record: RECORD });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "cross_origin");
  b.origin = null;
  assert.equal((await b.post("/api/v1/account/sign-out")).status, 403);
});

test("signing in can bring the browser's characters along", async () => {
  const b = new Browser();
  const r = await signIn(b, phone, {
    import: { characters: [{ local_id: "local-1", name: "Eisenhorn", versions: [{ id: "v1", parent_id: null, record: RECORD }] }] },
  });
  assert.equal(r.status, 200);
  const id = r.body.imported.characters["local-1"];
  assert.ok(id);
  const c = await b.get(`/api/v1/characters/${id}`);
  assert.equal(c.body.character.name, "Eisenhorn");
  assert.equal(c.body.character.versions[0].kind, "import");
  assert.equal(c.body.character.versions[0].author, publicId);

  // A bad import doesn't undo the sign-in.
  const bad = await signIn(new Browser(), phone, { import: { characters: [{ local_id: "x", versions: [{ id: "v", parent_id: null, record: {} }] }] } });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.account.signed_in, true);
  assert.equal(bad.body.import_error, "invalid:characters.0.versions.0.record.v");
});

test("deleting the account takes its passkeys, sessions and characters; its share-only snapshots stay", async () => {
  const b = new Browser();
  await signIn(b, phone);
  const made = await b.post("/api/v1/characters", { name: "Ravenor", record: RECORD });
  assert.equal(made.status, 201);
  const shared = await b.post(`/api/v1/characters/${made.body.character.id}/share`);
  const snapshot = await b.post("/api/v1/share", { character: { name: "loose", record: RECORD } });
  const accountId = (db.prepare("SELECT account_id FROM account_passkeys WHERE id = ?").get(phone.authenticate({ challenge: "x" }).id) as { account_id: string }).account_id;

  assert.deepEqual((await b.post("/api/v1/account/delete")).body, { ok: true });
  assert.equal(b.cookies.size, 0);
  for (const table of ["account_passkeys", "account_sessions", "characters", "warbands"]) {
    const column = table.startsWith("account_") ? "account_id" : "owner_id";
    assert.equal((db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`).get(accountId) as { n: number }).n, 0, table);
  }
  assert.equal((await b.get(shared.body.url.replace("/s/", "/api/v1/share/"))).status, 404);
  assert.equal((await b.get(`/api/v1/share/${snapshot.body.token}`)).status, 200);
  // The passkey is gone with it.
  assert.equal((await signIn(new Browser(), phone)).status, 400);
});

test("PASSKEY_RP_ID: a preview host may use its parent as the RP ID, nothing else", () => {
  const was = process.env.PASSKEY_RP_ID;
  try {
    process.env.PASSKEY_RP_ID = "inquisitor.pfaj.ca";
    assert.equal(rpId(new URL("https://preview.inquisitor.pfaj.ca")), "inquisitor.pfaj.ca");
    assert.equal(rpId(new URL("https://inquisitor.pfaj.ca")), "inquisitor.pfaj.ca");
    assert.throws(() => rpId(new URL("https://evilinquisitor.pfaj.ca")));
    delete process.env.PASSKEY_RP_ID;
    assert.equal(rpId(new URL("https://preview.inquisitor.pfaj.ca")), "preview.inquisitor.pfaj.ca");
  } finally {
    if (was === undefined) delete process.env.PASSKEY_RP_ID;
    else process.env.PASSKEY_RP_ID = was;
  }
});
