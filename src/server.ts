// Inquisitor's server: the pages (src/views/pages.ts), the JSON API
// (/api/v1: accounts, characters, warbands, share links) and the static
// files, in one Node process on one port.
//
//   npm run dev     reloads on change, reads .env.local, rebuilds the client
//   npm start       production (systemd on asterix, see DEPLOY.md)
//
// Every page is rendered in the browser by src/client (Preact, bundled by
// esbuild into dist/client); the server sends a shell with the page's data
// (src/views/shell.ts). nginx proxies inquisitor.pfaj.ca here.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBalance } from "./lib/balance-store.ts";
import { db, get } from "./lib/db.ts";
import { HttpError, parseCookies, Router, sameOrigin, sendJson, type Ctx } from "./lib/http.ts";
import { accountRoutes } from "./views/account.ts";
import { characterRoutes } from "./views/characters.ts";
import { errorPage, pageRoutes } from "./views/pages.ts";
import { rulesRoutes } from "./views/rules.ts";
import { API } from "./shared/api.ts";

// The project directory: static files live here whether the server runs
// from src/ (dev) or from the emitted dist/ (production).
const ROOT = resolve(process.env.APP_ROOT || process.cwd());
const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || "127.0.0.1";

const router = new Router();
router.get(`${API}/health`, (ctx) => {
  // A query, so a broken database shows here.
  const ok = get<{ ok: number }>("SELECT 1 AS ok")?.ok === 1;
  sendJson(ctx, { ok }, ok ? 200 : 503);
});
accountRoutes(router);
characterRoutes(router);
rulesRoutes(router);
pageRoutes(router);

// Static files. More specific prefixes first: the first match wins.
const CLIENT_PREFIX = "/static/client/";
const STATIC_DIRS: Record<string, string> = {
  // The browser code and CSS (scripts/client.ts), content-hashed names.
  [CLIENT_PREFIX]: join(resolve(ROOT, process.env.CLIENT_OUT || "dist/client"), "/"),
  // The icons.
  "/static/": join(ROOT, "src/static/"),
};
const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
// Asked for at the site's root by name, whatever the page links to.
const ROOT_FILES: Record<string, string> = { "/favicon.ico": "/static/favicon.ico", "/apple-touch-icon.png": "/static/apple-touch-icon.png" };

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): boolean {
  const prefix = Object.keys(STATIC_DIRS).find((p) => path.startsWith(p));
  if (!prefix) return false;
  const dir = STATIC_DIRS[prefix];
  let file: string;
  try {
    file = normalize(join(dir, decodeURIComponent(path.slice(prefix.length))));
  } catch {
    return false;
  }
  const type = TYPES[extname(file)];
  if (!file.startsWith(dir) || !type) return false; // no escaping the directory, no odd types
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    size = st.size;
  } catch {
    return false;
  }
  res.writeHead(200, {
    "content-type": type,
    // The client bundle is named by content hash: it never changes.
    "cache-control": prefix === CLIENT_PREFIX ? "public, max-age=31536000, immutable" : "public, max-age=86400",
    "x-content-type-options": "nosniff",
    "content-length": size,
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
  return true;
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const ctx: Ctx = {
    req,
    res,
    url,
    params: {},
    cookies: parseCookies(req.headers.cookie),
    setCookies: [],
    secure: req.headers["x-forwarded-proto"] === "https",
  };
  const isApi = url.pathname.startsWith(`${API}/`);
  // No page may be framed by another site (clickjacking).
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("content-security-policy", "frame-ancestors 'none'");
  try {
    if ((req.method === "GET" || req.method === "HEAD") && serveStatic(req, res, ROOT_FILES[url.pathname] ?? url.pathname)) return;
    // The API's reads are open to any site, without credentials (its errors
    // too, so callers can read them). Its writes aren't: a preflight offers
    // GET only, and every write must be same-origin (below).
    if (isApi) {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET", "access-control-max-age": "86400" });
        res.end();
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") res.setHeader("access-control-allow-origin", "*");
    }
    const route = router.match(req.method ?? "GET", url.pathname);
    if (!route) throw new HttpError(404, "not_found");
    // Every state change must come from our own pages.
    if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) throw new HttpError(403, "cross_origin");
    ctx.params = route.params;
    await route.handler(ctx);
  } catch (e) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (e instanceof HttpError && e.location) {
      res.writeHead(e.status, { location: e.location, ...(ctx.setCookies.length ? { "set-cookie": ctx.setCookies } : {}) });
      res.end();
      return;
    }
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (isApi) {
      const error = e instanceof HttpError && e.message ? e.message : status === 500 ? "server_error" : `http_${status}`;
      const retry: Record<string, string> = status === 429 ? { "retry-after": "60" } : status === 503 ? { "retry-after": "5" } : {};
      sendJson(ctx, { error, ...(status === 401 ? { account: "required" } : {}) }, status, retry);
    } else {
      errorPage(ctx, status);
    }
  }
}

export function startServer(port = PORT, host = HOST): Promise<Server> {
  const server = createServer((req, res) => void handle(req, res));
  return new Promise((done) => server.listen(port, host, () => done(server)));
}

// Run directly (npm run dev / npm start), not imported by a test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer();
  console.log(`inquisitor on http://${HOST}:${PORT}`);
  startBalance();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      server.close();
      db.close();
      process.exit(0);
    });
  }
}
