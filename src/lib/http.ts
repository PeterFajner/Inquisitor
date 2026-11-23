// Small HTTP layer over node:http: a router, a per-request context with
// cookies, JSON bodies, and replies. Handlers throw HttpError for 404s
// and redirects instead of returning them.
import type { IncomingMessage, ServerResponse } from "node:http";

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  cookies: Record<string, string>;
  /** Set-Cookie values to send with the reply. */
  setCookies: string[];
  /** True when the browser reached us over https (behind nginx / tailscale serve). */
  secure: boolean;
};

export type Handler = (ctx: Ctx) => Promise<void> | void;

export class HttpError extends Error {
  status: number;
  location?: string;
  constructor(status: number, message = "", location?: string) {
    super(message);
    this.status = status;
    this.location = location;
  }
}

export const notFound = (): never => {
  throw new HttpError(404, "not_found");
};
export const redirectTo = (location: string): never => {
  throw new HttpError(303, "", location);
};

type Route = { method: string; re: RegExp; keys: string[]; handler: Handler };

export class Router {
  routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler): this {
    // "/r/:slug" -> /^\/r\/([^/]+)\/?$/
    const keys: string[] = [];
    const re = new RegExp(
      "^" + pattern.replace(/:([a-z_]+)/gi, (_, k: string) => (keys.push(k), "([^/]+)")) + "/?$",
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(pattern: string, handler: Handler): this {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: Handler): this {
    return this.add("POST", pattern, handler);
  }
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method && !(method === "HEAD" && r.method === "GET")) continue;
      const m = path.match(r.re);
      if (!m) continue;
      try {
        return {
          handler: r.handler,
          params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
        };
      } catch {
        return null; // malformed percent-encoding
      }
    }
    return null;
  }
}

export function parseCookies(header = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore a malformed cookie
    }
  }
  return out;
}

export function setCookie(
  ctx: Ctx,
  name: string,
  value: string,
  opts: { maxAge?: number; sameSite?: "Lax" | "Strict"; httpOnly?: boolean } = {},
): void {
  const { maxAge, sameSite = "Lax", httpOnly = true } = opts;
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=${sameSite}`;
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  if (httpOnly) c += "; HttpOnly";
  if (ctx.secure) c += "; Secure";
  ctx.setCookies.push(c);
}

export async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return (await readBuffer(req, limit)).toString("utf8");
}

export function readBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "too_large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// The body as JSON; 400 when it isn't, 413 past `limit` bytes.
export async function readJson(ctx: Ctx, limit = 256 * 1024): Promise<unknown> {
  const body = await readBody(ctx.req, limit);
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

// Same-origin check for state-changing requests: the Origin header (or,
// failing that, Referer) must name the host the request was sent to. Stops
// another site from posting forms with the viewer's cookies.
export function sameOrigin(req: IncomingMessage): boolean {
  try {
    const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : null);
    if (!origin || origin === "null") return false;
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function headersWithCookies(ctx: Ctx, headers: Record<string, string>): Record<string, string | string[]> {
  return ctx.setCookies.length ? { ...headers, "set-cookie": ctx.setCookies } : headers;
}

export function sendHtml(ctx: Ctx, body: string, status = 200): void {
  ctx.res.writeHead(
    status,
    headersWithCookies(ctx, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }),
  );
  ctx.res.end(ctx.req.method === "HEAD" ? undefined : body);
}

// JSON, not cached unless `headers` says otherwise.
export function sendJson(ctx: Ctx, value: unknown, status = 200, headers: Record<string, string> = {}): void {
  ctx.res.writeHead(status, headersWithCookies(ctx, { "content-type": "application/json", "cache-control": "no-store", ...headers }));
  ctx.res.end(JSON.stringify(value));
}

