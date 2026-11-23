// What the server's balance distributions depend on, shared by the server
// (balance-store.ts) and its warm-up child (scripts/balance-warm.ts).
import { createHash } from "node:crypto";
import type { Distribution } from "../shared/engine/balance.ts";
import type { PackEntries } from "../shared/rules/compendium.ts";

export const BALANCE_N = 1000;
export const BALANCE_SEED = 1;

/** Messages between the server and the child. */
export type ToChild = { want: string };
export type FromChild = { key: string; pair?: string; dist?: Distribution; error?: string; done?: boolean };

// Canonical JSON (sorted keys) of the rules without canvas positions.
const canon = (x: unknown): string => {
  if (Array.isArray(x)) return `[${x.map(canon).join(",")}]`;
  if (x && typeof x === "object")
    return `{${Object.keys(x)
      .filter((k) => k !== "pos")
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(x);
};

const by = <T,>(k: (x: T) => string) => (a: T, b: T) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0);

/** What the distributions depend on (v2: distributions carry their scores): the packs' content (not card positions or the order they were read in), N and the seed. */
export function balanceKey(packs: PackEntries[]): string {
  const sorted = [...packs]
    .sort(by((p) => p.pack.id))
    .map((p) => ({ pack: p.pack, entries: [...p.entries].sort(by((e) => `${e.kind}/${e.id}`)) }));
  return createHash("sha256").update(`v2:${BALANCE_N}:${BALANCE_SEED}:`).update(canon(sorted)).digest("hex").slice(0, 16);
}
