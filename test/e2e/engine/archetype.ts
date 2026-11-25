// The engine against the real rules, one archetype (every subtype), many
// seeds: what a random character must be (no open choices, no warnings,
// legal choices, the book's counts, no broken restrictions, everything on
// the GM sheet), that its record replays exactly, and that every other way
// the builder makes a choice at random (re-rolling a decision, "choose at
// random" on a freeform character, a rules update that needs new
// decisions) makes characters distributed as a fresh random one. Then the
// Occupation dropdowns, overrides and the Word export.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { renderSheetDocx } from "../../../src/client/export/docx.ts";
import * as ops from "../../../src/client/builder/ops.ts";
import { powerScore } from "../../../src/shared/engine/balance.ts";
import { build, ROLL_OPTION, type BuildResult, type Character, type RollFn } from "../../../src/shared/engine/build.ts";
import * as dice from "../../../src/shared/engine/dice.ts";
import { diff } from "../../../src/shared/engine/diff.ts";
import { cloneRecord, newRecord, parseRecord, THING_KINDS, type CharacterRecord, type ThingKind } from "../../../src/shared/engine/record.ts";
import { isUnder, reroll } from "../../../src/shared/engine/reroll.ts";
import { seededRoller } from "../../../src/shared/engine/rng.ts";
import { effectLists, walkEffects, type Compendium } from "../../../src/shared/rules/compendium.ts";
import { ALIGNMENTS, STATS, type Archetype, type Effect, type Stat } from "../../../src/shared/rules/schema.ts";
import { toSheetCharacter } from "../../../src/shared/sheet-map.ts";
import { Report, type Repro } from "../lib/report.ts";
import { archetype, realCompendium, ROOT } from "../lib/rules.ts";
import { differ, fmt } from "../lib/stats.ts";
import { docxText, unzipEntry } from "../lib/zip.ts";
import { bookChecks } from "./book.ts";

export type EngineOptions = { seeds: number; rerollSeeds: number; fewSeeds: number };

const THROW: RollFn = () => {
  throw new Error("rolled a die the record should have had");
};
const packsOf = (c: Compendium) => c.packs.map((p) => p.id);
export const freshRecord = (c: Compendium, a: string, s: string): CharacterRecord => newRecord(packsOf(c), a, s);
export const randomBuild = (c: Compendium, a: string, s: string, seed: number): BuildResult => build(c, freshRecord(c, a, s), { mode: "random", roll: seededRoller(seed) });

/** What a character is, in numbers, for comparing how two ways of making it are distributed. */
function metrics(b: BuildResult, c: Compendium): Record<string, number> {
  const ch = b.character;
  return {
    items: ch.items.reduce((n, i) => n + i.qty, 0),
    "distinct items": ch.items.length,
    talents: ch.talents.length,
    exotics: ch.exotics.length,
    mutations: ch.mutations.length,
    powers: ch.powers.length,
    options: ch.options.length,
    "stat total": STATS.reduce((n, s) => n + ch.stats[s].final, 0),
    "power score": powerScore(ch, c),
    decisions: b.log.length,
  };
}

/** Whether decision `k` depends on any of `keys`: nested under one, or its parent chain leads to one. */
function dependsOn(b: BuildResult, keys: string[]): (k: string) => boolean {
  const parent = new Map(b.log.map((e) => [e.key, e.parent]));
  return (k: string) => {
    for (let p: string | undefined = k, i = 0; p && i < 64; p = parent.get(p), i++) if (keys.some((key) => p === key || isUnder(p!, key))) return true;
    return false;
  };
}

/** Every decision under `key`: nested keys and those whose parent chain leads to it. */
function under(b: BuildResult, key: string): number {
  const leads = dependsOn(b, [key]);
  return [...Object.keys(b.record.dice), ...Object.keys(b.record.choices)].filter((k) => k !== key && leads(k)).length;
}

const ownedAll = (ch: Character) => [...ch.talents, ...ch.exotics, ...ch.mutations, ...ch.powers, ...ch.items];
const thingKey = (t: { kind: string; id: string }) => `${t.kind}/${t.id}`;
const norm = (w: string) => [...new Set(w.replace(/#\d+|~\d+|\*\d+/g, "#N").replace(/\d+/g, "N").split(", "))].join(", ");

/** Open picks of every entry, by "<entry>/<effect id>": the most a random character takes. */
function openPickBounds(c: Compendium): Map<string, { most: number; kind: "any" | "max"; random?: string }> {
  const out = new Map<string, { most: number; kind: "any" | "max"; random?: string }>();
  const entries = [...c.archetypes.values(), ...c.talents.values(), ...c.exotics.values(), ...c.mutations.values(), ...c.powers.values(), ...c.items.values(), ...c.tables.values(), ...c.rules.values()];
  for (const e of entries) {
    for (const { effects } of effectLists(e)) {
      walkEffects(effects, (x) => {
        if (!("pick" in x) || !("id" in x) || !x.id) return;
        const p = x.pick as unknown;
        const random = (x as { random?: string | number }).random;
        if (p === "any") out.set(`${e.id}/${x.id}`, { kind: "any", most: random === undefined ? 0 : dice.max(random as string), random: random === undefined ? undefined : String(random) });
        else if (p && typeof p === "object" && "max" in (p as object)) {
          const n = (p as { max: number }).max;
          out.set(`${e.id}/${x.id}`, { kind: "max", most: random === undefined ? n : Math.min(n, dice.max(random as string)), random: random === undefined ? undefined : String(random) });
        }
      });
    }
  }
  return out;
}

/** The entry/effect a key ends in ("a/b#2>table/row>item/mount*2" → "item/mount"). */
const leafOf = (key: string): string => key.split(">").pop()!.replace(/(\*\d+|#\d+|~\d+)+$/, "");

/** The gear effects of an archetype, by key prefix: their alien policy. */
function gearPolicies(a: Archetype): Map<string, Effect & { gear: unknown }> {
  const out = new Map<string, Effect & { gear: unknown }>();
  for (const { effects } of effectLists(a)) walkEffects(effects, (x) => void ("gear" in x && "id" in x && x.id && out.set(`${a.id}/${x.id}`, x as Effect & { gear: unknown })));
  return out;
}

const UI_STATS = /\/@stats:/;
const BOON = /^(.*\/boons)(#\d+|:count)$/;

/** The decision groups the builder's buttons re-roll: each top-level key, the Stats "Reroll" (all stat dice) and the Boons "Reroll". */
function rerollGroups(b: BuildResult): { name: string; keys: string[] }[] {
  const out: { name: string; keys: string[] }[] = [];
  const top = b.log.filter((e) => !e.parent && !e.eachGame).map((e) => e.key);
  for (const k of [...new Set(top)]) out.push({ name: k, keys: [k] });
  const stats = b.log.filter((e) => e.type === "dice" && UI_STATS.test(e.key)).map((e) => e.key);
  if (stats.length) out.push({ name: "Stats: Reroll", keys: stats });
  const boons = b.log.filter((e) => BOON.test(e.key.split(">")[0])).map((e) => e.key).filter((k) => !k.includes(">"));
  if (boons.length) out.push({ name: "Boons: Reroll", keys: boons });
  return out;
}

export async function engineArchetype(r: Report, archId: string, o: EngineOptions): Promise<void> {
  const c = realCompendium();
  const arch = archetype(archId);
  const bounds = openPickBounds(c);
  const gear = gearPolicies(arch);
  const template = readFileSync(join(ROOT, "src/client/export/sheet-template.docx"));

  for (const sub of arch.subtypes) {
    const base: Repro = { archetype: archId, subtype: sub.id };
    const fresh: BuildResult[] = [];
    const t0 = Date.now();

    // --- fresh random characters -------------------------------------------------
    for (let seed = 1; seed <= o.seeds; seed++) {
      let b: BuildResult;
      try {
        b = randomBuild(c, archId, sub.id, seed);
      } catch (e) {
        r.fail("random build doesn't throw", String((e as Error).stack ?? e), { ...base, seed }, String((e as Error).message));
        continue;
      }
      fresh.push(b);
      const rep: Repro = { ...base, seed, record: b.record };
      checkCharacter(r, c, arch, b, rep, "random build", bounds, gear, true);
      checkReplay(r, c, b, rep);
      if (seed <= o.fewSeeds) checkChoicesLegal(r, c, b, rep, "random build");
      for (const f of bookChecks[archId]?.(b, c) ?? []) r.fail(`book: ${f.check}`, f.message, rep, f.signature ?? f.message);
      if (bookChecks[archId]) r.pass("book rules hold");
    }
    r.note(`${archId}/${sub.id}: ${fresh.length} random builds in ${Date.now() - t0} ms`);
    if (!fresh.length) continue;

    // Open picks: a random character takes none of "any" and 0..N of "up to N", spread evenly.
    checkOpenPickDistribution(r, fresh, bounds, base);

    const freshMetrics = fresh.map((b) => metrics(b, c));

    // --- re-rolling each decision (as the Rolls panel's dice, Stats' and Boons' Reroll) -------
    const t1 = Date.now();
    const byGroup = new Map<string, { fresh: Record<string, number>[]; again: Record<string, number>[]; own: [number[], number[]]; nested: [number[], number[]] }>();
    for (let i = 0; i < Math.min(o.rerollSeeds, fresh.length); i++) {
      const b = fresh[i];
      const seed = i + 1;
      for (const g of rerollGroups(b)) {
        let next: CharacterRecord;
        const rep: Repro = { ...base, seed, key: g.keys.join(" "), record: b.record, steps: [`random build, seededRoller(${seed})`, `rerollDecision(${JSON.stringify(g.keys)}) with seededRoller(${1_000_000 + seed})`] };
        try {
          next = ops.rerollDecision(c, b.record, g.keys, { roll: seededRoller(1_000_000 + seed) });
        } catch (e) {
          r.fail("re-roll doesn't throw", String((e as Error).stack ?? e), rep, `${g.name.replace(/#\d+/g, "#N")}: ${(e as Error).message}`);
          continue;
        }
        const nb = replay(r, c, next, { ...rep, record: next }, "re-roll");
        checkCharacter(r, c, arch, nb, { ...rep, record: next }, "after re-roll", bounds, gear, false);
        // The dice re-rolled are rolled again (the decision still applies: what led to it is kept).
        for (const k of g.keys.length === 1 ? g.keys : []) {
          if (!(k in b.record.dice)) continue;
          r.expect(k in next.dice, "re-roll rolls the dice again", `${k} is gone from the record after re-rolling it (was ${JSON.stringify(b.record.dice[k])})`, rep, norm(k));
        }
        // Re-rolling a decision keeps every other one.
        const dependent = dependsOn(b, g.keys);
        for (const [k, v] of Object.entries(b.record.dice)) {
          if (dependent(k)) continue;
          if (k in next.dice && !isDeepStrictEqual(next.dice[k], v)) {
            r.fail("re-roll keeps the other dice", `${k} changed from ${JSON.stringify(v)} to ${JSON.stringify(next.dice[k])}`, rep, `${norm(g.name)} changes ${norm(k)}`);
          }
        }
        const group = norm(g.name);
        const acc = byGroup.get(group) ?? { fresh: [], again: [], own: [[], []], nested: [[], []] };
        byGroup.set(group, acc);
        acc.fresh.push(freshMetrics[i]);
        acc.again.push(metrics(nb, c));
        if (g.keys.length === 1) {
          const k = g.keys[0];
          acc.own[0].push(b.record.choices[k]?.length ?? 0);
          acc.own[1].push(nb.record.choices[k]?.length ?? 0);
          acc.nested[0].push(under(b, k));
          acc.nested[1].push(under(nb, k));
        }
      }
    }
    for (const [group, acc] of byGroup) {
      compare(r, "re-roll is distributed as a fresh random character", `${sub.id}: re-roll ${group}`, acc.fresh, acc.again, base);
      if (acc.own[0].length) {
        compareOne(r, "re-roll is distributed as a fresh random character", `${sub.id}: re-roll ${group}`, "options chosen", acc.own[0], acc.own[1], base);
        compareOne(r, "re-roll is distributed as a fresh random character", `${sub.id}: re-roll ${group}`, "decisions under it", acc.nested[0], acc.nested[1], base);
      }
    }
    r.note(`${archId}/${sub.id}: re-rolls in ${Date.now() - t1} ms`);

    // --- freeform, then "choose at random" (every open choice, then one at a time) ----------
    const filled: Record<string, number>[] = [];
    for (let i = 0; i < Math.min(o.rerollSeeds, fresh.length); i++) {
      const seed = i + 1;
      const steps = [`ops.create(freeform) with seededRoller(${seed})`];
      let rec: CharacterRecord;
      try {
        rec = ops.create(c, archId, sub.id, "freeform", { roll: seededRoller(seed) });
      } catch (e) {
        r.fail("freeform create doesn't throw", String(e), { ...base, seed, steps }, String((e as Error).message));
        continue;
      }
      let next: CharacterRecord;
      try {
        next = ops.fillPending(c, rec, { roll: seededRoller(2_000_000 + seed) });
      } catch (e) {
        r.fail("choose at random doesn't throw", String(e), { ...base, seed, record: rec, steps }, String((e as Error).message));
        continue;
      }
      const nb = replay(r, c, next, { ...base, seed, record: next, steps }, "choose at random");
      checkCharacter(r, c, arch, nb, { ...base, seed, record: next, steps: [...steps, `fillPending() with seededRoller(${2_000_000 + seed})`] }, "after choose at random", bounds, gear, true);
      filled.push(metrics(nb, c));

      // One open choice at a time (the dice beside each): only that one is made (and what it opens).
      if (i < o.fewSeeds) {
        const v = ops.view(c, rec);
        for (const p of v.pending.filter((x) => !x.parent)) {
          const one = ops.fillPending(c, rec, { keys: [p.key], roll: seededRoller(3_000_000 + seed) });
          const after = ops.view(c, one);
          const rep: Repro = { ...base, seed, key: p.key, record: rec, steps: [...steps, `fillPending({ keys: [${JSON.stringify(p.key)}] })`] };
          r.expect(!after.pending.some((x) => x.key === p.key), "choose at random (one) makes that choice", `${p.key} still open`, rep, norm(p.key));
          const others = v.pending.filter((x) => x.key !== p.key && !x.parent && !isUnder(x.key, p.key)).map((x) => x.key);
          const madeOthers = others.filter((k) => !after.pending.some((x) => x.key === k) && after.log.some((e) => e.key === k));
          r.expect(madeOthers.length === 0, "choose at random (one) leaves the others open", `made ${madeOthers.join(", ")} too`, rep, `${norm(p.key)} → ${madeOthers.map(norm).join(", ")}`);
        }
      }
    }
    compare(r, "choose at random is distributed as a fresh random character", `${sub.id}: freeform + choose at random`, freshMetrics.slice(0, filled.length), filled, base);

    // --- rules updates --------------------------------------------------------------
    for (let i = 0; i < Math.min(o.fewSeeds, fresh.length); i++) {
      const b = fresh[i];
      const rep: Repro = { ...base, seed: i + 1, record: b.record };
      // Unchanged rules: nothing changes.
      const same = ops.updateRules(c, b.record, "e2e-next", true, seededRoller(7_000_000 + i));
      const { rulesVersion: _v, ...rest } = same;
      r.expect(isDeepStrictEqual(rest, { ...b.record }), "update to unchanged rules keeps the record", "record changed", rep);
      r.expect(!diff(c, c, b.record).changed, "diff against the same rules is empty", JSON.stringify(diff(c, c, b.record)).slice(0, 400), rep);
    }
    // New rules that need decisions this record lacks (as if the rules added them): made as a fresh character's.
    const upd = new Map<string, { fresh: Record<string, number>[]; again: Record<string, number>[] }>();
    for (let i = 0; i < Math.min(Math.ceil(o.rerollSeeds / 2), fresh.length); i++) {
      const b = fresh[i];
      for (const e of b.log.filter((x) => !x.parent && x.type === "choice")) {
        const cleared = reroll(c, b.record, e.key);
        const rep: Repro = { ...base, seed: i + 1, key: e.key, record: cleared, steps: [`updateRules(record without ${e.key}, randomChoices: true) with seededRoller(${4_000_000 + i})`] };
        let next: CharacterRecord;
        try {
          next = ops.updateRules(c, cleared, "e2e-next", true, seededRoller(4_000_000 + i));
        } catch (err) {
          r.fail("rules update doesn't throw", String(err), rep, (err as Error).message);
          continue;
        }
        const nb = replay(r, c, next, { ...rep, record: next }, "rules update");
        checkCharacter(r, c, arch, nb, { ...rep, record: next }, "after rules update", bounds, gear, true);
        const acc = upd.get(norm(e.key)) ?? { fresh: [], again: [] };
        upd.set(norm(e.key), acc);
        acc.fresh.push(metrics(b, c));
        acc.again.push(metrics(nb, c));
      }
    }
    for (const [k, acc] of upd) compare(r, "rules update is distributed as a fresh random character", `${sub.id}: update needing ${k}`, acc.fresh, acc.again, base);

    // --- Occupation: every dropdown, every option ---------------------------------
    for (let i = 0; i < Math.min(o.fewSeeds, fresh.length); i++) occupation(r, c, arch, fresh[i], { ...base, seed: i + 1 }, i + 1, bounds, gear);

    // --- overrides ---------------------------------------------------------------------
    for (let i = 0; i < Math.min(o.fewSeeds, fresh.length); i++) overrides(r, c, fresh[i], { ...base, seed: i + 1, record: fresh[i].record });

    // --- the Word export ---------------------------------------------------------------
    for (let i = 0; i < Math.min(3, fresh.length); i++) {
      const b = fresh[i];
      const rep: Repro = { ...base, seed: i + 1, record: b.record };
      const named = { ...b.character, name: `E2E ${archId} ${i}` };
      const sheet = toSheetCharacter(named, c);
      try {
        const zip = await renderSheetDocx([sheet], template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) as ArrayBuffer);
        const text = docxText(unzipEntry(zip, "word/document.xml"));
        r.expect(text.includes(named.name), "docx holds the character", "name missing from the .docx", rep);
        const missing = [...sheet.abilities.map((a) => a.name), ...sheet.firearms.map((f) => f.name), ...sheet.melee.map((m) => m.name), ...sheet.other].filter(
          (n) => !text.includes(n),
        );
        r.expect(!missing.length, "docx holds every sheet line", `missing: ${missing.join("; ")}`, rep, `${archId}: ${missing.map(norm).join("; ")}`);
      } catch (e) {
        r.fail("docx renders", String((e as Error).stack ?? e), rep, (e as Error).message);
      }
    }
  }
}

/** The dice a build rolled that the record didn't hold (kept or not). */
const rolledAgain = (b: BuildResult, rec: CharacterRecord): string[] => {
  const keys = b.log.filter((e) => e.type === "dice" && !e.reused && !e.eachGame).map((e) => e.key);
  return keys.length ? keys : ["(a die whose result isn't kept)"];
};

/** Rebuilds a record the builder saved: it must roll nothing (ENGINE.md). A record that needs dice is a finding; it is then built with fixed dice to go on. */
function replay(r: Report, c: Compendium, rec: CharacterRecord, rep: Repro, what: string): BuildResult {
  try {
    const b = build(c, rec, { mode: "freeform", roll: THROW });
    r.pass(`${what}: the saved record replays without rolling`);
    return b;
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("rolled a die")) throw e;
    // Which decision: the keys a build with dice adds.
    const b = build(c, rec, { mode: "freeform", roll: seededRoller(99) });
    const added = rolledAgain(b, rec);
    r.fail(`${what}: the saved record replays without rolling`, `rebuilding the saved record rolls ${added.join(", ")}`, rep, `${what}: ${added.map(norm).join(", ")}`);
    return b;
  }
}

/** What every random character (and any made from one at random) must be. */
function checkCharacter(
  r: Report,
  c: Compendium,
  arch: Archetype,
  b: BuildResult,
  rep: Repro,
  what: string,
  bounds: ReturnType<typeof openPickBounds>,
  gear: ReturnType<typeof gearPolicies>,
  noOpenChoices: boolean,
): void {
  const ch = b.character;
  const penalties = powersPenalties(c);
  if (noOpenChoices) r.expect(b.pending.length === 0, `${what} has no open choices`, `open: ${b.pending.map((p) => p.key).join(", ")}`, rep, b.pending.map((p) => norm(p.key)).join(", "));
  else r.expect(b.pending.length === 0, `${what} has no open choices`, `open: ${b.pending.map((p) => p.key).join(", ")}`, rep, b.pending.map((p) => norm(p.key)).join(", "));
  for (const w of b.warnings) r.fail(`${what} has no engine warnings`, w, rep, `${arch.id}: ${norm(w)}`);
  if (!b.warnings.length) r.pass(`${what} has no engine warnings`);

  // The subtype is the one asked for.
  r.expect(ch.subtype.id === b.record.subtype && ch.archetype.id === arch.id, `${what}: archetype and subtype as recorded`, `${ch.archetype.id}/${ch.subtype.id}`, rep);

  // Stats: integers; the base within the stat line's dice (capped at 100 for humans).
  const sub = arch.subtypes.find((s) => s.id === b.record.subtype)!;
  for (const s of STATS) {
    const line = ch.stats[s];
    const d = sub.stats[s as Stat];
    if (![line.base, line.modified, line.final].every(Number.isInteger)) r.fail(`${what}: stats are whole numbers`, `${s} ${JSON.stringify(line)}`, rep, s);
    if (d === undefined) continue;
    let lo = dice.min(d);
    let hi = dice.max(d);
    if (arch.human !== false) {
      lo = Math.min(lo, 100);
      hi = Math.min(hi, 100);
    }
    r.expect(line.base >= lo && line.base <= hi, `${what}: base stats within the stat line`, `${s} base ${line.base} outside ${d} [${lo}..${hi}]`, rep, s);
  }

  // `:count` dice: as many results as rolled.
  for (const e of b.log) {
    if (e.type !== "dice" || !e.key.endsWith(":count") || e.total === undefined) continue;
    const k = e.key.slice(0, -":count".length);
    const chosen = b.record.choices[k];
    if (chosen) {
      const n = chosen.filter((x) => x !== ROLL_OPTION).length;
      r.expect(n === e.total, `${what}: as many chosen as the count rolled`, `${k}: rolled ${e.total}, chose ${n}`, rep, norm(k));
    } else {
      const slots = new Set(b.log.filter((x) => new RegExp(`^${escape(k)}#\\d+$`).test(x.key)).map((x) => x.key)).size;
      // A powers effect's cross-discipline penalty drops slots past it (ENGINE.md).
      const penalty = penalties.get(k.split(">").pop()!) ?? 0;
      if (slots || !b.log.some((x) => x.key.startsWith(`${k}#`)))
        r.expect((slots <= e.total && slots >= e.total - penalty) || slots === 0, `${what}: as many rolls as the count rolled`, `${k}: rolled ${e.total}, made ${slots}`, rep, norm(k));
      if (slots === 0 && e.total > 0 && !b.log.some((x) => x.key.startsWith(`${k}#`) || x.key.startsWith(`${k}>`)) && !powersSlots(b, k))
        r.fail(`${what}: as many rolls as the count rolled`, `${k}: rolled ${e.total}, made none`, rep, `${norm(k)} made none`);
    }
  }

  // Open picks: a random character takes at most the book's random share.
  for (const [k, v] of Object.entries(b.record.choices)) {
    const bound = bounds.get(leafOf(k));
    if (!bound) continue;
    r.expect(v.length <= bound.most, `${what}: open picks within the book's bounds`, `${k}: took ${v.length}, at most ${bound.most} (${bound.kind}${bound.random ? `, random ${bound.random}` : ""})`, rep, `${norm(k)} took more than ${bound.most}`);
  }

  // Restrictions: nothing a restriction refuses.
  for (const t of ownedAll(ch)) {
    r.expect(!t.restricted, `${what} breaks no restriction`, `${t.kind} ${t.name} is restricted (${ch.restrictions.map((x) => x.source).join(", ")})`, rep, `${t.kind}/${t.id}`);
  }
  // Alignment: one the archetype allows (checked as a legal choice too).
  if (ch.alignment) r.expect(ALIGNMENTS.includes(ch.alignment), `${what}: alignment is the book's`, ch.alignment, rep);

  // Gear: an item chosen for a gear result is of its availability (for this character); alien only where allowed.
  const rollAt = new Map(ch.rolls.map((x) => [x.key, x]));
  for (const it of ch.items) {
    for (const f of it.from) {
      if (!f.key) continue;
      if (f.key.endsWith(":item")) {
        const slot = f.key.slice(0, -":item".length);
        const res = rollAt.get(slot);
        const entry = c.items.get(it.id);
        if (res?.availability && entry && !entry.unrestricted && it.availability) {
          r.expect(it.availability === res.availability, `${what}: gear is of the rolled availability`, `${it.name} is ${it.availability}, the result ${res.label} was ${res.availability}`, rep, `${it.id} ${it.availability}≠${res.availability}`);
        }
      }
      const slotKey = f.key.split(">")[0].replace(/(#\d+|~\d+|:item|:avail)+$/, "");
      const policy = gear.get(slotKey);
      const entry = c.items.get(it.id);
      if (policy && entry?.alien && f.key.startsWith(`${slotKey}#`)) {
        const alien = (policy.gear as { alien?: boolean | { alignment?: string[] } }).alien;
        const ok = alien === true || (typeof alien === "object" && alien && (!alien.alignment || (ch.alignment && alien.alignment.includes(ch.alignment))));
        const unknown = typeof alien === "object" && alien && !alien.alignment;
        if (!unknown) r.expect(!!ok, `${what}: alien gear only where the book allows it`, `${it.name} (alien) from ${f.key}, alignment ${ch.alignment}, policy ${JSON.stringify(alien)}`, rep, `${it.id} from ${norm(slotKey)}`);
      }
    }
  }

  // The GM sheet shows everything the character has.
  const sheet = toSheetCharacter(ch, c);
  const text = JSON.stringify(sheet);
  for (const t of ownedAll(ch)) r.expect(text.includes(JSON.stringify(t.name).slice(1, -1)), `${what}: everything owned is on the GM sheet`, `${t.kind} ${t.name} not on the sheet`, rep, `${t.kind}/${t.id}`);
  for (const opt of ch.options) {
    const where = opt.source === arch.id ? sheet.tagLine : text;
    r.expect(where.includes(opt.name), `${what}: every option chosen is on the GM sheet`, `option ${opt.name} (${opt.key}) not on the sheet`, rep, `${opt.source}: ${opt.id}`);
  }
  if (ch.alignment) r.expect(sheet.tagLine.includes(ch.alignment), `${what}: alignment on the name line`, `${ch.alignment} missing from "${sheet.tagLine}"`, rep);
  for (const g of ch.eachGame) r.expect(sheet.gameNotes.some((n) => n.includes(g.text.slice(0, 30))), `${what}: each-game rolls in Game Notes`, g.text, rep, g.table);
  for (const e of ch.empty) r.expect(sheet.other.some((x) => x.startsWith(e.name)), `${what}: empty results on the sheet`, e.name, rep, e.name);
  for (const l of ch.locations) r.expect(text.includes(l.location), `${what}: chosen hit locations on the GM sheet`, `${l.location} (from ${l.source}) not on the sheet`, rep, `${l.source}: location`);
  for (const comp of ch.companions) {
    const a = c.archetypes.get(comp.archetype);
    const names = [a?.name, a?.characters, comp.option].filter(Boolean) as string[];
    r.expect(names.some((n) => text.includes(n)), `${what}: companions on the GM sheet`, `companion ${comp.archetype}${comp.option ? `/${comp.option}` : ""} (from ${comp.source}) not on the sheet`, rep, `${comp.source}: ${comp.archetype}`);
  }
}

let penaltyCache: Map<string, number> | null = null;
/** Powers effects with a cross-discipline penalty, by "<entry>/<effect id>". */
function powersPenalties(c: Compendium): Map<string, number> {
  if (penaltyCache) return penaltyCache;
  penaltyCache = new Map();
  for (const e of [...c.archetypes.values(), ...c.talents.values(), ...c.exotics.values(), ...c.mutations.values(), ...c.items.values(), ...c.tables.values(), ...c.rules.values()]) {
    for (const { effects } of effectLists(e)) walkEffects(effects, (x) => {
      const pen = "powers" in x ? (x.powers as { crossDisciplinePenalty?: number }).crossDisciplinePenalty : undefined;
      if (pen && "id" in x && x.id) penaltyCache!.set(`${e.id}/${x.id}`, pen);
    });
  }
  return penaltyCache;
}

/** A powers effect's count drops slots past a cross-discipline penalty: its slots may be fewer. */
const powersSlots = (b: BuildResult, k: string) => b.log.some((x) => x.key.startsWith(k) && x.key !== `${k}:count`);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The record replays exactly: freeform with no dice, random with no dice, and through JSON. */
function checkReplay(r: Report, c: Compendium, b: BuildResult, rep: Repro): void {
  for (const mode of ["freeform", "random"] as const) {
    let again: BuildResult;
    try {
      again = build(c, cloneRecord(b.record), { mode, roll: THROW, pick: () => { throw new Error("asked for a choice the record should have had"); } });
    } catch (e) {
      const asked: string[] = [];
      const probe = build(c, cloneRecord(b.record), { mode, roll: seededRoller(99), pick: (p) => void asked.push(p.key) });
      const what = (e as Error).message.startsWith("rolled") ? `rolls ${rolledAgain(probe, b.record).join(", ")}` : `asks ${asked.join(", ")}`;
      r.fail("replaying the record rolls and asks nothing", `${mode}: ${what}`, rep, `${mode}: ${norm(what)}`);
      continue;
    }
    r.expect(isDeepStrictEqual(again.character, b.character), "replaying the record reproduces the character", `${mode}: ${firstDiff(b.character, again.character)}`, rep, `${mode}: ${firstDiff(b.character, again.character).split(":")[0]}`);
    r.expect(isDeepStrictEqual(again.record, b.record), "replaying the record reproduces the record", `${mode}: ${firstDiff(b.record, again.record)}`, rep, mode);
    r.expect(isDeepStrictEqual(again.warnings, b.warnings), "replaying the record gives the same warnings", `${mode}: ${JSON.stringify(again.warnings)} vs ${JSON.stringify(b.warnings)}`, rep, mode);
  }
  const parsed = parseRecord(JSON.parse(JSON.stringify(b.record)));
  if (!r.expect(parsed.ok, "the record survives JSON", parsed.ok ? "" : parsed.error, rep)) return;
}

/** Where two values first differ ("items.2.qty: 1 ≠ 2"). */
export function firstDiff(a: unknown, b: unknown, path = ""): string {
  if (isDeepStrictEqual(a, b)) return "";
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      if (d) return d;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 200)} ≠ ${JSON.stringify(b)?.slice(0, 200)}`;
}

/** Every choice in the record is one of its options, as many as it asks. */
function checkChoicesLegal(r: Report, c: Compendium, b: BuildResult, rep: Repro, what: string): void {
  for (const [k, chosen] of Object.entries(b.record.choices)) {
    let p;
    try {
      p = ops.choiceOptions(c, b.record, k);
    } catch (e) {
      r.fail(`${what}: choices are legal`, `${k}: choiceOptions threw ${(e as Error).message}`, rep, norm(k));
      continue;
    }
    if (!p) continue; // made by itself (one option, as many as picks)
    const ids = new Set(p.options.map((x) => x.id));
    const bad = chosen.filter((x) => !ids.has(x) && x !== "no" && x !== "yes");
    const yesNo = p.kind === "optional" || p.kind === "trade";
    if (!yesNo) r.expect(!bad.length, `${what}: choices are legal`, `${k} (${p.kind}): ${bad.join(", ")} not among ${[...ids].slice(0, 12).join(", ")}${ids.size > 12 ? "…" : ""}`, rep, `${norm(k)}: ${bad.join(",")}`);
    const n = chosen.filter((x) => x !== ROLL_OPTION).length;
    if (p.kind === "power") continue; // rolled on the table: a slot each
    // A count rolled (D6 locations): as many as the record's roll, not the preview's middle face.
    const rolled = b.log.find((e) => e.key === `${k}:count` && e.type === "dice")?.total;
    const want = rolled ?? p.count;
    const lo = p.min ?? Math.min(want, p.options.length);
    if (rolled !== undefined && p.min === undefined) {
      r.expect(n === Math.min(rolled, p.options.length), `${what}: as many chosen as the choice asks`, `${k} (${p.kind}): ${n} chosen, ${rolled} rolled, ${p.options.length} options`, rep, norm(k));
      continue;
    }
    if (!yesNo) r.expect(n >= lo && n <= p.count, `${what}: as many chosen as the choice asks`, `${k} (${p.kind}): ${n} chosen, ${p.min !== undefined ? `${p.min}..` : ""}${p.count} asked, ${p.options.length} options`, rep, norm(k));
  }
}

/** Open picks over many random characters: none for "any"; for "up to N", 0..N about evenly (D(N+1)-1). */
function checkOpenPickDistribution(r: Report, fresh: BuildResult[], bounds: ReturnType<typeof openPickBounds>, base: Repro): void {
  const seen = new Map<string, number[]>();
  for (const b of fresh) for (const [k, v] of Object.entries(b.record.choices)) {
    const bound = bounds.get(leafOf(k));
    if (!bound) continue;
    const key = norm(k);
    seen.set(key, [...(seen.get(key) ?? []), v.length]);
  }
  for (const [k, lens] of seen) {
    const bound = bounds.get(leafOf(k))!;
    if (lens.length < 30 || bound.random) continue;
    if (bound.kind === "any") r.expect(lens.every((n) => n === 0), "open picks: random takes none of \"any\"", `${k}: took ${Math.max(...lens)}`, base, k);
    else {
      const N = bound.most;
      const hist = Array.from({ length: N + 1 }, (_, i) => lens.filter((x) => x === i).length);
      // Each of 0..N should come up; capped by how many options there were (a few seeds may have fewer).
      const share = hist.map((h) => h / lens.length);
      const even = share.every((s) => Math.abs(s - 1 / (N + 1)) < 0.15);
      r.expect(even, "open picks: \"up to N\" takes 0..N evenly", `${k}: counts ${hist.join("/")} of ${lens.length} (0..${N})`, base, k);
    }
  }
}

function compare(r: Report, check: string, what: string, a: Record<string, number>[], b: Record<string, number>[], base: Repro): void {
  if (a.length < 20) return;
  for (const m of Object.keys(a[0])) compareOne(r, check, what, m, a.map((x) => x[m]), b.map((x) => x[m]), base);
}

function compareOne(r: Report, check: string, what: string, metric: string, a: number[], b: number[], base: Repro): void {
  if (a.length < 20) return;
  const floor = Math.max(0.5, 0.03 * Math.abs(a.reduce((s, x) => s + x, 0) / a.length));
  const d = differ(a, b, { floor });
  r.expect(!d.differ, check, `${what}, ${metric}: fresh ${fmt(d.a)} vs ${fmt(d.b)} (z ${d.z.toFixed(1)})`, base, `${what.replace(/#\d+/g, "#N")}: ${metric}`);
}

/** The Occupation dropdowns (ops the builder calls): each option of the archetype's own picks and optional headings. */
const SHEET_SECTIONS = new Set(["Equipment", "Armour", "Psychic Abilities", "Exotic Abilities", "Talents", "Mutations", "Alignment"]);
function occupation(r: Report, c: Compendium, arch: Archetype, b: BuildResult, base: Repro, seed: number, bounds: ReturnType<typeof openPickBounds>, gear: ReturnType<typeof gearPolicies>): void {
  const rec = b.record;
  const tryChoose = (key: string, ids: string[], then: Record<string, string[]> | undefined, label: string, check: (v: BuildResult) => void) => {
    const rep: Repro = { ...base, record: rec, key, steps: [`random build seededRoller(${seed})`, `choose(${JSON.stringify(key)}, ${JSON.stringify(ids)}${then ? `, then ${JSON.stringify(then)}` : ""})`, "fillPending()"] };
    try {
      const next = ops.choose(c, rec, key, ids, { roll: seededRoller(5_000_000 + seed), then });
      const v = replay(r, c, next, { ...rep, record: next }, `Occupation ${label}`);
      check(v);
      // Whatever the change opened, chosen at random, is a whole character.
      const filled = ops.fillPending(c, next, { roll: seededRoller(6_000_000 + seed) });
      const fb = replay(r, c, filled, { ...rep, record: filled }, `Occupation ${label}, then choose at random`);
      checkCharacter(r, c, arch, fb, { ...rep, record: filled }, `Occupation ${label}, then choose at random`, bounds, gear, true);
      r.expect(isDeepStrictEqual(fb.record.choices[key], ids), `Occupation ${label} keeps the choice made`, `${key}: ${JSON.stringify(fb.record.choices[key])}`, rep, norm(key));
    } catch (e) {
      r.fail(`Occupation ${label} doesn't throw`, String((e as Error).stack ?? e), rep, `${norm(key)}: ${(e as Error).message}`);
    }
  };
  for (const e of b.log) {
    if (e.type !== "choice" || e.parent || !e.key.startsWith(`${arch.id}/`)) continue;
    const p = ops.choiceOptions(c, rec, e.key);
    if (p && p.kind === "pick" && p.count === 1 && p.options.length >= 2) {
      for (const opt of p.options) {
        tryChoose(e.key, [opt.id], undefined, "pick", (v) => {
          const named = c.archetypes.get(arch.id) && v.character.options.some((x) => x.key === e.key && x.id === opt.id);
          const grant = /^(talent|exotic|item|mutation|power):(.+)$/.exec(opt.id);
          const got = grant ? ownedAll(v.character).some((t) => t.kind === grant[1] && t.id === grant[2]) : named;
          // An option that is an effect (a stat change…) shows nothing by name: only named options and grants are checked.
          if (grant || v.character.options.some((x) => x.key === e.key)) r.expect(!!got, "Occupation pick shows the option chosen", `${e.key} = ${opt.id} (${opt.label}) not on the character`, { ...base, key: e.key }, `${norm(e.key)}=${opt.id}`);
        });
      }
    }
    if (e.section && !SHEET_SECTIONS.has(e.section) && (rec.choices[e.key]?.[0] === "yes" || rec.choices[e.key]?.[0] === "no")) {
      tryChoose(e.key, ["no"], undefined, "optional heading", (v) => {
        r.expect(!v.log.some((x) => x.parent === e.key && x.type === "choice" && x.result.some(Boolean)), "Occupation optional heading \"–\" takes nothing", `${e.key}=no still chose under it`, { ...base, key: e.key });
      });
      const on = cloneRecord(reroll(c, rec, e.key));
      on.choices[e.key] = ["yes"];
      const vb = ops.view(c, on);
      const inner = vb.pending.find((x) => x.parent === e.key) ?? null;
      const only = !inner ? vb.log.find((x) => x.parent === e.key && x.type === "choice") : undefined;
      const innerKey = inner?.key ?? only?.key;
      const opts = inner ? inner.options.map((x) => x.id) : only && vb.record.choices[only.key] ? [vb.record.choices[only.key][0]] : [];
      r.expect(!!innerKey && opts.length > 0, "Occupation optional heading offers options", `${e.key}: nothing to choose under it`, { ...base, key: e.key }, norm(e.key));
      for (const id of opts) tryChoose(e.key, ["yes"], { [innerKey!]: [id] }, "optional heading", (v) => {
        r.expect(isDeepStrictEqual(v.record.choices[innerKey!], [id]), "Occupation optional heading keeps its option", `${innerKey} = ${JSON.stringify(v.record.choices[innerKey!])}, wanted ${id}`, { ...base, key: e.key }, norm(innerKey!));
      });
    }
  }
  // Another subtype, and another archetype, keep the name (the builder's rebuild).
  for (const s of arch.subtypes) {
    const rec2 = ops.create(c, arch.id, s.id, "random", { name: "E2E", roll: seededRoller(seed) });
    r.expect(rec2.name === "E2E" && rec2.subtype === s.id, "Occupation subtype change rebuilds", `${s.id}: ${rec2.subtype} ${rec2.name}`, base);
  }
}

function overrides(r: Report, c: Compendium, b: BuildResult, rep: Repro): void {
  const rec = b.record;
  const v = (x: CharacterRecord) => replay(r, c, x, { ...rep, record: x }, "override");
  // Against the record rebuilt (not the random build: a record that doesn't replay is its own finding).
  const ch = build(c, rec, { mode: "freeform", roll: seededRoller(99) }).character;
  // Removing each thing, then adding it back, is the character again.
  for (const t of ownedAll(ch)) {
    const step = { ...rep, steps: [`removeThing(${t.kind}, ${t.id})`, `addThing(${t.kind}, ${t.id})`] };
    const less = v(ops.removeThing(rec, t.kind, t.id));
    const still = ownedAll(less.character).find((x) => x.kind === t.kind && x.id === t.id);
    const qty = (x: unknown) => (x as { qty?: number } | undefined)?.qty ?? 1;
    r.expect(!still || (t.kind === "item" && qty(still) < qty(t)), "remove takes it away", `${t.kind} ${t.name} still there (qty ${qty(still)})`, step, `${t.kind}/${t.id}`);
    r.expect(less.character.overridden.removed.some((x) => x.kind === t.kind && x.id === t.id), "remove is flagged as an override", `${t.kind} ${t.id}`, step);
    const back = v(ops.addThing(ops.removeThing(rec, t.kind, t.id), t.kind, t.id));
    r.expect(isDeepStrictEqual(back.character, ch), "remove then add is the character again", firstDiff(ch, back.character), step, `${t.kind}/${t.id}`);
  }
  // Adding one of each kind, then removing it.
  for (const kind of THING_KINDS) {
    const map = { talent: c.talents, exotic: c.exotics, item: c.items, mutation: c.mutations, power: c.powers }[kind as ThingKind] as Map<string, { id: string }>;
    const have = new Set(ownedAll(ch).filter((t) => t.kind === kind).map((t) => t.id));
    const pick = [...map.keys()].sort().find((id) => !have.has(id));
    if (!pick) continue;
    const step = { ...rep, steps: [`addThing(${kind}, ${pick})`, `removeThing(${kind}, ${pick})`] };
    try {
      const more = v(ops.addThing(rec, kind, pick));
      const got = ownedAll(more.character).find((t) => t.kind === kind && t.id === pick);
      r.expect(!!got && !!got.overridden, "add gives it, flagged", `${kind} ${pick}: ${JSON.stringify(got)?.slice(0, 200)}`, step, `${kind}`);
      const undone = v(ops.removeThing(ops.addThing(rec, kind, pick), kind, pick));
      r.expect(isDeepStrictEqual(undone.character, ch), "add then remove is the character again", firstDiff(ch, undone.character), step, kind);
    } catch (e) {
      r.fail("add doesn't throw", String(e), step, kind);
    }
  }
  // Stats: set, flagged; null is the rules' value again.
  for (const s of STATS) {
    const to = ch.stats[s].final === 42 ? 43 : 42;
    const set = v(ops.setStat(c, rec, s, to));
    r.expect(set.character.stats[s].final === to && set.character.stats[s].overridden, "stat override sets the final value", `${s}: ${JSON.stringify(set.character.stats[s])}`, { ...rep, steps: [`setStat(${s}, ${to})`] }, s);
    const same = ops.setStat(c, rec, s, ch.stats[s].final);
    r.expect(!same.overrides.length, "stat set to the rules' value is no override", JSON.stringify(same.overrides), rep, s);
    const back = v(ops.setStat(c, ops.setStat(c, rec, s, to), s, null));
    r.expect(isDeepStrictEqual(back.character, ch), "stat override removed is the rules' value", firstDiff(ch, back.character), { ...rep, steps: [`setStat(${s}, ${to})`, `setStat(${s}, null)`] }, s);
  }
  for (const a of ALIGNMENTS) {
    const set = v(ops.setAlignment(rec, a));
    r.expect(set.character.alignment === a && set.character.overridden.alignment, "alignment override", `${a}: ${set.character.alignment}`, { ...rep, steps: [`setAlignment(${a})`] }, a);
  }
  const back = v(ops.setAlignment(ops.setAlignment(rec, "Radical"), null));
  r.expect(isDeepStrictEqual(back.character, ch), "alignment override removed", firstDiff(ch, back.character), { ...rep, steps: ["setAlignment(Radical)", "setAlignment(null)"] });
  r.expect(v(ops.rename(rec, "Ægidius ‘Ø’")).character.name === "Ægidius ‘Ø’", "rename", "", rep);
}
