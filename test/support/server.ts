// A test server: a throwaway database with every migration applied, the
// app listening on a random local port, and a fetch that acts like the
// browser (same-origin Origin header, its own cookie jar).
//
// Import this first in a test file: it sets DATABASE_PATH and
// PUBLIC_ORIGIN before the app opens the database.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const dir = mkdtempSync(join(tmpdir(), "inquisitor-test-"));
process.env.DATABASE_PATH = join(dir, "test.db");
export const ORIGIN = "https://inquisitor.test";
process.env.PUBLIC_ORIGIN = ORIGIN;

const { db } = await import("../../src/lib/db.ts");
const { applyMigration } = await import("../../src/lib/migrations.ts");
for (const f of readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort()) {
  applyMigration(db, readFileSync(join("db/migrations", f), "utf8"));
}
const { startServer } = await import("../../src/server.ts");
export { db };

export const server = await startServer(0, "127.0.0.1");
export const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

export type Reply = { status: number; body: any; headers: Headers };

// One browser: keeps its cookies.
export class Browser {
  cookies = new Map<string, string>();
  origin: string | null = base;

  async req(method: string, path: string, json?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const h: Record<string, string> = { ...headers };
    if (this.origin && method !== "GET") h.origin = this.origin;
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (json !== undefined) h["content-type"] = "application/json";
    const res = await fetch(base + path, { method, headers: h, body: json === undefined ? undefined : JSON.stringify(json), redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === "" || attrs.some((a) => /max-age=0/i.test(a.trim()))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: res.status, body, headers: res.headers };
  }
  get = (path: string) => this.req("GET", path);
  post = (path: string, json?: unknown) => this.req("POST", path, json);
}

// A browser signed into a new account (its passkey made by a software
// authenticator); public_id is what history shows for it.
export async function newAccount(): Promise<Browser & { publicId: string }> {
  const { SoftAuthenticator } = await import("./soft-authenticator.ts");
  const b = new Browser();
  const o = (await b.post("/api/v1/account/passkey", { step: "register-options" })).body.options;
  const r = await b.post("/api/v1/account/passkey", { step: "register", response: new SoftAuthenticator(ORIGIN).register({ challenge: o.challenge }) });
  if (r.status !== 200) throw new Error(`register: ${JSON.stringify(r.body)}`);
  return Object.assign(b, { publicId: r.body.account.public_id as string });
}
