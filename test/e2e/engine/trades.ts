// Trades and upgrades driven with "yes" (engine:trades). A random character
// never trades (ENGINE.md), so each trade a few random characters are
// offered is taken: Occupation's "yes", then "choose at random" for what it
// gives and gets. The book (p. 38): "You may lose two items you've generated
// to roll again on the equipment table. You can also downgrade the
// availability of two of your items by a step to choose one of your
// generated types of gear to be one step higher … Both of these may be done
// any number of times. If a Common item is downgraded, it is lost instead."
// Each trade made: a whole character (no open choices, no warnings, a record
// that replays), as many given up as the trade asks, a downgraded result a
// step lower (a Common one lost, its item gone), an upgraded one a step
// higher with an item of that availability; a trade offered "any" number of
// times taken twice.
import * as ops from "../../../src/client/builder/ops.ts";
import type { BuildResult } from "../../../src/shared/engine/build.ts";
import type { CharacterRecord } from "../../../src/shared/engine/record.ts";
import { seededRoller } from "../../../src/shared/engine/rng.ts";
import type { Compendium } from "../../../src/shared/rules/compendium.ts";
import type { Availability, Effect } from "../../../src/shared/rules/schema.ts";
import type { Report, Repro } from "../lib/report.ts";
import { archetypeIds, archetype, realCompendium } from "../lib/rules.ts";
import type { RunOptions } from "../shards.ts";
import { checkCharacter, gearPolicies, leafOf, norm, openPickBounds, randomBuild, replay } from "./archetype.ts";
import { effectsById } from "./kinds.ts";

const STEPS: Availability[] = ["Common", "Rare", "Exotic", "Legendary"];
const step = (a: Availability | undefined, n: number) => (a ? STEPS[Math.max(0, Math.min(3, STEPS.indexOf(a) + n))] : undefined);

type TradeEffect = Extract<Effect, { trade: unknown }>;

export async function engineTrades(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  const bounds = openPickBounds(c);
  const byId = effectsById(c);
  const seeds = Math.max(2, Math.min(o.fewSeeds, 6));
  for (const archId of archetypeIds()) {
    const arch = archetype(archId);
    const gear = gearPolicies(arch);
    for (const sub of arch.subtypes) {
      for (let seed = 1; seed <= seeds; seed++) {
        const b = randomBuild(c, archId, sub.id, seed);
        const offered = Object.keys(b.record.choices).filter((k) => /#1$/.test(k) && b.record.choices[k][0] === "no");
        for (const k of offered) {
          const eff = byId.get(leafOf(k))?.find((x): x is TradeEffect => "trade" in x);
          if (!eff) continue;
          const base: Repro = { archetype: archId, subtype: sub.id, seed, key: k, record: b.record, steps: [`random build seededRoller(${seed})`, `choose(${JSON.stringify(k)}, ["yes"])`, `fillPending() with seededRoller(${7_100_000 + seed})`] };
          const once = take(r, c, b, b.record, k, eff, base, seed, "trade");
          if (!once) continue;
          checkCharacter(r, c, arch, once.after, { ...base, record: once.rec }, "after a trade", bounds, gear);
          // "any number of times": a second time.
          if (eff.trade.times === "any" || (typeof eff.trade.times === "number" && eff.trade.times > 1)) {
            const k2 = k.replace(/#1$/, "#2");
            if (once.rec.choices[k2]?.[0] !== "no") {
              r.expect(once.after.log.some((e) => e.key === k2) || eff.trade.times !== "any", "a trade offered any number of times is offered again", `${k2} not offered after ${k}`, { ...base, record: once.rec }, norm(k));
              continue;
            }
            const twice = take(r, c, once.after, once.rec, k2, eff, { ...base, steps: [...base.steps!, `choose(${JSON.stringify(k2)}, ["yes"])`, "fillPending()"] }, seed + 500, "trade twice");
            if (twice) checkCharacter(r, c, arch, twice.after, { ...base, record: twice.rec }, "after a trade made twice", bounds, gear);
          }
        }
      }
    }
  }
}

/** Takes trade `k` ("yes", what it gives and gets at random), checks what it gave and got; the record and character after. */
function take(r: Report, c: Compendium, before: BuildResult, rec: CharacterRecord, k: string, eff: TradeEffect, rep: Repro, seed: number, what: string): { rec: CharacterRecord; after: BuildResult } | null {
  let next: CharacterRecord;
  try {
    next = ops.fillPending(c, ops.choose(c, rec, k, ["yes"], { roll: seededRoller(7_000_000 + seed) }), { roll: seededRoller(7_100_000 + seed) });
  } catch (e) {
    r.fail(`${what} doesn't throw`, String((e as Error).stack ?? e).slice(0, 800), rep, `${norm(k)}: ${(e as Error).message}`);
    return null;
  }
  const after = replay(r, c, next, { ...rep, record: next }, what);
  r.expect(next.choices[k]?.[0] === "yes", `${what} keeps the "yes"`, `${k}: ${JSON.stringify(next.choices[k])}`, { ...rep, record: next }, norm(k));
  const give = eff.trade.give;
  const given = next.choices[`${k}:give`] ?? [];
  const want = give.count ?? 1;
  const offered = ops.choiceOptions(c, next, `${k}:give`)?.options.length;
  if (offered !== undefined) r.expect(given.length === Math.min(want, offered), `${what} gives up as many as it asks`, `${k}:give: ${given.length} given, ${want} asked, ${offered} offered`, { ...rep, record: next }, norm(k));
  const chB = before.character;
  const chA = after.character;
  if (give.lose) {
    for (const g of given) {
      const [kind, id] = g.split(":");
      const qty = (ch: typeof chA) => (ch[`${kind}s` as "items"] as { id: string; qty?: number }[] | undefined)?.find((t) => t.id === id)?.qty ?? ((ch[`${kind}s` as "items"] as { id: string }[] | undefined)?.some((t) => t.id === id) ? 1 : 0);
      // (what the trade gets may be the same thing again: a roll again on the equipment table)
      const again = after.log.filter((e) => e.key.startsWith(`${k}>`) && e.type === "choice" && (next.choices[e.key] ?? []).some((x) => x === id || x === g)).length;
      r.expect(qty(chA) - again < qty(chB), `${what}: what is given up is gone`, `${g}: ${qty(chB)} before, ${qty(chA)} after (${again} got again)`, { ...rep, record: next }, `${norm(k)} ${kind}`);
    }
  }
  if (give.downgrade) {
    for (const slot of given) {
      const was = chB.rolls.find((x) => x.key === slot);
      const now = chA.rolls.find((x) => x.key === slot);
      if (!was?.availability) continue;
      const upgraded = Object.entries(next.choices).some(([kk, v]) => kk.startsWith(`${k}>`) && v.includes(slot));
      if (was.availability === "Common") {
        r.expect(!!now?.lost || upgraded, `${what}: a Common result downgraded is lost (p. 38)`, `${slot} (${was.label}) not lost: ${JSON.stringify(now)}`, { ...rep, record: next }, norm(k));
        const left = chA.items.filter((it) => it.from.some((f) => f.key && (f.key === `${slot}:item` || f.key.startsWith(`${slot}>`) || f.key.endsWith(`>${slot}:item`))));
        if (!upgraded) r.expect(!left.length, `${what}: a lost result's item is gone`, `${slot}: still ${left.map((x) => x.name).join(", ")}`, { ...rep, record: next }, norm(k));
      } else if (!upgraded) {
        r.expect(now?.availability === step(was.availability, -give.downgrade), `${what}: a downgraded result is a step lower`, `${slot}: ${was.availability} → ${now?.availability}`, { ...rep, record: next }, norm(k));
        const its = chA.items.filter((it) => it.from.some((f) => f.key?.endsWith(`${slot}:item`)));
        for (const it of its) if (it.availability && c.items.get(it.id)?.unrestricted !== true) r.expect(it.availability === now?.availability, `${what}: the item chosen again is of the new availability`, `${it.name} ${it.availability}, result ${now?.availability}`, { ...rep, record: next }, norm(k));
      }
    }
  }
  // An upgrade: the result chosen a step higher, its item of that availability.
  for (const e of eff.trade.get) {
    if (!("upgrade" in e)) continue;
    const upKey = Object.keys(next.choices).find((kk) => kk === `${k}>${leafOf(k).split("/")[0]}/${e.id}`);
    const slot = upKey ? next.choices[upKey]?.[0] : undefined;
    r.expect(!!slot, `${what}: the upgrade chooses a result`, `${k}: no ${e.id} choice (${Object.keys(next.choices).filter((x) => x.startsWith(k)).join(", ")})`, { ...rep, record: next }, norm(k));
    if (!slot) continue;
    const was = chB.rolls.find((x) => x.key === slot);
    const now = chA.rolls.find((x) => x.key === slot);
    const down = given.includes(slot) ? (give.downgrade ?? 0) : 0;
    const wantAvail = step(step(was?.availability, -down), e.upgrade);
    if (was?.availability) r.expect(now?.availability === wantAvail, `${what}: an upgraded result is a step higher (p. 38)`, `${slot}: ${was.availability}${down ? ` (downgraded too)` : ""} → ${now?.availability}, wanted ${wantAvail}`, { ...rep, record: next }, norm(k));
    if (given.includes(slot)) r.note(`${k}: the upgrade chose ${slot}, a result it also downgraded (the book doesn't forbid it), e.g. ${rep.archetype}/${rep.subtype} seed ${rep.seed}`);
    const its = chA.items.filter((it) => it.from.some((f) => f.key?.startsWith(`${upKey}>`)));
    for (const it of its) if (it.availability && c.items.get(it.id)?.unrestricted !== true) r.expect(it.availability === now?.availability, `${what}: the upgraded item is of the new availability`, `${it.name} ${it.availability}, result ${now?.availability}`, { ...rep, record: next }, norm(k));
  }
  return { rec: next, after };
}
