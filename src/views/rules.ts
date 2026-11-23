// The rules API (types and rules in src/shared/api.ts):
//   GET  /api/v1/rules                 every pack, its entries and their git meta (ETag = version)
//   GET  /api/v1/rules/heights         every card's size on the rules canvas (ETag = version + layout build;
//                                      202 while being worked out, 404 when this server can't)
//   GET  /api/v1/rules/events          Server-Sent Events: one per commit
//   GET  /api/v1/rules/history         ?pack&kind&id: the entry's commits
//   GET  /api/v1/balance               ?version&archetype&subtype: the power-score distribution
//                                      (202 while it's being worked out, 409 for other rules)
//   POST /api/v1/rules/entries         create or replace an entry
//   POST /api/v1/rules/entries/delete
//   POST /api/v1/rules/move            canvas position only
//   POST /api/v1/rules/revert          restore an entry as of a commit
//   POST /api/v1/rules/packs           a new pack
// Writes need a signed-in account, one with a passkey (not a visitor), and
// are rate limited per account.
import { currentViewer } from "../lib/accounts.ts";
import { balanceFor } from "../lib/balance-store.ts";
import { currentHeights } from "../lib/rules-heights.ts";
import { HttpError, readJson, sendJson, type Ctx, type Router } from "../lib/http.ts";
import { RateWindow } from "../lib/limits.ts";
import {
  createPack,
  deleteEntry,
  entryHistory,
  moveEntry,
  revertEntry,
  RulesError,
  rulesBody,
  rulesEvents,
  saveEntry,
} from "../lib/rules-store.ts";
import { API, type RulesHistory } from "../shared/api.ts";

/** Writes per account per minute. */
export const RULES_WRITES_PER_MINUTE = 60;
const writes = new Map<string, number[]>();

function limited(accountId: string): boolean {
  const now = Date.now();
  const recent = (writes.get(accountId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= RULES_WRITES_PER_MINUTE) {
    writes.set(accountId, recent);
    return true;
  }
  recent.push(now);
  writes.set(accountId, recent);
  if (writes.size > 10_000) for (const [k, v] of writes) if (!v.some((t) => now - t < 60_000)) writes.delete(k);
  return false;
}

/** Writes by everyone together per minute (accounts are free to make). */
export const RULES_WRITES_PER_MINUTE_ALL = 300;
const allWrites = new RateWindow(RULES_WRITES_PER_MINUTE_ALL, 60_000);

// A not rate-limited write by an account with a passkey (visitors don't
// edit the rules): run `op` with the author's public id.
function write(op: (author: string, body: unknown) => Promise<unknown>) {
  return async (ctx: Ctx) => {
    const viewer = currentViewer(ctx);
    if (!viewer.accountId || !viewer.publicId || !viewer.passkey) throw new HttpError(401, "account_required");
    if (limited(viewer.accountId) || !allWrites.hit()) {
      sendJson(ctx, { error: "rate_limited" }, 429, { "retry-after": "60" });
      return;
    }
    const body = await readJson(ctx, 1024 * 1024);
    try {
      sendJson(ctx, await op(viewer.publicId, body));
    } catch (e) {
      if (e instanceof RulesError) sendJson(ctx, e.body, e.status);
      else throw e;
    }
  };
}

export function rulesRoutes(router: Router): void {
  router.get(`${API}/rules`, (ctx) => {
    const { version, body } = rulesBody();
    const etag = `"${version}"`;
    if (ctx.req.headers["if-none-match"] === etag) {
      ctx.res.writeHead(304, { etag });
      ctx.res.end();
      return;
    }
    ctx.res.writeHead(200, { "content-type": "application/json", etag, "cache-control": "no-cache" });
    ctx.res.end(ctx.req.method === "HEAD" ? undefined : body);
  });

  router.get(`${API}/rules/heights`, async (ctx) => {
    const h = await currentHeights();
    if (h === "unavailable") return sendJson(ctx, { error: "not_found" }, 404);
    if (h === "pending") return sendJson(ctx, { pending: true }, 202, { "retry-after": "1" });
    const etag = h.etag;
    if (ctx.req.headers["if-none-match"] === etag) {
      ctx.res.writeHead(304, { etag });
      ctx.res.end();
      return;
    }
    ctx.res.writeHead(200, { "content-type": "application/json", etag, "cache-control": "no-cache" });
    ctx.res.end(ctx.req.method === "HEAD" ? undefined : h.body);
  });

  router.get(`${API}/rules/events`, (ctx) => {
    rulesEvents.subscribe(ctx);
  });

  router.get(`${API}/balance`, (ctx) => {
    const q = ctx.url.searchParams;
    const d = balanceFor(q.get("version") ?? "", q.get("archetype") ?? "", q.get("subtype") ?? "");
    if (d === "pending") sendJson(ctx, { pending: true }, 202, { "retry-after": "3" });
    else if (d === "stale") sendJson(ctx, { error: "stale" }, 409);
    else if (d === "unknown") sendJson(ctx, { error: "not_found" }, 404);
    else sendJson(ctx, d, 200, { "cache-control": "public, max-age=31536000, immutable" });
  });

  router.get(`${API}/rules/history`, async (ctx) => {
    const q = ctx.url.searchParams;
    const [pack, kind, id] = [q.get("pack") ?? "", q.get("kind") ?? "", q.get("id") ?? ""];
    try {
      const commits = await entryHistory(pack, kind, id);
      sendJson(ctx, { pack, kind, id, commits } satisfies RulesHistory);
    } catch (e) {
      if (e instanceof RulesError) sendJson(ctx, e.body, e.status);
      else throw e;
    }
  });

  router.post(`${API}/rules/entries`, write(saveEntry));
  router.post(`${API}/rules/entries/delete`, write(deleteEntry));
  router.post(`${API}/rules/move`, write(moveEntry));
  router.post(`${API}/rules/revert`, write(revertEntry));
  router.post(`${API}/rules/packs`, write(createPack));
}
