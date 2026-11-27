// Saved characters over HTTP: create, versions branching, the head,
// duplicate, share links, settings, import, and who may see or change what.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Browser, db, newAccount, server } from "./support/server.ts";

after(() => {
  server.closeAllConnections();
  server.close();
});

const record = (n: number, extra: object = {}) => ({
  v: 1,
  packs: ["loyalist"],
  name: "",
  archetype: "inquisitor",
  subtype: "psyker",
  dice: { "inquisitor/ws": [n] },
  choices: {},
  overrides: [],
  ...extra,
});

const gm = await newAccount();
const player = await newAccount();
const stranger = new Browser();

let charId = "";
let root = "";

test("create: a character with its first version", async () => {
  const r = await gm.post("/api/v1/characters", { name: " Gregor Eisenhorn ", record: record(1), rules_version: "abc123", kind: "roll" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = r.body.character;
  charId = c.id;
  root = c.head_id;
  assert.equal(c.name, "Gregor Eisenhorn");
  assert.equal(c.owner, gm.publicId);
  assert.equal(c.mine, true);
  assert.deepEqual(c.shares, []);
  assert.equal(c.versions.length, 1);
  assert.deepEqual(c.versions[0], {
    id: root,
    parent_id: null,
    record: record(1),
    rules_version: "abc123",
    kind: "roll",
    author: gm.publicId,
    source_id: null,
    created_at: c.versions[0].created_at,
  });
});

test("create: records are checked for shape, kinds and names too", async () => {
  const bad: [object, string][] = [
    [{ record: { ...record(1), v: 0 } }, "invalid:record.v"],
    [{ record: { ...record(1), packs: [] } }, "invalid:record.packs"],
    [{ record: { ...record(1), archetype: "" } }, "invalid:record.archetype"],
    [{ record: { ...record(1), subtype: 3 } }, "invalid:record.subtype"],
    [{ record: { ...record(1), dice: { a: "six" } } }, "invalid:record.dice"],
    [{ record: { ...record(1), dice: { a: [1.5] } } }, "invalid:record.dice"],
    [{ record: { ...record(1), choices: [] } }, "invalid:record.choices"],
    [{ record: { ...record(1), overrides: "none" } }, "invalid:record.overrides"],
    [{ record: { ...record(1), big: "x".repeat(70_000) } }, "invalid:record.size"],
    [{ record: record(1), kind: "duplicate" }, "invalid:kind"],
    [{ record: record(1), kind: "magic" }, "invalid:kind"],
    [{ record: record(1), name: "x".repeat(201) }, "invalid:name"],
    [{}, "invalid:record"],
  ];
  for (const [body, error] of bad) {
    const r = await gm.post("/api/v1/characters", body);
    assert.equal(r.status, 400, error);
    assert.equal(r.body.error, error);
  }
  // Extra fields are kept, subtype may be null, rules_version defaults to the record's.
  const ok = await gm.post("/api/v1/characters", { record: record(2, { subtype: null, rulesVersion: "r9", extra: { any: 1 } }) });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.character.versions[0].rules_version, "r9");
  assert.deepEqual(ok.body.character.versions[0].record.extra, { any: 1 });
  assert.equal(ok.body.character.versions[0].kind, "manual");
});

test("versions branch: any version may be a parent; the head follows unless told not to", async () => {
  const a = await gm.post(`/api/v1/characters/${charId}/versions`, { parent_id: root, record: record(2), kind: "choice" });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.head_id, a.body.version.id);
  assert.equal(a.body.version.parent_id, root);
  assert.equal(a.body.version.author, gm.publicId);
  // A second child of the root: a branch.
  const b = await gm.post(`/api/v1/characters/${charId}/versions`, { parent_id: root, record: record(3), kind: "reroll" });
  assert.equal(b.body.version.parent_id, root);
  // Off the first branch, without moving the head.
  const c = await gm.post(`/api/v1/characters/${charId}/versions`, { parent_id: a.body.version.id, record: record(4), kind: "override", head: false });
  assert.equal(c.body.head_id, b.body.version.id);

  const got = (await gm.get(`/api/v1/characters/${charId}`)).body.character;
  assert.equal(got.versions.length, 4);
  assert.equal(got.head_id, b.body.version.id);
  assert.deepEqual(
    got.versions.filter((v: { parent_id: string }) => v.parent_id === root).map((v: { id: string }) => v.id).sort(),
    [a.body.version.id, b.body.version.id].sort(),
  );

  // The parent must be one of this character's versions, and the kind valid.
  const other = (await gm.post("/api/v1/characters", { record: record(9) })).body.character;
  assert.equal((await gm.post(`/api/v1/characters/${charId}/versions`, { parent_id: other.head_id, record: record(5), kind: "manual" })).body.error, "invalid:parent_id");
  assert.equal((await gm.post(`/api/v1/characters/${charId}/versions`, { record: record(5), kind: "manual" })).body.error, "invalid:parent_id");
  assert.equal((await gm.post(`/api/v1/characters/${charId}/versions`, { parent_id: root, record: record(5) })).body.error, "invalid:kind");
  assert.equal((await gm.post(`/api/v1/characters/${charId}/versions`, { parent_id: root, record: record(5), kind: "luna" })).status, 201);
});

test("set head: to any of its versions", async () => {
  const r = await gm.post(`/api/v1/characters/${charId}/head`, { version_id: root });
  assert.deepEqual(r.body, { head_id: root });
  assert.equal((await gm.get(`/api/v1/characters/${charId}`)).body.character.head_id, root);
  assert.equal((await gm.post(`/api/v1/characters/${charId}/head`, { version_id: "nope" })).body.error, "invalid:version_id");
});

test("rename", async () => {
  assert.deepEqual((await gm.post(`/api/v1/characters/${charId}/name`, { name: "Eisenhorn" })).body, { name: "Eisenhorn" });
});

test("list mine: heads only, newest change first", async () => {
  const list = (await gm.get("/api/v1/characters")).body.characters;
  assert.equal(list[0].id, charId);
  assert.equal(list[0].head.id, root);
  assert.equal(list[0].version_count, 5);
  assert.equal(list[0].versions, undefined);
  assert.ok(list.every((c: { mine: boolean; owner: string }) => c.mine && c.owner === gm.publicId));
  assert.deepEqual((await player.get("/api/v1/characters")).body.characters, []);
});

test("permissions: another account or a stranger can't see or change it", async () => {
  for (const who of [player, stranger]) {
    assert.equal((await who.get(`/api/v1/characters/${charId}`)).status, 404);
    for (const [path, body] of [
      ["versions", { parent_id: root, record: record(6), kind: "manual" }],
      ["head", { version_id: root }],
      ["name", { name: "mine now" }],
      ["share", undefined],
      ["delete", undefined],
    ] as const) {
      const r = await who.post(`/api/v1/characters/${charId}/${path}`, body);
      assert.equal(r.status, 404, `${path}: ${JSON.stringify(r.body)}`);
    }
    assert.equal((await who.post(`/api/v1/characters/${charId}/duplicate`)).status, 404);
  }
  // Its page is a 404 for them too, and the owner's for the owner.
  assert.equal((await player.get(`/c/${charId}`)).status, 404);
  const page = await gm.get(`/c/${charId}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /<script type="application\/json" id="data">/);
});

test("duplicate: a chosen version into a new character whose first version links back", async () => {
  const got = (await gm.get(`/api/v1/characters/${charId}`)).body.character;
  const pick = got.versions[2];
  const r = await gm.post(`/api/v1/characters/${charId}/duplicate`, { version_id: pick.id, name: "Eisenhorn (copy)" });
  assert.equal(r.status, 201);
  const copy = r.body.character;
  assert.notEqual(copy.id, charId);
  assert.equal(copy.name, "Eisenhorn (copy)");
  assert.equal(copy.versions.length, 1);
  assert.equal(copy.versions[0].kind, "duplicate");
  assert.equal(copy.versions[0].source_id, pick.id);
  assert.equal(copy.versions[0].parent_id, null);
  assert.deepEqual(copy.versions[0].record, pick.record);
  // Without a body: the head, same name.
  const r2 = await gm.post(`/api/v1/characters/${charId}/duplicate`);
  assert.equal(r2.body.character.versions[0].source_id, root);
  assert.equal(r2.body.character.name, "Eisenhorn");
});

let token = "";

test("share: a read-only link anyone can open, showing the character as it is now", async () => {
  const r = await gm.post(`/api/v1/characters/${charId}/share`);
  token = r.body.token;
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(r.body.url, `/s/${token}`);
  // The same link the second time.
  assert.equal((await gm.post(`/api/v1/characters/${charId}/share`)).body.token, token);
  assert.deepEqual((await gm.get(`/api/v1/characters/${charId}`)).body.character.shares, [token]);

  const seen = await stranger.get(`/api/v1/share/${token}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.headers.get("access-control-allow-origin"), "*");
  assert.equal(seen.body.kind, "character");
  assert.equal(seen.body.character.mine, false);
  assert.equal(seen.body.character.shares, undefined);
  assert.equal(seen.body.character.owner, gm.publicId);
  assert.equal(seen.body.character.versions.length, 5);

  // Live: a new version shows through the link.
  const v = await gm.post(`/api/v1/characters/${charId}/versions`, { parent_id: root, record: record(7), kind: "manual" });
  assert.equal((await stranger.get(`/api/v1/share/${token}`)).body.character.head_id, v.body.version.id);

  // The page.
  const page = await stranger.get(`/s/${token}`);
  assert.equal(page.status, 200);
  const data = JSON.parse(/<script type="application\/json" id="data">(.*?)<\/script>/s.exec(page.body)![1]);
  assert.equal(data.share.character.id, charId);
  assert.deepEqual(data.account, { signed_in: false, public_id: null });

  // Read-only: the link gives no way to change it.
  assert.equal((await stranger.post(`/api/v1/characters/${charId}/name`, { name: "x" })).status, 404);
  assert.equal((await player.post(`/api/v1/share/${token}/delete`)).status, 404);
});

test("share: duplicating from a link copies into the viewer's account", async () => {
  assert.equal((await stranger.post(`/api/v1/share/${token}/duplicate`)).status, 401);
  const r = await player.post(`/api/v1/share/${token}/duplicate`, { version_id: root });
  assert.equal(r.status, 201);
  const copy = r.body.character;
  assert.equal(copy.owner, player.publicId);
  assert.equal(copy.versions[0].kind, "duplicate");
  assert.equal(copy.versions[0].source_id, root);
  assert.equal(copy.versions[0].author, player.publicId);
  // It's the player's to edit now; the original is untouched.
  assert.equal((await player.post(`/api/v1/characters/${copy.id}/versions`, { parent_id: copy.head_id, record: record(8), kind: "manual" })).status, 201);
  assert.equal((await gm.get(`/api/v1/characters/${charId}`)).body.character.versions.length, 6);
});

test("share: revoking a link", async () => {
  const other = (await gm.post("/api/v1/characters", { record: record(1) })).body.character;
  const t2 = (await gm.post(`/api/v1/characters/${other.id}/share`)).body.token;
  assert.deepEqual((await gm.post(`/api/v1/share/${t2}/delete`)).body, { ok: true });
  assert.equal((await stranger.get(`/api/v1/share/${t2}`)).status, 404);
  assert.equal((await stranger.get(`/s/${t2}`)).status, 404);
});

test("share: an ownerless snapshot (shared before visitors) is read-only through its link; no new ones are made", async () => {
  db.prepare("INSERT INTO characters (id, owner_id, name) VALUES ('snap', NULL, 'Loose')").run();
  db.prepare("INSERT INTO character_versions (id, character_id, parent_id, record, kind) VALUES ('snap-v', 'snap', NULL, ?, 'roll')").run(JSON.stringify(record(3)));
  db.prepare("UPDATE characters SET head_id = 'snap-v' WHERE id = 'snap'").run();
  db.prepare("INSERT INTO shares (token, character_id) VALUES ('snap-token', 'snap')").run();
  const seen = (await stranger.get("/api/v1/share/snap-token")).body.character;
  assert.equal(seen.owner, null);
  assert.equal(seen.mine, false);
  assert.equal(seen.versions[0].author, null);
  assert.equal((await stranger.get("/s/snap-token")).status, 200);
  assert.equal((await stranger.post(`/api/v1/characters/${seen.id}/name`, { name: "x" })).status, 404);
  assert.equal((await gm.post(`/api/v1/characters/${seen.id}/name`, { name: "x" })).status, 404);
  assert.equal((await stranger.post("/api/v1/share/snap-token/delete")).status, 404);
  // Copying it is a save: a visitor's at least.
  const copier = new Browser();
  assert.equal((await copier.post("/api/v1/share/snap-token/duplicate")).status, 401);
  await copier.post("/api/v1/account/visitor");
  const copy = await copier.post("/api/v1/share/snap-token/duplicate");
  assert.equal(copy.status, 201);
  assert.equal(copy.body.character.mine, true);
  // POST /api/v1/share (snapshots from browsers that kept their own characters) is gone.
  assert.equal((await stranger.post("/api/v1/share", { character: { name: "Loose", record: record(3) } })).status, 404);
});

test("settings: the Download format and each character's others, kept for the account", async () => {
  const a = (await gm.post("/api/v1/characters", { name: "A", record: record(1) })).body.character;
  const b = (await gm.post("/api/v1/characters", { name: "B", record: record(2) })).body.character;
  const c = (await gm.post("/api/v1/characters", { name: "C", record: record(3) })).body.character;
  const theirs = (await player.post("/api/v1/characters", { record: record(4) })).body.character;
  const start = (await gm.get("/api/v1/settings")).body.settings;

  assert.equal((await gm.post("/api/v1/settings", { format: "pdf" })).body.settings.format, "pdf");
  assert.equal((await gm.post("/api/v1/settings", { format: "odt" })).body.error, "invalid:format");
  // Only the account's own characters, never the character itself; repeats once.
  assert.equal((await gm.post("/api/v1/settings", { character_id: a.id, with: [theirs.id] })).body.error, "invalid:with");
  assert.equal((await gm.post("/api/v1/settings", { character_id: a.id, with: [a.id] })).body.error, "invalid:with");
  assert.equal((await gm.post("/api/v1/settings", { character_id: theirs.id, with: [a.id] })).body.error, "invalid:character_id");
  assert.equal((await gm.post("/api/v1/settings", { character_id: a.id, with: "x" })).body.error, "invalid:with");
  const set = (await gm.post("/api/v1/settings", { character_id: a.id, with: [b.id, c.id, b.id] })).body.settings;
  assert.deepEqual(set, { format: "pdf", with: { ...start.with, [a.id]: [b.id, c.id] } });
  // Another account's are its own.
  assert.deepEqual((await player.get("/api/v1/settings")).body.settings.with[a.id], undefined);
  // A deleted character drops out of the lists it was in, and its own list goes.
  assert.deepEqual((await gm.post(`/api/v1/characters/${c.id}/delete`)).body, { ok: true });
  assert.deepEqual((await gm.get("/api/v1/settings")).body.settings.with[a.id], [b.id]);
  await gm.post("/api/v1/settings", { character_id: b.id, with: [a.id] });
  assert.deepEqual((await gm.post(`/api/v1/characters/${b.id}/delete`)).body, { ok: true });
  const after = (await gm.get("/api/v1/settings")).body.settings;
  assert.equal(after.with[a.id], undefined);
  assert.equal(after.with[b.id], undefined);
  // An empty list clears it.
  const d = (await gm.post("/api/v1/characters", { name: "D", record: record(5) })).body.character;
  await gm.post("/api/v1/settings", { character_id: a.id, with: [d.id] });
  assert.equal((await gm.post("/api/v1/settings", { character_id: a.id, with: [] })).body.settings.with[a.id], undefined);
  // Warbands are gone from the API.
  assert.equal((await gm.get("/api/v1/warbands")).status, 404);
  await gm.post("/api/v1/settings", { format: "docx" });
});

test("import: the browser's characters, with their history, once (its warbands left behind)", async () => {
  const acct = await newAccount();
  const body = {
    characters: [
      {
        local_id: "L1",
        name: "Local one",
        versions: [
          { id: "a", parent_id: null, record: record(1), kind: "roll", created_at: "2026-11-01T10:00:00.000Z" },
          { id: "b", parent_id: "a", record: record(2), kind: "choice" },
          { id: "c", parent_id: "a", record: record(3) },
        ],
        head: "b",
      },
      { local_id: "L2", versions: [{ id: "x", parent_id: null, record: record(4) }] },
    ],
    warbands: [{ local_id: "W1", name: "Band", characters: ["L2", "L1", "unknown"] }],
  };
  const r = await acct.post("/api/v1/import", body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { characters } = r.body;
  assert.deepEqual(Object.keys(r.body), ["characters"]);
  const one = (await acct.get(`/api/v1/characters/${characters.L1}`)).body.character;
  assert.equal(one.name, "Local one");
  assert.equal(one.versions.length, 3);
  const byKind = Object.fromEntries(one.versions.map((v: { kind: string }) => [v.kind, v]));
  assert.equal(byKind.roll.created_at, "2026-11-01T10:00:00.000Z");
  assert.equal(byKind.choice.parent_id, byKind.roll.id);
  assert.equal(byKind.import.parent_id, byKind.roll.id);
  assert.equal(one.head_id, byKind.choice.id);
  assert.ok(one.versions.every((v: { author: string }) => v.author === acct.publicId));

  // Again (a retried sign-in): the same ids, no copies.
  const again = await acct.post("/api/v1/import", body);
  assert.deepEqual(again.body, r.body);
  assert.equal((await acct.get("/api/v1/characters")).body.characters.length, 2);
  // Another account importing the same local ids gets its own.
  const other = await player.post("/api/v1/import", { characters: [body.characters[1]] });
  assert.notEqual(other.body.characters.L2, characters.L2);
});

test("import: all or nothing, and the tree must hold together", async () => {
  const acct = await newAccount();
  const bad: [object, string][] = [
    [{ characters: [{ local_id: "a", versions: [] }] }, "invalid:characters.0.versions"],
    [{ characters: [{ local_id: "a", versions: [{ id: "1", parent_id: "0", record: record(1) }] }] }, "invalid:characters.0.versions.0.parent_id"],
    [{ characters: [{ local_id: "a", versions: [{ id: "1", parent_id: null, record: record(1) }, { id: "2", parent_id: "3", record: record(1) }] }] }, "invalid:characters.0.versions.1.parent_id"],
    [{ characters: [{ local_id: "a", versions: [{ id: "1", parent_id: null, record: record(1) }, { id: "1", parent_id: "1", record: record(1) }] }] }, "invalid:characters.0.versions.1.id"],
    [{ characters: [{ local_id: "a", versions: [{ id: "1", parent_id: null, record: record(1) }], head: "9" }] }, "invalid:characters.0.head"],
    [
      { characters: [{ local_id: "ok", versions: [{ id: "1", parent_id: null, record: record(1) }] }, { local_id: "b", versions: [{ id: "1", parent_id: null, record: { v: 1 } }] }] },
      "invalid:characters.1.versions.0.record.packs",
    ],
  ];
  for (const [body, error] of bad) {
    const r = await acct.post("/api/v1/import", body);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, error);
  }
  assert.deepEqual((await acct.get("/api/v1/characters")).body.characters, []);
  assert.equal((await stranger.post("/api/v1/import", { characters: [] })).status, 401);
});

test("health, static files and unknown paths", async () => {
  assert.deepEqual((await stranger.get("/api/v1/health")).body, { ok: true });
  const icon = await stranger.get("/favicon.ico");
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/x-icon");
  assert.equal((await stranger.get("/static/../package.json")).status, 404);
  const api404 = await stranger.get("/api/v1/nope");
  assert.equal(api404.status, 404);
  assert.deepEqual(api404.body, { error: "not_found" });
  const page404 = await stranger.get("/nope");
  assert.equal(page404.status, 404);
  assert.match(page404.body, /"status":404/);
  const home = await stranger.get("/");
  assert.equal(home.status, 200);
  assert.match(home.body, /<div id="app"><\/div>/);
});
