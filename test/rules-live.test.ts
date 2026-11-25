// The browser's current rules follow live rules edits (src/client/lib/rules.ts
// rulesChanged), and balance distributions are asked for the current
// version only (src/client/lib/balance.ts), with fetch stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RulesPayload } from "../src/shared/api.ts";
import { currentRules, loadRules, rulesChanged } from "../src/client/lib/rules.ts";
import { distribution } from "../src/client/lib/balance.ts";

let serverVersion = "v1";
const asked: string[] = [];
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  asked.push(url);
  if (url.endsWith("/rules")) return Response.json({ version: serverVersion, packs: [], meta: {} } satisfies RulesPayload);
  if (url.includes("/balance?")) return new Response(JSON.stringify({ error: "stale" }), { status: 409 });
  return new Response("", { status: 404 });
}) as typeof fetch;

const settle = () => new Promise((done) => setTimeout(done, 400));

test("rules: a newer version seen live loads the current rules again, once for a burst", async () => {
  const first = await loadRules();
  assert.equal(first.version, "v1");
  assert.equal(await loadRules(), first, "kept while nothing changes");
  rulesChanged("v1");
  await settle();
  assert.equal(asked.filter((u) => u.endsWith("/rules")).length, 1, "its own version: nothing to load");

  serverVersion = "v2";
  rulesChanged("v2");
  rulesChanged("v2");
  await settle();
  assert.equal(asked.filter((u) => u.endsWith("/rules")).length, 2);
  assert.equal(currentRules.get().rules?.version, "v2");
  assert.equal((await loadRules()).version, "v2", "loadRules() gives the new rules");
});

test("balance: a version that isn't current is never asked of the server; a 409 isn't asked again", async () => {
  serverVersion = "v3";
  rulesChanged("v3");
  await settle();
  const v3 = currentRules.get().rules!;
  const old = { ...v3, version: "v1" };
  assert.equal(await distribution(old, "hero", "fighter"), null);
  assert.ok(!asked.some((u) => u.includes("/balance?") && u.includes("version=v1")), "no request for an old version");
  // The server moved on without this page knowing: one 409, then no more.
  assert.equal(await distribution(v3, "hero", "fighter"), null);
  assert.equal(await distribution(v3, "hero", "psyker"), null);
  assert.equal(asked.filter((u) => u.includes("/balance?")).length, 1);
  await settle();
});
