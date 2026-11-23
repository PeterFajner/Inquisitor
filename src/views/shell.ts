// The HTML shell of a page rendered in the browser by src/client (Preact):
// <head> with the entry's CSS and scripts from the client build, an empty
// #app, and the page's data as JSON (PageData, src/shared/api.ts). The
// client build (scripts/client.ts) writes dist/client/manifest.json, which
// names each entry's content-hashed files; it's re-read when it changes, so
// `npm run dev` picks up a rebuild without a server restart.
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { html, page, raw, type Html } from "../lib/html.ts";
import { sendHtml, type Ctx } from "../lib/http.ts";

export type Entry = { js: string; css: string[]; preload: string[] };
export type Manifest = Record<string, Entry>;

const MANIFEST = join(resolve(process.env.APP_ROOT || process.cwd()), "dist/client/manifest.json");
let cached: { mtime: number; manifest: Manifest } | null = null;
let warned = false;

export function manifest(): Manifest {
  try {
    const mtime = statSync(MANIFEST).mtimeMs;
    if (cached?.mtime !== mtime) cached = { mtime, manifest: JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest };
    return cached.manifest;
  } catch {
    if (!warned) console.warn(`no client build at ${MANIFEST}: run npm run build (or npm run dev)`);
    warned = true;
    return {};
  }
}

// Data for a <script type="application/json">: `<` is escaped so nothing in
// it (a character named "</script>") can close the tag.
export const jsonScript = (id: string, data: unknown): Html =>
  raw(`<script type="application/json" id="${id}">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);

export function clientPage(ctx: Ctx, opts: { title?: string; entry?: string; data: unknown; status?: number; noindex?: boolean }): void {
  const entry = manifest()[opts.entry ?? "app"];
  sendHtml(
    ctx,
    page({
      title: opts.title ?? "Inquisitor",
      css: entry?.css ?? [],
      scripts: entry?.js ? [entry.js] : [],
      head: html`${(entry?.preload ?? []).map((u) => html`<link rel="modulepreload" href="${u}">`)}`,
      noindex: opts.noindex,
      body: html`<div id="app"></div>
${jsonScript("data", opts.data)}`,
    }),
    opts.status,
  );
}
