// Builds the browser code (src/client) with esbuild into dist/client:
//
//   node scripts/client.ts      production build, minified (npm run build)
//   scripts/dev.ts              the same in watch mode, unminified, with source maps
//
// One entry per page bundle (ENTRIES). Shared code (Preact, components) is
// split into chunks, and anything loaded with import() gets its own. Every
// file is named by its content hash, so nginx can cache /static/client/
// forever. manifest.json tells the server (src/views/shell.ts) each entry's
// script, CSS and chunks:
//   { "app": { "js": "/static/client/app-XXXX.js", "css": [...], "preload": [...] } }
// Files from earlier builds are removed after each build.
import { build, context, type BuildOptions, type Metafile, type Plugin } from "esbuild";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
// CLIENT_OUT lets parallel checkouts/agents build side by side (the server reads the same variable).
const OUT = resolve(ROOT, process.env.CLIENT_OUT || "dist/client");
const PUBLIC = "/static/client/";
// Entries the server names in manifest.json.
export const ENTRIES: Record<string, string> = {
  app: "src/client/app.tsx",
  // The balance simulation's Web Worker (src/client/lib/balance.ts finds it in manifest.json).
  "balance-worker": "src/client/lib/balance-worker.ts",
};

type Entry = { js: string; css: string[]; preload: string[] };

export function manifestOf(meta: Metafile): Record<string, Entry> {
  const outputs = meta.outputs;
  const url = (file: string) => PUBLIC + relative(OUT, resolve(ROOT, file));
  // An output's static imports, transitively (what to modulepreload).
  const chunks = (file: string, seen = new Set<string>()): string[] => {
    for (const imp of outputs[file]?.imports ?? []) {
      if (imp.kind !== "import-statement" || seen.has(imp.path)) continue;
      seen.add(imp.path);
      chunks(imp.path, seen);
    }
    return [...seen];
  };
  const manifest: Record<string, Entry> = {};
  const names = new Map(Object.entries(ENTRIES).map(([name, src]) => [src, name]));
  for (const [file, out] of Object.entries(outputs)) {
    const name = out.entryPoint && names.get(out.entryPoint);
    if (!name) continue;
    if (file.endsWith(".js")) manifest[name] = { js: url(file), css: out.cssBundle ? [url(out.cssBundle)] : [], preload: chunks(file).map(url) };
    // A stylesheet entry: CSS only.
    else if (file.endsWith(".css")) manifest[name] ??= { js: "", css: [url(file)], preload: [] };
  }
  return manifest;
}

// Writes manifest.json and deletes what the build no longer makes.
const manifestPlugin: Plugin = {
  name: "manifest",
  setup(b) {
    b.onEnd((result) => {
      if (result.errors.length || !result.metafile) return;
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifestOf(result.metafile), null, 1) + "\n");
      const keep = new Set(Object.keys(result.metafile.outputs).map((f) => basename(f)));
      keep.add("manifest.json");
      for (const f of readdirSync(OUT)) if (!keep.has(f)) rmSync(join(OUT, f), { recursive: true, force: true });
    });
  },
};

export function clientOptions(mode: "production" | "development"): BuildOptions {
  const prod = mode === "production";
  return {
    absWorkingDir: ROOT,
    entryPoints: Object.values(ENTRIES),
    bundle: true,
    splitting: true,
    format: "esm",
    outdir: OUT,
    entryNames: "[name]-[hash]",
    chunkNames: "chunk-[hash]",
    assetNames: "[name]-[hash]",
    publicPath: PUBLIC,
    metafile: true,
    write: true,
    minify: prod,
    sourcemap: prod ? false : "linked",
    target: ["es2022", "chrome105", "firefox110", "safari16"],
    jsx: "automatic",
    jsxImportSource: "preact",
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    legalComments: prod ? "eof" : "inline",
    logLevel: "info",
    // docx-templates' browser bundle references readable-stream but never loads it
    // /static/ is served as is (src/static): CSS url()s there stay as written.
    external: ["readable-stream", "/static/*"],
    plugins: [manifestPlugin],
  };
}

export async function watchClient(): Promise<{ dispose(): Promise<void> }> {
  const ctx = await context(clientOptions("development"));
  await ctx.rebuild();
  await ctx.watch();
  return ctx;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rmSync(OUT, { recursive: true, force: true });
  await build(clientOptions("production"));
}
