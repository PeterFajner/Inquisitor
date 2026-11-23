// JSON to and from Inquisitor's API (/api/v1: src/views/account.ts,
// characters.ts). Every request is same-origin with cookies; the server
// checks the Origin of every POST. Errors come back as {error: "<code>"}
// (and account: "required" when a change needs an account); anything else
// that isn't OK (a dropped connection, a proxy's error page) becomes
// "network" or "http_<status>", so callers only ever look at `error`.
import type { ApiError } from "../../shared/api.ts";

export type Result<T> = ({ ok: true; data: T } | ({ ok: false } & ApiError)) & { status: number };

export async function api<T>(url: string, opts: { json?: unknown; method?: "GET" | "POST" } = {}): Promise<Result<T>> {
  const post = opts.method === "POST" || opts.json !== undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method: post ? "POST" : "GET",
      credentials: "same-origin",
      headers: post ? { "content-type": "application/json" } : {},
      body: opts.json === undefined ? (post ? "{}" : undefined) : JSON.stringify(opts.json),
    });
  } catch {
    return { ok: false, error: "network", status: 0 };
  }
  let out: unknown = null;
  try {
    out = await res.json();
  } catch {}
  const body = out && typeof out === "object" ? (out as Record<string, unknown>) : null;
  if (res.ok && body && typeof body.error !== "string") return { ok: true, data: body as T, status: res.status };
  return {
    ok: false,
    error: typeof body?.error === "string" ? body.error : `http_${res.status}`,
    account: body?.account === "required" ? "required" : undefined,
    status: res.status,
  };
}

// The page's data, embedded by the server (src/views/shell.ts).
export function pageData<T>(): T {
  return JSON.parse(document.getElementById("data")?.textContent || "null") as T;
}
