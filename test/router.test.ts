// Moving between pages in place (src/client/lib/routes.ts, router.ts): which
// page a path shows, which link clicks stay in the page, and the server's
// GET /api/v1/page, which must answer what the page itself would embed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { instanceOf, intercepts, isRoot, routeOf } from "../src/client/lib/routes.ts";
import { Browser, newAccount, server } from "./support/server.ts";

after(() => {
  server.closeAllConnections();
  server.close();
});

test("routeOf: each path's page, kept or not, and whether it needs the server's data", () => {
  const r = (p: string) => {
    const x = routeOf(p);
    return x && `${x.page}${x.kept ? " kept" : ""}${x.needsData ? " data" : ""}`;
  };
  assert.equal(r("/"), "builder kept");
  assert.equal(r("/c/abc"), "builder kept data");
  assert.equal(r("/c/abc/"), "builder kept data");
  assert.equal(r("/w/abc"), "builder kept data");
  assert.equal(r("/rules"), "rules kept");
  assert.equal(r("/rules/"), "rules kept");
  assert.equal(r("/c/abc/history"), "history data");
  assert.equal(r("/s/tok"), "share data");
  for (const p of ["/api/v1/rules", "/static/icon.svg", "/rules/x", "/c", "/c/", "/c/a/b", "/x", "/favicon.ico", ""]) assert.equal(r(p), null, p);
});

test("instanceOf: one builder and one rules page; the others one per path (and search)", () => {
  const i = (p: string, s = "") => instanceOf(routeOf(p)!, p, s);
  assert.equal(i("/"), "builder");
  assert.equal(i("/c/a"), "builder");
  assert.equal(i("/w/a"), "builder");
  assert.equal(i("/rules"), "rules");
  assert.equal(i("/c/a/history"), "history:/c/a/history");
  assert.notEqual(i("/c/a/history"), i("/c/b/history"));
  assert.notEqual(i("/s/t"), i("/s/t", "?print"));
  assert.ok(isRoot("/") && isRoot("/rules") && isRoot("/rules/"));
  assert.ok(!isRoot("/c/a") && !isRoot("/w/a") && !isRoot("/s/t"));
});

test("intercepts: plain clicks on links to the app's pages; not modified clicks, other sites, new windows, downloads, hashes", () => {
  const here = { origin: "https://x.test", pathname: "/c/abc", search: "" };
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const link = (href: string, more: Partial<{ target: string; download: boolean }> = {}) => ({ href: new URL(href, here.origin + here.pathname).href, target: "", download: false, ...more });
  assert.ok(intercepts(plain, link("/rules"), here));
  assert.ok(intercepts(plain, link("/rules#talents"), here));
  assert.ok(intercepts(plain, link("/"), here));
  assert.ok(intercepts(plain, link("/c/abc/history"), here));
  assert.ok(intercepts(plain, link("/s/tok?print"), here));
  assert.ok(intercepts(plain, link("/w/w1"), here));
  // The same page without a hash would load it again: taken (the page stays as it is).
  assert.ok(intercepts(plain, link("/c/abc"), here));
  // Modifier keys, the middle button: the browser's (a new tab, a window, a download).
  for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) assert.ok(!intercepts({ ...plain, [k]: true }, link("/rules"), here), k);
  assert.ok(!intercepts({ ...plain, button: 1 }, link("/rules"), here));
  assert.ok(!intercepts({ ...plain, button: 2 }, link("/rules"), here));
  // Handled already (the rules page's Table of Contents).
  assert.ok(!intercepts({ ...plain, defaultPrevented: true }, link("/rules"), here));
  assert.ok(!intercepts(plain, link("/rules", { target: "_blank" }), here));
  assert.ok(intercepts(plain, link("/rules", { target: "_self" }), here));
  assert.ok(!intercepts(plain, link("/rules", { download: true }), here));
  assert.ok(!intercepts(plain, link("https://elsewhere.test/rules"), here));
  assert.ok(!intercepts(plain, link("http://x.test/rules"), here)); // another origin (scheme)
  // A hash on this page: the browser's, within the page.
  assert.ok(!intercepts(plain, link("#v=1"), here));
  assert.ok(!intercepts(plain, link("/c/abc#v=1"), here));
  assert.ok(!intercepts(plain, { ...link("/rules#"), href: "https://x.test/rules#" }, { ...here, pathname: "/rules" }));
  // Not the app's pages: loaded as ever.
  assert.ok(!intercepts(plain, link("/static/client/x.docx"), here));
  assert.ok(!intercepts(plain, link("/api/v1/rules"), here));
  assert.ok(!intercepts(plain, link("/nope"), here));
});

const embedded = (html: string): unknown => JSON.parse(/<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html)![1]);

test("GET /api/v1/page: the PageData each page embeds; status 404 for what would be the error page", async () => {
  const gm = await newAccount();
  const stranger = new Browser();
  const record = { v: 1, packs: ["loyalist"], name: "", archetype: "inquisitor", subtype: "psyker", dice: {}, choices: {}, overrides: [] };
  const c = (await gm.post("/api/v1/characters", { name: "Ravenor", record, kind: "roll" })).body.character;
  const w = (await gm.post("/api/v1/warbands", { name: "Band", character_ids: [c.id] })).body.warband;
  const token = (await gm.post(`/api/v1/characters/${c.id}/share`)).body.token;
  const paths = ["/", "/rules", `/c/${c.id}`, `/c/${c.id}/history`, `/w/${w.id}`, `/s/${token}`];
  for (const path of paths) {
    const page = await gm.get(path);
    assert.equal(page.status, 200, path);
    const api = await gm.get(`/api/v1/page?path=${encodeURIComponent(path)}`);
    assert.equal(api.status, 200, path);
    assert.equal(api.headers.get("cache-control"), "no-store");
    assert.deepEqual(api.body, embedded(page.body), path);
  }
  // Not the viewer's, or no such thing, or no such page: the error page's data.
  for (const [who, path] of [[stranger, `/c/${c.id}`], [stranger, `/w/${w.id}`], [gm, "/c/nope"], [gm, "/c/nope/history"], [gm, "/s/nope"], [gm, "/nope"], [gm, ""]] as const) {
    const api = await who.get(`/api/v1/page?path=${encodeURIComponent(path)}`);
    assert.equal(api.status, 200, path);
    assert.equal(api.body.status, 404, path);
    assert.equal(api.body.character, undefined);
    if (path !== "" && path !== "/nope") assert.deepEqual(api.body, embedded((await who.get(path)).body), path);
  }
  // Anyone can open a share link.
  assert.equal((await stranger.get(`/api/v1/page?path=/s/${token}`)).body.share.token, token);
});
