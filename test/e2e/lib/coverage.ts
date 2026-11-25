// What random characters reach: every table row rolled, thing owned and
// named option chosen, as "row:<table>|<label>", "<kind>:<id>",
// "option:<entry>|<option id>". Shards add what theirs reached to their
// result (Report.coverage); test/e2e/coverage.ts lists what no shard
// reached, against everything the rules hold (`universe`).
import type { BuildResult } from "../../../src/shared/engine/build.ts";
import type { Compendium } from "../../../src/shared/rules/compendium.ts";
import type { Report } from "./report.ts";
import { optionsOf } from "./outcomes.ts";

export function reach(r: Report, b: BuildResult): void {
  const ch = b.character;
  for (const x of ch.rolls) r.coverage.add(`row:${x.table}|${x.label}`);
  for (const t of [...ch.talents, ...ch.exotics, ...ch.mutations, ...ch.powers, ...ch.items]) if (!t.overridden) r.coverage.add(`${t.kind}:${t.id}`);
  for (const o of ch.options) r.coverage.add(`option:${o.source}|${o.id}`);
  for (const t of [...ch.talents, ...ch.exotics, ...ch.mutations, ...ch.powers, ...ch.items]) for (const x of t.chosen ?? []) r.coverage.add(`${x.kind}:${x.id}`);
}

/** Everything a character could reach: each table's rows (those with a range), every thing, every named option. */
export function universe(c: Compendium): Map<string, string> {
  const out = new Map<string, string>(); // key → a readable name
  for (const t of c.tables.values())
    for (const row of t.rows) {
      const ranged = "range" in row ? !!row.range : Object.keys((row as { ranges?: object }).ranges ?? {}).length > 0;
      if (ranged) out.set(`row:${t.id}|${row.label}`, `${t.name}: ${row.label}`);
    }
  for (const [kind, map] of [["talent", c.talents], ["exotic", c.exotics], ["mutation", c.mutations], ["power", c.powers], ["item", c.items]] as const)
    for (const e of map.values()) out.set(`${kind}:${e.id}`, `${kind} ${e.name}`);
  for (const [k, o] of optionsOf(c)) out.set(`option:${k}`, `option ${k.split("|")[0]}: ${o.name}`);
  return out;
}
