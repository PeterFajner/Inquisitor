// Card heights for the rules page, worked out on the server so a first visit
// sizes every card at once (src/client/rules/sizes.ts: each card's slot, its
// content skipped until it's near the screen). The work is the browser's own
// card code, bundled for Node by scripts/client.ts
// (dist/layout/bake.js): cards rendered into a tiny DOM and laid out from the
// app's CSS and the fonts' advance widths, no browser. Done once per rules
// version, in a child process (./rules-heights-worker.ts) with a small heap,
// whose memory goes back to the system when it's done; an edit reworks only the cards it
// changes (or whose names it changes). Without the bundle (tests, no
// build) there are no heights and the browser works them out itself.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fork } from "node:child_process";
import { setPriority } from "node:os";
import type { RulesHeights, RulesPayload } from "../shared/api.ts";
import { rulesPayload } from "./rules-store.ts";

const FILE = resolve(process.env.APP_ROOT || process.cwd(), process.env.LAYOUT_OUT || "dist/layout", "bake.js");
const WORKER = join(import.meta.dirname, `rules-heights-worker.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`);
/** The child's heap: its live data is ~15 MB (~1,000 cards); a tight limit makes it collect garbage early rather than grow. */
const HEAP_MB = 40;

type Baked = { heights: RulesHeights };
let done: (Baked & { body: string }) | null = null;
let working: { version: string; promise: Promise<void> } | null = null;

const available = () => existsSync(FILE);

function bakeIn(payload: RulesPayload, prev: Baked | null): Promise<Baked> {
  return new Promise((ok, fail) => {
    const proc = fork(WORKER, [], {
      execArgv: ["--disable-warning=ExperimentalWarning", `--max-old-space-size=${HEAP_MB}`, "--max-semi-space-size=1"],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      serialization: "advanced",
    });
    try {
      if (proc.pid) setPriority(proc.pid, 10);
    } catch {}
    proc.once("message", (m) => ok(m as Baked));
    proc.once("error", fail);
    proc.once("exit", (code) => fail(new Error(`exited (${code})`)));
    proc.send({ file: FILE, payload, prev });
  });
}

/** Starts working out the current version's heights (if not done or under way). */
export function warmHeights(): void {
  const payload = rulesPayload();
  if (done?.heights.version === payload.version || working?.version === payload.version) return;
  const version = payload.version;
  const promise = (async () => {
    if (!available()) return;
    const t0 = performance.now();
    const { heights } = await bakeIn(payload, done ? { heights: done.heights } : null);
    // A newer version may have started meanwhile: keep this one only if it's still current.
    if (rulesPayload().version === version) done = { heights, body: JSON.stringify(heights) };
    if (process.env.NODE_ENV !== "test") console.log(`rules heights: ${Object.keys(heights.cards).length} cards in ${Math.round(performance.now() - t0)} ms`);
  })()
    .catch((e: unknown) => console.error("rules heights:", e))
    .finally(() => {
      if (working?.version === version) working = null;
    });
  working = { version, promise };
}

/** The current version's heights: ready, being worked out, or not available here. */
export async function currentHeights(): Promise<{ etag: string; body: string } | "pending" | "unavailable"> {
  if (!available()) return "unavailable";
  const version = rulesPayload().version;
  const ready = () => (done?.heights.version === version ? { etag: `"${version}.${done.heights.build}"`, body: done.body } : null);
  const now = ready();
  if (now) return now;
  warmHeights();
  // An edit's few cards are quick: wait a moment rather than answer "pending".
  await Promise.race([working?.promise, new Promise((r) => setTimeout(r, 300))]);
  return ready() ?? "pending";
}
