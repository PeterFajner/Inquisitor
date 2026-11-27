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
//
// It also bundles the card layout for the server (LAYOUT_ENTRY → dist/layout/
// bake.js, which src/lib/rules-heights.ts loads to work out card heights)
// and stamps both bundles with LAYOUT_BUILD, a hash of every source file the
// card heights depend on, so the browser knows when the server's heights
// came from the same code.
import { createHash } from "node:crypto";
import { build, context, type BuildOptions, type Metafile, type Plugin } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// The server's card layout bundle.
export const LAYOUT_ENTRY = "src/client/rules/bake.ts";
const LAYOUT_OUT = resolve(ROOT, process.env.LAYOUT_OUT || "dist/layout");

/** `import css from "./x.css?text"`: the stylesheet's text (comments and extra whitespace dropped). */
export const cssTextPlugin: Plugin = {
  name: "css-text",
  setup(b) {
    b.onResolve({ filter: /\.css\?text$/ }, (a) => ({ path: resolve(a.resolveDir, a.path.slice(0, -"?text".length)), namespace: "css-text" }));
    b.onLoad({ filter: /.*/, namespace: "css-text" }, (a) => ({
      contents: readFileSync(a.path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim(),
      loader: "text",
      watchFiles: [a.path],
    }));
  },
};

/** A hash of every source file the card layout bundle is built from. */
export async function layoutBuild(): Promise<string> {
  const r = await build({ ...layoutOptions("development", "0"), write: false, metafile: true, logLevel: "silent" });
  const h = createHash("sha256");
  for (const input of Object.keys(r.metafile!.inputs).sort()) {
    const file = resolve(ROOT, input.replace(/^css-text:/, ""));
    h.update(input).update("\0").update(readFileSync(file)).update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

/** The card layout for Node (the server): one ES module, Preact and the cards' code bundled in. */
export function layoutOptions(mode: "production" | "development", build: string): BuildOptions {
  return {
    absWorkingDir: ROOT,
    entryPoints: [LAYOUT_ENTRY],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(LAYOUT_OUT, "bake.js"),
    minify: mode === "production",
    target: ["node22"],
    jsx: "automatic",
    jsxImportSource: "preact",
    define: { "process.env.NODE_ENV": JSON.stringify(mode), LAYOUT_BUILD: JSON.stringify(build) },
    logLevel: "info",
    plugins: [cssTextPlugin],
  };
}

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

export function clientOptions(mode: "production" | "development", layout = "0"): BuildOptions {
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
    define: { "process.env.NODE_ENV": JSON.stringify(mode), LAYOUT_BUILD: JSON.stringify(layout) },
    legalComments: prod ? "eof" : "inline",
    logLevel: "info",
    // docx-templates' browser bundle references readable-stream but never loads it;
    // jsPDF import()s html2canvas, dompurify and canvg only for html() and SVG, which the PDF export never calls
    // /static/ is served as is (src/static): CSS url()s there stay as written.
    external: ["readable-stream", "html2canvas", "dompurify", "canvg", "/static/*"],
    plugins: [manifestPlugin, cssTextPlugin],
  };
}

export async function watchClient(): Promise<{ dispose(): Promise<void> }> {
  // (LAYOUT_BUILD as of the start: restart `npm run dev` to stamp later changes.)
  const stamp = await layoutBuild();
  const ctxs = [await context(clientOptions("development", stamp)), await context(layoutOptions("development", stamp))];
  for (const c of ctxs) {
    await c.rebuild();
    await c.watch();
  }
  return { dispose: async () => void (await Promise.all(ctxs.map((c) => c.dispose()))) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rmSync(OUT, { recursive: true, force: true });
  rmSync(LAYOUT_OUT, { recursive: true, force: true });
  const stamp = await layoutBuild();
  await build(clientOptions("production", stamp));
  await build(layoutOptions("production", stamp));
}
