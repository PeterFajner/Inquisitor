// The app's pages: each is the one client entry (src/client/app.tsx) in the
// page shell, with what it shows as PageData (src/shared/api.ts). The
// client takes it from there.
//
//   /            the builder
//   /c/<id>      one of the viewer's characters (404 if not theirs)
//   /w/<id>      one of the viewer's warbands
//   /s/<token>   a share link, read-only
import { currentViewer } from "../lib/accounts.ts";
import { getCharacter, getWarband, resolveShare } from "../lib/characters.ts";
import { HttpError, type Ctx, type Router } from "../lib/http.ts";
import type { PageData } from "../shared/api.ts";
import { accountInfo } from "./account.ts";
import { clientPage } from "./shell.ts";

const base = (ctx: Ctx): PageData => ({ account: accountInfo(ctx) });

// The shell with {status} for an error, so even a 404 shows no words but the
// app's own (nothing, for now).
export function errorPage(ctx: Ctx, status: number): void {
  let data: PageData;
  try {
    data = { ...base(ctx), status };
  } catch {
    data = { account: { signed_in: false, public_id: null }, status };
  }
  clientPage(ctx, { data, status, noindex: true });
}

// A lookup that 404s becomes the error page; anything else propagates.
function orNotFound<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 401)) throw new HttpError(404, "not_found");
    throw e;
  }
}

export function pageRoutes(router: Router): void {
  router
    .get("/", (ctx) => clientPage(ctx, { data: base(ctx) }))
    .get("/c/:id", (ctx) => {
      const character = orNotFound(() => getCharacter(currentViewer(ctx), ctx.params.id));
      clientPage(ctx, { data: { ...base(ctx), character }, noindex: true });
    })
    .get("/w/:id", (ctx) => {
      const warband = orNotFound(() => getWarband(currentViewer(ctx), ctx.params.id));
      clientPage(ctx, { data: { ...base(ctx), warband }, noindex: true });
    })
    .get("/s/:token", (ctx) => {
      const share = orNotFound(() => resolveShare(currentViewer(ctx), ctx.params.token));
      clientPage(ctx, { data: { ...base(ctx), share }, noindex: true });
    });
}
