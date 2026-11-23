// The rules: GET /api/v1/rules is every pack with its entries and the rules
// version (the rules repo's HEAD), cacheable per version.
import { sendJson, type Router } from "../lib/http.ts";
import { rulesPayload } from "../lib/rules-store.ts";
import { API } from "../shared/api.ts";

export function rulesRoutes(router: Router): void {
  router.get(`${API}/rules`, (ctx) => {
    const payload = rulesPayload();
    const etag = `"${payload.version}"`;
    if (ctx.req.headers["if-none-match"] === etag) {
      ctx.res.writeHead(304, { etag });
      ctx.res.end();
      return;
    }
    sendJson(ctx, payload, 200, { etag, "cache-control": "no-cache" });
  });
}
