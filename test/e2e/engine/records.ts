// Records the other shards never make (each a shard):
// - engine:packs: characters built with fewer packs than the app serves
//   (only the book, `loyalist`): whole characters with nothing from another
//   pack; brought up to every pack (a rules update adding packs) they stay
//   the same character, except where an added pack replaces an entry the
//   character uses (the article's version of the book's entry).
// - engine:subtype-roll: a subtype chosen by a roll ("Roll a D10 … 1-3
//   Rookie, 4-8 Tracker, 9-0 Hunter"): rollSubtype() is distributed as the
//   ranges say; a record holding the roll builds and replays; re-rolling the
//   roll gives the subtype it lands on, distributed as a fresh roll, with no
//   decisions of the other subtype left in the record.
import * as ops from "../../../src/client/builder/ops.ts";
import { build, rollSubtype, subtypeFor, subtypeKey, type BuildResult } from "../../../src/shared/engine/build.ts";
import { diff } from "../../../src/shared/engine/diff.ts";
import { newRecord } from "../../../src/shared/engine/record.ts";
import { seededRoller } from "../../../src/shared/engine/rng.ts";
import { loadAllPacks } from "../../../src/lib/rules-files.ts";
import { buildCompendium, withoutHidden, type Compendium } from "../../../src/shared/rules/compendium.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium, RULES } from "../lib/rules.ts";
import { chiFit } from "../lib/stats.ts";
import type { RunOptions } from "../shards.ts";
import { checkCharacter, checkReplay, explainWarning, firstDiff, gearPolicies, norm, openPickBounds, ownedAll, replay } from "./archetype.ts";

const THROW = () => {
  throw new Error("rolled a die the record should have had");
};

/** The book alone (and its hidden entries left out, as the server serves it). */
function packsCompendium(ids: string[]): Compendium {
  return buildCompendium(withoutHidden(loadAllPacks(RULES)).filter((p) => ids.includes(p.pack.id)));
}

export async function enginePacks(r: Report, o: RunOptions): Promise<void> {
  const full = realCompendium();
  const book = packsCompendium(["loyalist"]);
  const bounds = openPickBounds(book);
  const seeds = Math.max(3, Math.min(o.fewSeeds, 8));
  for (const arch of [...book.archetypes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const gear = gearPolicies(arch);
    for (const sub of arch.subtypes) {
      for (let seed = 1; seed <= seeds; seed++) {
        const rec = newRecord(["loyalist"], arch.id, sub.id);
        const rep: Repro = { archetype: arch.id, subtype: sub.id, seed, steps: ["a compendium of the loyalist pack only", `random build seededRoller(${seed}) with packs [loyalist]`] };
        let b: BuildResult;
        try {
          b = build(book, rec, { mode: "random", roll: seededRoller(seed) });
        } catch (e) {
          r.fail("a book-only build doesn't throw", String((e as Error).stack ?? e), rep, (e as Error).message);
          continue;
        }
        const brep = { ...rep, record: b.record };
        checkCharacter(r, book, arch, b, brep, "book-only random build", bounds, gear);
        checkReplay(r, book, b, brep);
        r.expect(JSON.stringify(b.record.packs) === '["loyalist"]', "a book-only record keeps its packs", JSON.stringify(b.record.packs), brep);
        // Nothing from another pack.
        for (const t of ownedAll(b.character)) {
          const from = book.origin.get(`${t.kind}/${t.id}`);
          r.expect(from === "loyalist", "a book-only character has nothing from another pack", `${t.kind} ${t.id} from ${from}`, brep, `${t.kind}/${t.id}`);
        }
        // Every pack added: the same character, unless an added pack replaces an entry it uses.
        const replaced = (kind: string, id: string) => full.origin.get(`${kind}/${id}`) !== "loyalist";
        const uses = [
          ["archetype", arch.id],
          ...ownedAll(b.character).map((t) => [t.kind, t.id]),
          ...b.character.rolls.map((x) => ["table", x.table]),
          ...[...book.rules.keys()].map((id) => ["rule", id]),
        ] as [string, string][];
        const touched = uses.filter(([k, id]) => replaced(k, id));
        const urep = { ...brep, steps: [...rep.steps!, "updateRules(every pack, randomChoices: true)"] };
        try {
          const up = ops.updateRules(full, b.record, "e2e-all-packs", true, seededRoller(9_100_000 + seed));
          r.expect(JSON.stringify(up.packs) === JSON.stringify(full.packs.map((p) => p.id)), "an update to more packs records them", JSON.stringify(up.packs), urep);
          const nb = replay(r, full, up, { ...urep, record: up }, "update to every pack");
          r.expect(!nb.pending.length, "an update to more packs leaves no open choices", nb.pending.map((p) => p.key).join(", "), { ...urep, record: up }, nb.pending.map((p) => norm(p.key)).join(", "));
          const d = diff(book, full, b.record);
          if (!touched.length) {
            const same = firstDiff({ ...b.character, warnings: [] }, { ...nb.character, warnings: [] });
            r.expect(!same, "packs added change nothing they don't replace", `${same}`, { ...urep, record: up }, `${arch.id}: ${same.split(":")[0]}`);
            r.expect(!d.changed || (!d.gained.length && !d.lost.length && !d.stats.length), "diff for packs added names nothing they don't replace", JSON.stringify(d).slice(0, 300), urep, arch.id);
          } else r.note(`${arch.id}: packs added replace ${touched.map((x) => x.join("/")).slice(0, 6).join(", ")}${touched.length > 6 ? "…" : ""}: the update may change it`);
        } catch (e) {
          r.fail("an update to more packs doesn't throw", String((e as Error).stack ?? e).slice(0, 800), urep, (e as Error).message);
        }
      }
    }
  }
}

export async function engineSubtypeRoll(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  const rolled = [...c.archetypes.values()].filter((a) => a.subtypeDie);
  r.expect(rolled.length > 0, "an archetype rolls its subtype", "none", {});
  for (const arch of rolled) {
    const bounds = openPickBounds(c);
    const gear = gearPolicies(arch);
    // The ranges cover the die, once each.
    const die = Number(/D(\d+)/.exec(String(arch.subtypeDie))?.[1] ?? 0);
    for (let t = 1; t <= die; t++) {
      const n = arch.subtypes.filter((s) => s.range && t >= s.range[0] && t <= s.range[1]).length;
      r.expect(n === 1, "a subtype roll's ranges cover each face once", `${arch.id}: ${t} gives ${n} subtypes`, { archetype: arch.id }, `${arch.id} ${t}`);
    }
    // rollSubtype() as the ranges say.
    const xs: string[] = [];
    const roll = seededRoller(1);
    for (let i = 0; i < 3000; i++) xs.push(rollSubtype(arch, roll).subtype?.id ?? "none");
    const want = Object.fromEntries(arch.subtypes.filter((s) => s.range).map((s) => [s.id, s.range![1] - s.range![0] + 1]));
    const fit = chiFit(xs, want);
    r.expect(!(fit.p < 1e-6), "the subtype roll is distributed as its ranges", `${arch.id}: ${Object.keys(want).map((k) => `${k} ${xs.filter((x) => x === k).length}`).join(", ")} of 3000; χ² ${fit.chi2.toFixed(1)}`, { archetype: arch.id });
    // Records holding the roll.
    const fresh: string[] = [];
    const again: string[] = [];
    for (let seed = 1; seed <= Math.min(o.rerollSeeds, 120); seed++) {
      const s = rollSubtype(arch, seededRoller(seed));
      if (!s.subtype) continue;
      const rec = newRecord(c.packs.map((p) => p.id), arch.id, s.subtype.id);
      rec.dice[s.key] = s.faces;
      const rep: Repro = { archetype: arch.id, subtype: s.subtype.id, seed, steps: [`rollSubtype(seededRoller(${seed})) → ${s.subtype.id}`, `random build seededRoller(${seed})`] };
      const b = build(c, rec, { mode: "random", roll: seededRoller(seed) });
      fresh.push(s.subtype.id);
      checkCharacter(r, c, arch, b, { ...rep, record: b.record }, "a rolled subtype's random build", bounds, gear);
      checkReplay(r, c, b, { ...rep, record: b.record });
      r.expect(JSON.stringify(b.record.dice[s.key]) === JSON.stringify(s.faces), "a rolled subtype keeps its roll", JSON.stringify(b.record.dice[s.key]), { ...rep, record: b.record });
      // The roll re-rolled (the Rolls panel's die): the subtype it lands on.
      const k = subtypeKey(arch);
      let next;
      try {
        next = ops.rerollDecision(c, b.record, [k], { roll: seededRoller(1_000_000 + seed) });
      } catch (e) {
        r.fail("re-rolling the subtype roll doesn't throw", String((e as Error).stack ?? e).slice(0, 600), { ...rep, record: b.record, key: k }, (e as Error).message);
        continue;
      }
      const nb = build(c, next, { mode: "freeform", roll: THROW });
      const lands = subtypeFor(arch, (next.dice[k] ?? []).reduce((x, y) => x + y, 0));
      again.push(next.subtype);
      const rrep = { ...rep, key: k, record: next, steps: [...rep.steps!, `rerollDecision([${JSON.stringify(k)}])`] };
      r.expect(!!lands && next.subtype === lands.id, "re-rolling the subtype roll gives the subtype it lands on", next.dice[k] ? `rolled ${JSON.stringify(next.dice[k])} (${lands?.id}), the record is ${next.subtype}` : `the roll is gone from the record (was ${JSON.stringify(b.record.dice[k])}); the subtype stays ${next.subtype}`, rrep, arch.id);
      for (const w of nb.warnings) if (!explainWarning(c, nb, w)) r.fail("re-rolling the subtype roll leaves no warnings", w, rrep, norm(w));
      if (lands && lands.id !== b.record.subtype) {
        // Nothing of the other subtype's stat line kept: its stat dice rolled again for the new line.
        const statDice = Object.keys(b.record.dice).filter((x) => x.includes("/@stats:"));
        const kept = statDice.filter((x) => JSON.stringify(next.dice[x]) === JSON.stringify(b.record.dice[x]) && arch.subtypes.find((sb) => sb.id === b.record.subtype)?.stats !== lands.stats);
        r.note(`${arch.id}: a subtype re-roll from ${b.record.subtype} to ${lands.id} kept ${kept.length} of ${statDice.length} stat dice`);
      }
    }
    if (again.length >= 30) {
      const fit2 = chiFit(again, want);
      r.expect(!(fit2.p < 1e-6), "re-rolled subtypes are distributed as the roll", `${arch.id}: ${Object.keys(want).map((k) => `${k} ${again.filter((x) => x === k).length}`).join(", ")} of ${again.length}`, { archetype: arch.id });
    }
    void fresh;
  }
  // The New character form makes the subtype by hand, never by this roll: a note for the owner.
  r.note("the New character form chooses an Alien Bounty Hunter's Level of Experience in its Subtype dropdown; rollSubtype() is used nowhere in src/client");
}
