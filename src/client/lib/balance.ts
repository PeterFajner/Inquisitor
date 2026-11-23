// The balance label: a character's power score against 1,000 simulated
// characters of its archetype and subtype (src/shared/engine/balance.ts).
// The server works those out once per rules version for everyone
// (src/lib/balance-store.ts, GET /api/v1/balance); this browser keeps them
// in localStorage per rules version. While the server is still at it (or
// offline), a quick estimate from 500 characters simulated here in a Web
// Worker (balance-worker.ts) shows instead.
//
// The worker is its own esbuild entry; its script URL comes from the client
// build's manifest (/static/client/manifest.json).
import { label, labelText, type BalanceLabel, type Distribution } from "../../shared/engine/balance.ts";
import type { BalanceReply, BalanceRequest } from "./balance-worker.ts";
import type { Rules } from "./rules.ts";
import { API } from "../../shared/api.ts";

export const QUICK_N = 500;
/** The shape of a distribution: 2 = with every score (percentile labels). */
export const BALANCE_FORMAT = 2;
export const BALANCE_SEED = 1;
const PREFIX = "inquisitor:balance2:"; // 2: with the scores (percentile labels)

const cacheKey = (version: string, archetype: string, subtype: string) => `${PREFIX}${version}:${archetype}/${subtype}`;

/** A distribution this code can use: one with its scores (older ones only had a summary). */
const usable = (d: unknown): d is Distribution => !!d && typeof d === "object" && Array.isArray((d as Distribution).scores) && (d as Distribution).scores.length > 0;

function cached(key: string): Distribution | null {
  try {
    const raw = localStorage.getItem(key);
    const d: unknown = raw ? JSON.parse(raw) : null;
    if (usable(d)) return d;
    if (raw) localStorage.removeItem(key);
  } catch {}
  return null;
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

type Lane = "quick";
const workers: Record<Lane, Promise<Worker | null> | null> = { quick: null };
const sentPacks: Record<Lane, Set<string>> = { quick: new Set() };
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

function getWorker(lane: Lane): Promise<Worker | null> {
  return (workers[lane] ??= workerUrl().then((url) => {
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
  }));
}

function ask(w: Worker, q: Omit<BalanceRequest, "id">): Promise<BalanceReply> {
  const id = nextId++;
  return new Promise((done) => {
    waiting.set(id, done);
    w.postMessage({ ...q, id } satisfies BalanceRequest);
  });
}

const inflight = new Map<string, Promise<Distribution | null>>();

async function simulateIn(lane: Lane, rules: Rules, archetype: string, subtype: string, n: number): Promise<Distribution | null> {
  const w = await getWorker(lane);
  if (!w) return null;
  const q = { version: rules.version, archetype, subtype, n, seed: BALANCE_SEED };
  const sent = sentPacks[lane];
  let reply = await ask(w, sent.has(rules.version) ? q : { ...q, packs: rules.payload.packs });
  sent.add(rules.version);
  if (reply.need) reply = await ask(w, { ...q, packs: rules.payload.packs });
  return reply.dist ?? null;
}

/** How long to keep asking the server while it works the distribution out. */
const SERVER_WAIT_MS = 5 * 60_000;

async function fromServer(rules: Rules, archetype: string, subtype: string): Promise<Distribution | null> {
  // `format` changes with the distribution's shape, so a response cached for the same rules version in the old shape isn't reused
  const q = new URLSearchParams({ version: rules.version, archetype, subtype, format: String(BALANCE_FORMAT) });
  const until = Date.now() + SERVER_WAIT_MS;
  while (Date.now() < until) {
    let res: Response;
    try {
      res = await fetch(`${API}/balance?${q}`, { credentials: "same-origin" });
    } catch {
      return null;
    }
    if (res.status === 200) {
      const d: unknown = await res.json();
      return usable(d) ? d : null;
    }
    if (res.status !== 202) return null;
    await new Promise((done) => setTimeout(done, 3000));
  }
  return null;
}

/** The server's distribution for an archetype/subtype under these rules (cached), or null when it can't be had. */
export function distribution(rules: Rules, archetype: string, subtype: string): Promise<Distribution | null> {
  const key = cacheKey(rules.version, archetype, subtype);
  const have = cached(key);
  if (have) return Promise.resolve(have);
  let p = inflight.get(key);
  if (p) return p;
  p = fromServer(rules, archetype, subtype).then((d) => {
    if (d) keep(key, rules.version, d);
    return d;
  });
  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}

const quick = new Map<string, Promise<Distribution | null>>();

/** The full distribution when it's cached, else a quick estimate (QUICK_N characters), kept in memory. */
export function quickDistribution(rules: Rules, archetype: string, subtype: string): Promise<Distribution | null> {
  const key = cacheKey(rules.version, archetype, subtype);
  const have = cached(key);
  if (have) return Promise.resolve(have);
  let p = quick.get(key);
  if (!p) {
    p = simulateIn("quick", rules, archetype, subtype, QUICK_N);
    quick.set(key, p);
  }
  return p;
}

/** Whether the full distribution is already kept. */
export const hasDistribution = (rules: Rules, archetype: string, subtype: string): boolean => !!cached(cacheKey(rules.version, archetype, subtype));

export type Balance = BalanceLabel & { text: string };

/** The word, and "This character is in the top 1.5% of randomly-rolled Inquisitor Fighters." (archetypeName: the archetype's `characters` name). */
export function balanceText(score: number, dist: Distribution, archetypeName: string, subtypeName: string): Balance {
  const l = label(score, dist);
  const who = archetypeName.toLowerCase() === subtypeName.toLowerCase() ? archetypeName : `${archetypeName} ${subtypeName}`;
  return { ...l, text: labelText(l, who) };
}
