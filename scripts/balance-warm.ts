// The balance warm-up, run by the server (src/lib/balance-store.ts) as a
// child process: simulates every archetype/subtype of the rules in RULES_DIR
// and sends each distribution back as it's done. Pairs the server asks for
// (a browser is waiting) go first. Exits when every pair is done, or when the
// rules on disk aren't the ones it was started for.
//   fork("scripts/balance-warm.ts", [key])
import { loadAllPacksIsolated } from "../src/lib/rules-files.ts";
import { BALANCE_N, BALANCE_SEED, balanceKey, type FromChild, type ToChild } from "../src/lib/balance-key.ts";
import { buildCompendium } from "../src/shared/rules/compendium.ts";
import { simulate } from "../src/shared/engine/balance.ts";

const expected = process.argv[2];
const send = (m: FromChild) => process.send?.(m);
const packs = loadAllPacksIsolated();
const key = balanceKey(packs);
if (key !== expected) {
  send({ key, done: true });
  process.exit(0);
}
const c = buildCompendium(packs);
const todo = [...c.archetypes.values()].flatMap((a) => a.subtypes.map((s) => `${a.id}/${s.id}`));
const wanted: string[] = [];
process.on("message", (m: ToChild) => {
  if (m.want && !wanted.includes(m.want)) wanted.push(m.want);
});
process.on("disconnect", () => process.exit(0));

// One pair per tick, so wanted pairs (messages) are seen between pairs.
const next = () => {
  const w = wanted.shift();
  const i = w !== undefined ? todo.indexOf(w) : 0;
  if (i < 0) return setImmediate(next);
  const [pair] = todo.splice(i, 1);
  if (pair === undefined) {
    send({ key, done: true });
    return process.exit(0);
  }
  const [a, s] = pair.split("/");
  try {
    send({ key, pair, dist: simulate(c, a, s, BALANCE_N, BALANCE_SEED) });
  } catch (e) {
    send({ key, pair, error: (e as Error).message });
  }
  setImmediate(next);
};
next();
