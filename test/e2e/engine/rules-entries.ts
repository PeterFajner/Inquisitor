// Rules changes to the entries a saved character uses
// (engine:rules-update-entries), beyond engine:rules-update's stat dice and
// new pick: an option of an archetype pick removed, a table row's range
// moved, an item's availability or category changed, a talent's effects
// changed, an entry deleted, an effect id renamed, the archetype renamed, a
// subtype removed. For each: diff() names what changes, updateRules() at
// random makes a whole character (no open choices, a record that replays),
// and nothing throws but the documented BuildError (a subtype or archetype
// that is gone).
import * as ops from "../../../src/client/builder/ops.ts";
import { buildAll as build } from "../../../src/shared/engine/companions.ts";
import { BuildError, type BuildResult } from "../../../src/shared/engine/build.ts";
import { diff, type CharacterDiff } from "../../../src/shared/engine/diff.ts";
import type { CharacterRecord } from "../../../src/shared/engine/record.ts";
import { seededRoller } from "../../../src/shared/engine/rng.ts";
import type { Compendium } from "../../../src/shared/rules/compendium.ts";
import type { Archetype, Effect, Option } from "../../../src/shared/rules/schema.ts";
import type { Report, Repro } from "../lib/report.ts";
import { archetypeIds, realCompendium } from "../lib/rules.ts";
import type { RunOptions } from "../shards.ts";
import { norm, ownedAll, randomBuild } from "./archetype.ts";

const THROW = () => {
  throw new Error("rolled a die the record should have had");
};

type MapKey = "archetypes" | "talents" | "exotics" | "mutations" | "powers" | "items" | "tables" | "rules";
/** The compendium with one entry replaced (or deleted: null), as new maps (the engine caches per map). */
function withEntry<T extends { id: string }>(c: Compendium, map: MapKey, id: string, e: T | null): Compendium {
  const m = new Map(c[map] as Map<string, unknown>);
  if (e) m.set(id, e);
  else m.delete(id);
  return { ...c, [map]: m } as Compendium;
}

type Change = { name: string; make(c: Compendium, b: BuildResult): { nc: Compendium; expect(d: CharacterDiff, b: BuildResult): string | null } | null; throws?: boolean };

let refCache: WeakMap<Compendium, Set<string>> = new WeakMap();
/** Ids any effect names outright (grants, `as`, `set` targets…): deleting one leaves a dangling reference. */
function referenced(c: Compendium): Set<string> {
  let s = refCache.get(c);
  if (s) return s;
  s = new Set();
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
      if (typeof v === "string" && ["item", "talent", "exotic", "mutation", "power", "as", "into", "roll"].includes(k)) s!.add(v);
      else if (Array.isArray(v) && ["only", "except", "tag", "exclude"].includes(k)) v.forEach((y) => typeof y === "string" && s!.add(y));
      else visit(v);
    }
  };
  for (const m of [c.archetypes, c.talents, c.exotics, c.mutations, c.powers, c.items, c.tables, c.rules]) for (const e of m.values()) visit(e);
  refCache.set(c, s);
  return s;
}

const firstPick = (a: Archetype, b: BuildResult) => {
  for (const s of a.sections)
    for (const e of s.effects) {
      if (!("pick" in e) || !e.from || !("id" in e)) continue;
      const chosen = b.record.choices[`${a.id}/${e.id}`];
      const named = e.from.filter((o): o is Option => "name" in o && "id" in o && !("stat" in o));
      if (named.length >= 2 && chosen?.length) return { e, chosen, named };
    }
  return null;
};

const CHANGES: Change[] = [
  {
    name: "the option chosen removed from an archetype pick",
    make: (c, b) => {
      const a = structuredClone(c.archetypes.get(b.record.archetype)!);
      const p = firstPick(a, b);
      if (!p) return null;
      p.e.from = p.e.from!.filter((o) => !("id" in o && o.id === p.chosen[0]));
      return { nc: withEntry(c, "archetypes", a.id, a), expect: (d) => (d.options.lost.some((o) => o.id === p.chosen[0]) || d.pending.length || d.dropped.length ? null : `${p.chosen[0]} removed, diff names nothing`) };
    },
  },
  {
    name: "a table row the character rolled moved (its range given to a row it didn't roll)",
    make: (c, b) => {
      // (a roll whose dice the record holds: a power chosen among a table's isn't rolled on it)
      // Swapped with a row the character also rolled, it would be the same character (diff compares rolls as a multiset).
      const rolled = (table: string) => new Set(b.character.rolls.filter((x) => x.table === table).map((x) => x.label));
      const other = (table: string, label: string) => {
        const rows = c.tables.get(table)!.rows;
        const i = rows.findIndex((x) => x.label === label);
        const not = (k: number) => k >= 0 && k < rows.length && !rolled(table).has(rows[k].label);
        return [i + 1, i - 1, ...rows.keys()].find(not) ?? -1;
      };
      const roll = b.character.rolls.find((x) => c.tables.get(x.table)?.rows.length! > 2 && !x.table.startsWith("equipment-generator") && b.record.dice[x.key] && other(x.table, x.label) >= 0);
      if (!roll) return null;
      const t = structuredClone(c.tables.get(roll.table)!);
      const i = t.rows.findIndex((x) => x.label === roll.label);
      const j = other(roll.table, roll.label);
      [t.rows[i].range, t.rows[j].range, t.rows[i].ranges, t.rows[j].ranges] = [t.rows[j].range, t.rows[i].range, t.rows[j].ranges, t.rows[i].ranges];
      return { nc: withEntry(c, "tables", t.id, t), expect: (d) => (d.changed ? null : `${t.id} rows ${t.rows[i].label} and ${t.rows[j].label} swapped ranges, diff says unchanged`) };
    },
  },
  {
    name: "a generated item's availability changed",
    make: (c, b) => {
      const it = b.character.items.find((x) => x.from.some((f) => f.key?.endsWith(":item")) && c.items.get(x.id)?.availability === "Rare");
      if (!it) return null;
      const e = { ...structuredClone(c.items.get(it.id)!), availability: "Legendary" as const };
      return { nc: withEntry(c, "items", it.id, e), expect: (d) => (d.changed ? null : `${it.id} made Legendary, diff says unchanged`) };
    },
  },
  {
    name: "a generated item's category changed",
    make: (c, b) => {
      const it = b.character.items.find((x) => x.from.some((f) => f.key?.endsWith(":item")) && c.items.get(x.id)?.category);
      if (!it) return null;
      const e = { ...structuredClone(c.items.get(it.id)!), category: it.id.length % 2 ? "Miscellaneous" : "Pistol" };
      if (e.category === c.items.get(it.id)!.category) e.category = "Heavy weapon";
      return { nc: withEntry(c, "items", it.id, e), expect: (d) => (d.changed ? null : `${it.id} moved to ${e.category}, diff says unchanged`) };
    },
  },
  {
    name: "a talent's effects changed (+5 WS)",
    make: (c, b) => {
      const t = b.character.talents.find((x) => !x.overridden);
      if (!t) return null;
      const e = structuredClone(c.talents.get(t.id)!);
      e.effects = [...(e.effects ?? []), { stat: "WS", add: 5 } as Effect];
      return { nc: withEntry(c, "talents", t.id, e), expect: (d, b0) => (d.stats.some((s) => s.stat === "WS" && s.to === s.from + 5) || b0.character.stats.WS.caps.length || b0.character.stats.WS.overridden || b0.character.stats.WS.mods.some((m) => m.set !== undefined) ? null : `${t.id} +5 WS, diff stats ${JSON.stringify(d.stats)}`) };
    },
  },
  {
    name: "an owned item deleted (one no other entry names: rules:check refuses a dangling reference)",
    make: (c, b) => {
      const named = referenced(c);
      const it = b.character.items.find((x) => !x.overridden && x.from.some((f) => f.key) && !named.has(x.id));
      if (!it) return null;
      return { nc: withEntry(c, "items", it.id, null), expect: (d) => (d.lost.some((x) => x.id === it.id) ? null : `${it.id} deleted, diff lost ${JSON.stringify(d.lost)}`) };
    },
  },
  {
    name: "a pick's effect id renamed",
    make: (c, b) => {
      const a = structuredClone(c.archetypes.get(b.record.archetype)!);
      const p = firstPick(a, b);
      if (!p) return null;
      const old = `${a.id}/${p.e.id}`;
      p.e.id = `${p.e.id}-e2e`;
      return { nc: withEntry(c, "archetypes", a.id, a), expect: (d) => (d.dropped.includes(old) && d.pending.some((x) => x.key === `${a.id}/${p.e.id}`) ? null : `${old} renamed: dropped ${JSON.stringify(d.dropped)}, pending ${d.pending.map((x) => x.key)}`) };
    },
  },
  {
    name: "the archetype renamed",
    make: (c, b) => {
      const a = { ...structuredClone(c.archetypes.get(b.record.archetype)!), name: "E2E Renamed" };
      return { nc: withEntry(c, "archetypes", a.id, a), expect: (d) => (d.gained.length || d.lost.length || d.stats.length || d.pending.length ? `a name change changes the character: ${JSON.stringify(d).slice(0, 200)}` : null) };
    },
  },
  {
    name: "the character's subtype removed",
    throws: true,
    make: (c, b) => {
      const a = structuredClone(c.archetypes.get(b.record.archetype)!);
      if (a.subtypes.length < 2) return null;
      a.subtypes = a.subtypes.filter((s) => s.id !== b.record.subtype);
      return { nc: withEntry(c, "archetypes", a.id, a), expect: () => null };
    },
  },
];

export async function engineRulesEntries(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  const seeds = Math.max(2, Math.min(o.fewSeeds, 8));
  for (const archId of archetypeIds()) {
    const arch = c.archetypes.get(archId)!;
    for (const sub of arch.subtypes) {
      for (let seed = 1; seed <= seeds; seed++) {
        const b = randomBuild(c, archId, sub.id, seed);
        for (const ch of CHANGES) {
          const made = ch.make(c, b);
          if (!made) continue;
          const rep: Repro = { archetype: archId, subtype: sub.id, seed, record: b.record, steps: [`random build seededRoller(${seed})`, `rules: ${ch.name}`, "diff(), updateRules(randomChoices: true)"] };
          let d: CharacterDiff;
          try {
            d = diff(c, made.nc, b.record);
          } catch (e) {
            if (ch.throws && e instanceof BuildError) r.pass("a gone subtype is a BuildError (documented)");
            else r.fail("diff doesn't throw", String((e as Error).stack ?? e).slice(0, 600), rep, `${ch.name}: ${(e as Error).message}`);
            continue;
          }
          if (ch.throws) {
            r.fail("a gone subtype is a BuildError (documented)", "diff gave an answer", rep, ch.name);
            continue;
          }
          const why = made.expect(d, b);
          r.expect(!why, "diff names the rules change", why ?? "", rep, `${ch.name}`);
          let up: CharacterRecord;
          try {
            up = ops.updateRules(made.nc, b.record, "e2e-v2", true, seededRoller(8_500_000 + seed));
          } catch (e) {
            r.fail("an update doesn't throw", String((e as Error).stack ?? e).slice(0, 600), rep, `${ch.name}: ${(e as Error).message}`);
            continue;
          }
          let nb: BuildResult;
          try {
            nb = build(made.nc, up, { mode: "freeform", roll: THROW });
            r.pass("the updated record replays without rolling");
          } catch (e) {
            r.fail("the updated record replays without rolling", String((e as Error).message), { ...rep, record: up }, `${archId}: ${ch.name}`);
            continue;
          }
          r.expect(!nb.pending.length, "an update at random leaves no open choices", nb.pending.map((p) => p.key).join(", "), { ...rep, record: up }, `${ch.name}: ${nb.pending.map((p) => norm(p.key)).join(", ")}`);
          // A second update to the same rules changes nothing.
          try {
            const again = ops.updateRules(made.nc, up, "e2e-v3", true, THROW);
            r.expect(JSON.stringify({ ...again, rulesVersion: 0 }) === JSON.stringify({ ...up, rulesVersion: 0 }), "an update is done once", "a second update to the same rules changed the record", { ...rep, record: up }, ch.name);
          } catch (e) {
            r.fail("an update is done once", `a second update to the same rules: ${(e as Error).message}`, { ...rep, record: up }, ch.name);
          }
          // What a deleted entry was is gone; nothing unknown left.
          for (const w of nb.warnings) if (/unknown|no table|no "/.test(w)) r.fail("an updated character refers to nothing missing", w, { ...rep, record: up }, `${ch.name}: ${norm(w)}`);
          void ownedAll;
        }
      }
    }
  }
}
