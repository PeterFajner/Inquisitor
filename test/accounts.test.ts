// Accounts over HTTP, as a browser would use them: create an account with a
// passkey, sign out, sign back in, add a second passkey, the challenge
// rules, the same-origin check, deletion taking the account's characters
// with it, and visitors (accounts without passkeys: made on a browser's
// first save, kept by "Create account", merged by "Sign in"). A software
// authenticator stands in for the device.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Browser, db, ORIGIN, server } from "./support/server.ts";
import { SoftAuthenticator, UP } from "./support/soft-authenticator.ts";
import { rpId } from "../src/lib/passkeys.ts";
import { createHash } from "node:crypto";

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

const accounts = () => (db.prepare("SELECT count(*) AS n FROM accounts").get() as { n: number }).n;
const ownerOf = (characterId: string) => (db.prepare("SELECT owner_id FROM characters WHERE id = ?").get(characterId) as { owner_id: string } | undefined)?.owner_id;

test("no session: reads are empty and make no account; a save needs one", async () => {
  const b = new Browser();
  const before = accounts();
  assert.deepEqual((await b.get("/api/v1/account")).body, { signed_in: false, public_id: null, passkeys: 0 });
  assert.deepEqual((await b.get("/api/v1/characters")).body, { characters: [] });
  assert.deepEqual((await b.get("/api/v1/settings")).body, { settings: { format: "docx", with: {} } });
  assert.equal((await b.get("/")).status, 200);
  assert.equal((await b.get("/rules")).status, 200);
  assert.equal(accounts(), before, "looking around makes no account");
  assert.equal(b.cookies.size, 0);
  for (const [path, body] of [
    ["/api/v1/characters", { record: RECORD }],
    ["/api/v1/settings", { format: "pdf" }],
    ["/api/v1/import", { characters: [] }],
  ] as const) {
    const r = await b.post(path, body);
    assert.equal(r.status, 401, path);
    assert.deepEqual(r.body, { error: "account_required", account: "required" });
  }
  assert.equal(accounts(), before);
});

test("a visitor: made on request with a session cookie, an account without passkeys that saves like any other", async () => {
  const b = new Browser();
  const before = accounts();
  const r = await b.post("/api/v1/account/visitor");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Signed out as far as the page goes: "Sign in" / "Create account" still show.
  assert.deepEqual(r.body, { ok: true, account: { signed_in: false, public_id: null } });
  assert.ok(b.cookies.get("inquisitor_session"));
  assert.equal(accounts(), before + 1);
  // Asking again (or two saves at once) keeps the same visitor.
  await b.post("/api/v1/account/visitor");
  assert.equal(accounts(), before + 1);
  assert.deepEqual((await b.get("/api/v1/account")).body, { signed_in: false, public_id: null, passkeys: 0 });

  const made = await b.post("/api/v1/characters", { name: "Visiting", record: RECORD });
  assert.equal(made.status, 201);
  const id = made.body.character.id;
  assert.equal((await b.post(`/api/v1/characters/${id}/versions`, { parent_id: made.body.character.head_id, record: RECORD, kind: "reroll" })).status, 201);
  assert.equal((await b.get("/api/v1/characters")).body.characters.length, 1);
  assert.equal((await b.get(`/c/${id}`)).status, 200);
  // Someone else's session sees nothing of it.
  assert.equal((await new Browser().get(`/api/v1/characters/${id}`)).status, 404);
  // Seen today: last_seen_at is set (for a later cleanup of visitors nobody comes back to).
  const seen = db.prepare("SELECT last_seen_at FROM accounts WHERE id = ?").get(ownerOf(id)!) as { last_seen_at: string };
  assert.match(seen.last_seen_at, /^\d{4}-\d\d-\d\dT/);
  // A visitor can't add a passkey to itself by "add" (its first is "register").
  assert.equal((await b.post("/api/v1/account/passkey", { step: "add-options" })).status, 401);
});

test("new visitors are rate limited (globally here; nginx limits per IP)", async () => {
  const { newVisitorWindow } = await import("../src/views/account.ts");
  try {
    while (newVisitorWindow.hit());
    const b = new Browser();
    const r = await b.post("/api/v1/account/visitor");
    assert.equal(r.status, 429);
    assert.equal(b.cookies.size, 0);
  } finally {
    newVisitorWindow.clear();
  }
});

test("last_seen_at moves on when a session is used a day later", async () => {
  const b = new Browser();
  await b.post("/api/v1/account/visitor");
  const made = await b.post("/api/v1/characters", { record: RECORD });
  const owner = ownerOf(made.body.character.id)!;
  db.prepare("UPDATE accounts SET last_seen_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(owner);
  await b.get("/api/v1/characters");
  const seen = (db.prepare("SELECT last_seen_at FROM accounts WHERE id = ?").get(owner) as { last_seen_at: string }).last_seen_at;
  assert.ok(seen > "2026-01-02", seen);
});

test("create account as a visitor: the passkey goes on the visitor's account, and everything stays", async () => {
  const b = new Browser();
  await b.post("/api/v1/account/visitor");
  const c = (await b.post("/api/v1/characters", { name: "Kept", record: RECORD })).body.character;
  assert.equal((await b.post("/api/v1/settings", { format: "pdf" })).status, 200);
  const visitorId = ownerOf(c.id)!;
  const oldCookie = b.cookies.get("inquisitor_session");
  const before = accounts();

  const o = await options(b, "register-options");
  assert.equal(o.user.id, visitorId, "the WebAuthn user id is the visitor's account id");
  const a = new SoftAuthenticator(ORIGIN);
  const r = await b.post("/api/v1/account/passkey", { step: "register", response: a.register({ challenge: o.challenge }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.account.signed_in, true);
  assert.equal(accounts(), before, "no new account");
  assert.notEqual(b.cookies.get("inquisitor_session"), oldCookie, "a fresh session");
  assert.equal(ownerOf(c.id), visitorId);
  assert.deepEqual((await b.get("/api/v1/characters")).body.characters.map((x: { id: string }) => x.id), [c.id]);
  assert.equal((await b.get("/api/v1/settings")).body.settings.format, "pdf");
  // Its versions' author is the account's public id (unchanged by the passkey).
  assert.equal((await b.get(`/api/v1/characters/${c.id}`)).body.character.versions[0].author, r.body.account.public_id);
  // And the passkey signs into it from elsewhere.
  const other = new Browser();
  assert.equal((await signIn(other, a)).body.account.public_id, r.body.account.public_id);
  assert.equal((await other.get("/api/v1/characters")).body.characters.length, 1);
});

test("a visitor's register challenge works only from that visitor's session", async () => {
  const v = new Browser();
  await v.post("/api/v1/account/visitor");
  await v.post("/api/v1/characters", { record: RECORD });
  const o = await options(v, "register-options");
  const thief = new Browser();
  const r = await thief.post("/api/v1/account/passkey", { step: "register", response: new SoftAuthenticator(ORIGIN).register({ challenge: o.challenge }) });
  assert.equal(r.status, 400);
  assert.equal(thief.cookies.size, 0);
  assert.equal((await v.get("/api/v1/account")).body.passkeys, 0);
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
  // (the newest session; the visitors above have theirs)
  const sessions = db.prepare("SELECT token_hash, account_id FROM account_sessions ORDER BY rowid DESC LIMIT 1").all() as { token_hash: string; account_id: string }[];
  assert.equal(sessions[0].token_hash, createHash("sha256").update(cookie).digest("hex"));
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

test("signing in as a visitor moves the visitor's characters and settings into the account; the visitor goes", async () => {
  const mine = new Browser();
  await signIn(mine, phone);
  const had = (await mine.post("/api/v1/characters", { name: "Already mine", record: RECORD })).body.character;
  const had2 = (await mine.post("/api/v1/characters", { name: "Also mine", record: RECORD })).body.character;
  // The account's own settings win over the visitor's; the visitor's picks for its own characters come along.
  await mine.post("/api/v1/settings", { format: "docx", character_id: had.id, with: [had2.id] });

  const b = new Browser();
  await b.post("/api/v1/account/visitor");
  const c = (await b.post("/api/v1/characters", { name: "Made visiting", record: RECORD })).body.character;
  const c2 = (await b.post("/api/v1/characters", { name: "Also visiting", record: RECORD })).body.character;
  assert.deepEqual((await b.post("/api/v1/settings", { format: "pdf", character_id: c.id, with: [c2.id] })).body.settings, { format: "pdf", with: { [c.id]: [c2.id] } });
  const shared = await b.post(`/api/v1/characters/${c.id}/share`);
  const visitorId = ownerOf(c.id)!;
  const before = accounts();

  const r = await signIn(b, phone);
  assert.equal(r.status, 200);
  assert.equal(r.body.account.public_id, publicId);
  assert.equal(accounts(), before - 1, "the visitor account is dropped");
  assert.equal(db.prepare("SELECT count(*) AS n FROM accounts WHERE id = ?").get(visitorId)!.n, 0);
  // Same ids, now the account's, with the account as their versions' author.
  const list = (await b.get("/api/v1/characters")).body.characters.map((x: { id: string }) => x.id);
  assert.ok(list.includes(c.id) && list.includes(had.id), JSON.stringify(list));
  const moved = (await b.get(`/api/v1/characters/${c.id}`)).body.character;
  assert.equal(moved.owner, publicId);
  assert.ok(moved.versions.every((v: { author: string }) => v.author === publicId));
  assert.deepEqual((await b.get("/api/v1/settings")).body.settings, { format: "docx", with: { [had.id]: [had2.id], [c.id]: [c2.id] } });
  // Its share link still works, and the other device sees it too.
  assert.equal((await new Browser().get(`/api/v1/share/${shared.body.token}`)).status, 200);
  assert.ok((await mine.get("/api/v1/characters")).body.characters.some((x: { id: string }) => x.id === c.id));
});

test("sign out, then a save makes a new visitor (the account's characters aren't its)", async () => {
  const b = new Browser();
  await signIn(b, phone);
  await b.post("/api/v1/account/sign-out");
  assert.deepEqual((await b.get("/api/v1/characters")).body, { characters: [] });
  assert.equal((await b.post("/api/v1/characters", { record: RECORD })).status, 401);
  const before = accounts();
  await b.post("/api/v1/account/visitor");
  assert.equal(accounts(), before + 1);
  const c = (await b.post("/api/v1/characters", { name: "Fresh", record: RECORD })).body.character;
  assert.deepEqual((await b.get("/api/v1/characters")).body.characters.map((x: { id: string }) => x.id), [c.id]);
  assert.equal((await b.get("/api/v1/account")).body.signed_in, false);
});

test("a visitor imports a browser's kept characters (the one-time move from localStorage)", async () => {
  const b = new Browser();
  const body = {
    characters: [{ local_id: "local-1", name: "Eisenhorn", versions: [{ id: "v1", parent_id: null, record: RECORD }, { id: "v2", parent_id: "v1", record: RECORD, kind: "reroll" }] }],
    // A browser's kept warbands (from before warbands went) are left behind.
    warbands: [{ local_id: "wb-1", name: "Retinue", characters: ["local-1"] }],
  };
  assert.equal((await b.post("/api/v1/import", body)).status, 401);
  await b.post("/api/v1/account/visitor");
  const r = await b.post("/api/v1/import", body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.characters["local-1"];
  const c = (await b.get(`/api/v1/characters/${id}`)).body.character;
  assert.equal(c.name, "Eisenhorn");
  assert.equal(c.versions.length, 2);
  assert.deepEqual(Object.keys(r.body), ["characters"]);
  // Sent again (a lost reply): the same ids.
  assert.deepEqual((await b.post("/api/v1/import", body)).body, r.body);
  // Then signing in takes them along, even when the account imported the same local ids before.
  const acct = new Browser();
  await signIn(acct, phone);
  const earlier = await acct.post("/api/v1/import", body);
  assert.equal(earlier.status, 200);
  await signIn(b, phone);
  const names = (await b.get("/api/v1/characters")).body.characters.filter((x: { name: string }) => x.name === "Eisenhorn");
  assert.equal(names.length, 2, "both kept");
});

test("deleting the account takes its passkeys, sessions, characters and settings; its share-only snapshots stay", async () => {
  const b = new Browser();
  await signIn(b, phone);
  const made = await b.post("/api/v1/characters", { name: "Ravenor", record: RECORD });
  assert.equal(made.status, 201);
  await b.post("/api/v1/settings", { format: "pdf" });
  const shared = await b.post(`/api/v1/characters/${made.body.character.id}/share`);
  // An ownerless snapshot (shared before visitors existed).
  db.prepare("INSERT INTO characters (id, owner_id, name) VALUES ('loose', NULL, 'loose')").run();
  db.prepare("INSERT INTO character_versions (id, character_id, parent_id, record, kind) VALUES ('loose-v', 'loose', NULL, ?, 'manual')").run(JSON.stringify(RECORD));
  db.prepare("UPDATE characters SET head_id = 'loose-v' WHERE id = 'loose'").run();
  db.prepare("INSERT INTO shares (token, character_id) VALUES ('loose-token', 'loose')").run();
  const snapshot = { body: { token: "loose-token" } };
  const accountId = (db.prepare("SELECT account_id FROM account_passkeys WHERE id = ?").get(phone.authenticate({ challenge: "x" }).id) as { account_id: string }).account_id;

  assert.deepEqual((await b.post("/api/v1/account/delete")).body, { ok: true });
  assert.equal(b.cookies.size, 0);
  for (const table of ["account_passkeys", "account_sessions", "characters", "account_settings"]) {
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
