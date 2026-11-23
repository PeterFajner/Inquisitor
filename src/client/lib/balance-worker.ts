// The balance simulation off the main thread (an esbuild entry of its own,
// scripts/client.ts ENTRIES["balance-worker"]; src/client/lib/balance.ts
// starts it). Messages:
//   in:  { id, version, packs?, archetype, subtype, n, seed }
//        packs (RulesPayload["packs"]) come with the first request for a
//        version; the worker keeps that compendium.
//   out: { id, dist } | { id, error } | { id, need: "packs" }
import type { RulesPayload } from "../../shared/api.ts";
import { simulate, type Distribution } from "../../shared/engine/balance.ts";
import { buildCompendium, type Compendium } from "../../shared/rules/compendium.ts";

export type BalanceRequest = {
  id: number;
  version: string;
  packs?: RulesPayload["packs"];
  archetype: string;
  subtype: string;
  n: number;
  seed: number;
};
export type BalanceReply = { id: number; dist?: Distribution; error?: string; need?: "packs" };

let current: { version: string; compendium: Compendium } | null = null;

const post = (m: BalanceReply) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

self.addEventListener("message", (ev: MessageEvent<BalanceRequest>) => {
  const q = ev.data;
  if (q.packs) current = { version: q.version, compendium: buildCompendium(q.packs) };
  if (!current || current.version !== q.version) return post({ id: q.id, need: "packs" });
  try {
    post({ id: q.id, dist: simulate(current.compendium, q.archetype, q.subtype, q.n, q.seed) });
  } catch (e) {
    post({ id: q.id, error: e instanceof Error ? e.message : String(e) });
  }
});
