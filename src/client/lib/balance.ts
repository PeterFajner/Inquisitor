// The balance label: a character's power score against ≈10,000 simulated
// characters of its archetype and subtype (src/shared/engine/balance.ts),
// simulated in a Web Worker (balance-worker.ts) and kept in localStorage per
// rules version, so each archetype/subtype is simulated once per version.
//
// The worker is its own esbuild entry; its script URL comes from the client
// build's manifest (/static/client/manifest.json).
import { label, type BalanceLabel, type Distribution } from "../../shared/engine/balance.ts";
import type { BalanceReply, BalanceRequest } from "./balance-worker.ts";
import type { Rules } from "./rules.ts";

export const BALANCE_N = 10_000;
export const BALANCE_SEED = 1;
const PREFIX = "inquisitor:balance:";

const cacheKey = (version: string, archetype: string, subtype: string) => `${PREFIX}${version}:${archetype}/${subtype}`;

function cached(key: string): Distribution | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Distribution) : null;
  } catch {
    return null;
  }
}

function keep(key: string, version: string, d: Distribution): void {
  try {
    // Distributions of other rules versions are of no use any more.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${version}:`)) localStorage.removeItem(k);
    }
    localStorage.setItem(key, JSON.stringify(d));
  } catch {}
}

let worker: Promise<Worker | null> | null = null;
const sentPacks = new Set<string>();
const waiting = new Map<number, (r: BalanceReply) => void>();
let nextId = 1;

async function workerUrl(): Promise<string | null> {
  try {
    const res = await fetch("/static/client/manifest.json");
    const m = (await res.json()) as Record<string, { js?: string }>;
    return m["balance-worker"]?.js || null;
  } catch {
    return null;
  }
}

function getWorker(): Promise<Worker | null> {
  worker ??= workerUrl().then((url) => {
    if (!url || typeof Worker !== "function") return null;
    try {
      const w = new Worker(url, { type: "module" });
      w.addEventListener("message", (ev: MessageEvent<BalanceReply>) => {
        const done = waiting.get(ev.data.id);
        waiting.delete(ev.data.id);
        done?.(ev.data);
      });
      return w;
    } catch {
      return null;
    }
  });
  return worker;
}

function ask(w: Worker, q: Omit<BalanceRequest, "id">): Promise<BalanceReply> {
  const id = nextId++;
  return new Promise((done) => {
    waiting.set(id, done);
    w.postMessage({ ...q, id } satisfies BalanceRequest);
  });
}

const inflight = new Map<string, Promise<Distribution | null>>();

/** The distribution for an archetype/subtype under these rules (cached), or null when it can't be had. */
export function distribution(rules: Rules, archetype: string, subtype: string): Promise<Distribution | null> {
  const key = cacheKey(rules.version, archetype, subtype);
  const have = cached(key);
  if (have) return Promise.resolve(have);
  let p = inflight.get(key);
  if (p) return p;
  p = (async () => {
    const w = await getWorker();
    if (!w) return null;
    const q = { version: rules.version, archetype, subtype, n: BALANCE_N, seed: BALANCE_SEED };
    let reply = await ask(w, sentPacks.has(rules.version) ? q : { ...q, packs: rules.payload.packs });
    sentPacks.add(rules.version);
    if (reply.need) reply = await ask(w, { ...q, packs: rules.payload.packs });
    if (!reply.dist) return null;
    keep(key, rules.version, reply.dist);
    return reply.dist;
  })();
  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}

export type Balance = BalanceLabel & { text: string };

/** "overpowered (+1.3σ vs a median Inquisitors Psyker)": the approved form. */
export function balanceText(score: number, dist: Distribution, archetypeName: string, subtypeName: string): Balance {
  const l = label(score, dist);
  const sigma = `${l.sigma >= 0 ? "+" : "−"}${Math.abs(l.sigma).toFixed(1)}σ`;
  const who = archetypeName.toLowerCase() === subtypeName.toLowerCase() ? archetypeName : `${archetypeName} ${subtypeName}`;
  return { ...l, text: `${l.word} (${sigma} vs a median ${who})` };
}
