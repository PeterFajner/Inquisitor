// Characters, settings, share links and import: /api/v1 (shapes in
// src/shared/api.ts; the rules in src/lib/characters.ts). Writes are POSTs
// (same-origin checked in src/server.ts). Without a session, the lists are
// empty and the writes that make something new (create, import, copy from a
// share link) answer 401 {error: "account_required", account: "required"}:
// the browser gets a visitor (POST /api/v1/account/visitor) and tries again.
import { currentViewer } from "../lib/accounts.ts";
import * as chars from "../lib/characters.ts";
import { getSettings, updateSettings } from "../lib/settings.ts";
import { readJson, sendJson, type Ctx, type Router } from "../lib/http.ts";
import { API } from "../shared/api.ts";
import { IMPORT_LIMIT } from "./account.ts";

const v = currentViewer;

// A body that may be empty (duplicate, share): {} then.
async function optionalJson(ctx: Ctx): Promise<unknown> {
  const len = Number(ctx.req.headers["content-length"] ?? "0");
  if (!len && !ctx.req.headers["transfer-encoding"]) return {};
  return readJson(ctx);
}

export const shareUrl = (token: string): string => `/s/${token}`;

export function characterRoutes(router: Router): void {
  router
    // Characters
    .get(`${API}/characters`, (ctx) => sendJson(ctx, { characters: chars.listCharacters(v(ctx)) }))
    .post(`${API}/characters`, async (ctx) => sendJson(ctx, { character: chars.createCharacter(v(ctx), await readJson(ctx)) }, 201))
    .get(`${API}/characters/:id`, (ctx) => sendJson(ctx, { character: chars.getCharacter(v(ctx), ctx.params.id) }))
    .post(`${API}/characters/:id/versions`, async (ctx) => sendJson(ctx, chars.addVersion(v(ctx), ctx.params.id, await readJson(ctx)), 201))
    .post(`${API}/characters/:id/head`, async (ctx) => sendJson(ctx, chars.setHead(v(ctx), ctx.params.id, await readJson(ctx))))
    .post(`${API}/characters/:id/name`, async (ctx) => sendJson(ctx, chars.renameCharacter(v(ctx), ctx.params.id, await readJson(ctx))))
    .post(`${API}/characters/:id/duplicate`, async (ctx) =>
      sendJson(ctx, { character: chars.duplicateCharacter(v(ctx), ctx.params.id, await optionalJson(ctx)) }, 201),
    )
    .post(`${API}/characters/:id/delete`, (ctx) => {
      chars.deleteCharacter(v(ctx), ctx.params.id);
      sendJson(ctx, { ok: true });
    })
    .post(`${API}/characters/:id/share`, (ctx) => {
      const { token } = chars.shareCharacter(v(ctx), ctx.params.id);
      sendJson(ctx, { token, url: shareUrl(token) });
    })
    // Settings
    .get(`${API}/settings`, (ctx) => sendJson(ctx, { settings: getSettings(v(ctx)) }))
    .post(`${API}/settings`, async (ctx) => sendJson(ctx, { settings: updateSettings(v(ctx), await readJson(ctx)) }))
    // Share links
    .get(`${API}/share/:token`, (ctx) => sendJson(ctx, chars.resolveShare(v(ctx), ctx.params.token)))
    .post(`${API}/share/:token/duplicate`, async (ctx) => sendJson(ctx, chars.duplicateShared(v(ctx), ctx.params.token, await optionalJson(ctx)), 201))
    .post(`${API}/share/:token/delete`, (ctx) => {
      chars.revokeShare(v(ctx), ctx.params.token);
      sendJson(ctx, { ok: true });
    })
    // Import
    .post(`${API}/import`, async (ctx) => sendJson(ctx, chars.importBrowser(v(ctx), await readJson(ctx, IMPORT_LIMIT))));
}
