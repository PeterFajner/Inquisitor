// The app's pages: each is the one client entry (src/client/app.tsx) in the
// page shell, with what it shows as PageData (src/shared/api.ts). The
// client takes it from there; moving to another page in place
// (src/client/lib/router.ts) it asks GET /api/v1/page?path=<path> for that
// page's PageData (status set for a page that would be an error page).
//
//   /            the builder
//   /c/<id>      one of the viewer's characters (404 if not theirs)
//   /s/<token>   a share link, read-only
//   /c/<id>/history  a character's history (its version tree)
//   /rules       the rules canvas
import { currentViewer } from "../lib/accounts.ts";
import { getCharacter, resolveShare } from "../lib/characters.ts";
import { HttpError, Router, sendJson, type Ctx } from "../lib/http.ts";
import { API, type PageData } from "../shared/api.ts";
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

/** Each page's data; `index`: search engines may list it. */
type Page = { data: (ctx: Ctx) => PageData; index?: boolean };
const PAGES: [string, Page][] = [
  ["/", { data: base, index: true }],
  ["/c/:id", { data: (ctx) => ({ ...base(ctx), character: orNotFound(() => getCharacter(currentViewer(ctx), ctx.params.id)) }) }],
  ["/c/:id/history", { data: (ctx) => ({ ...base(ctx), character: orNotFound(() => getCharacter(currentViewer(ctx), ctx.params.id)), view: "history" }) }],
  ["/rules", { data: (ctx) => ({ ...base(ctx), view: "rules" }), index: true }],
  ["/s/:token", { data: (ctx) => ({ ...base(ctx), share: orNotFound(() => resolveShare(currentViewer(ctx), ctx.params.token)) }) }],
];
const pages = new Router<Page>();
for (const [pattern, page] of PAGES) pages.get(pattern, page);

export function pageRoutes(router: Router): void {
  for (const [pattern, page] of PAGES) router.get(pattern, (ctx) => clientPage(ctx, { data: page.data(ctx), noindex: !page.index }));
  router.get(`${API}/page`, (ctx) => {
    const path = ctx.url.searchParams.get("path") ?? "";
    const m = pages.match("GET", path);
    let data: PageData;
    try {
      if (!m) throw new HttpError(404, "not_found");
      data = m.handler.data({ ...ctx, params: m.params });
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
      data = { ...base(ctx), status: 404 };
    }
    sendJson(ctx, data);
  });
}
