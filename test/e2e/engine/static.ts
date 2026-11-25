// Checks on the rules themselves and on the places most like the confirmed
// bugs (engine:static), with no random character to reach them:
// - p. 3: the archetypes asterisked for GM approval are the book's list;
// - p. 3 steps 1–3: the warband warnings (two Inquisitors, GM approval,
//   Puritan with Radical, extra models from a companion or a member's note);
// - every pool pick (not of owned things) has something to choose from, and
//   not only what one archetype may take (Dead Or Alive's Legendary heavy
//   weapon: only the Ecclesiarchy's Incinerator);
// - a pick's count fits its options (Crone World's power picks);
// - two of an item that makes its own choices (toxins, sides, prayers): each
//   unit makes them (the second Executor Pistol's toxins).
import { warbandWarnings as clientWarnings } from "../../../src/client/warband/warnings.ts";
import { build, difficultyWithin } from "../../../src/shared/engine/build.ts";
import * as dice from "../../../src/shared/engine/dice.ts";
import { newRecord } from "../../../src/shared/engine/record.ts";
import { seededRoller } from "../../../src/shared/engine/rng.ts";
import { warbandWarnings } from "../../../src/shared/engine/warband.ts";
import { effectLists, entryNames, walkEffects, type Compendium } from "../../../src/shared/rules/compendium.ts";
import type { Ability, Archetype, Effect, Item, PickFilter } from "../../../src/shared/rules/schema.ts";
import type { Report } from "../lib/report.ts";
import { realCompendium } from "../lib/rules.ts";
import type { RunOptions } from "../shards.ts";
import { explainWarning, randomBuild } from "./archetype.ts";

/** p. 3: "Consult your GM before including any of the following characters in your Warrior Band: Adeptus Astartes, Callidus Assassin, Culexus Assassin, Daemons, Eldar Pirates, Eldar Rangers, Eversor Assassin, Kroot, Purestrain Genestealer, and Vindicare Assassin." */
const GM_APPROVAL = ["adeptus-astartes", "callidus-assassin", "culexus-assassin", "daemons", "eldar-pirates", "eldar-rangers", "eversor-assassin", "kroot", "purestrain-genestealers", "vindicare-assassin"];

const KINDS = { talent: "talents", exotic: "exotics", mutation: "mutations", power: "powers", item: "items" } as const;

/** A pool's candidates by its filter alone (no character: nothing owned, no restriction). */
function candidates(c: Compendium, kind: keyof typeof KINDS, f: PickFilter | undefined): (Ability | Item)[] {
  const all = [...(c[KINDS[kind]] as Map<string, Ability | Item>).values()];
  return all.filter((x) => {
    if (f?.group && !(x.group && f.group.includes(x.group))) return false;
    if (f?.discipline && !(x.group && f.discipline.includes(x.group))) return false;
    if (f?.category && !(x.kind === "item" && x.category && f.category.includes(x.category))) return false;
    if (f?.tag && !f.tag.some((t) => entryNames(x).includes(t))) return false;
    if (f?.exclude && f.exclude.some((t) => entryNames(x).includes(t))) return false;
    if (f?.availability && !(x.kind === "item" && (x.unrestricted || (x.availability && f.availability.includes(x.availability))))) return false;
    if (f?.maxDifficulty !== undefined && !("difficulty" in x && difficultyWithin(x.difficulty, f.maxDifficulty))) return false;
    return true;
  });
}

export async function engineStatic(r: Report, _o: RunOptions): Promise<void> {
  const c = realCompendium();

  // --- p. 3: GM approval --------------------------------------------------------------
  for (const a of c.archetypes.values()) {
    const fromBook = c.origin.get(`archetype/${a.id}`) === "loyalist";
    const want = GM_APPROVAL.includes(a.id);
    if (fromBook || want) r.expect(!!a.gmApproval === want, "the archetypes for GM approval are the book's list (p. 3)", `${a.id}: gmApproval ${!!a.gmApproval}, the book ${want}`, { archetype: a.id }, a.id);
  }
  for (const id of GM_APPROVAL) r.expect(c.archetypes.has(id), "the archetypes for GM approval are the book's list (p. 3)", `no archetype ${id}`, {}, id);

  // --- p. 3: the warband warnings -------------------------------------------------------
  const member = (arch: string, sub: string, seed: number, align?: string) => {
    for (let s = seed; s < seed + 200; s++) {
      const b = randomBuild(c, arch, sub, s);
      if (!align || b.character.alignment === align) return { id: `${arch}-${s}`, character: b.character, record: b.record };
    }
    throw new Error(`no ${align} ${arch}`);
  };
  const inq1 = member("inquisitor", "fighter", 1, "Puritan");
  const inq2 = member("inquisitor", "sage", 1, "Radical");
  const neutral = member("servitors", c.archetypes.get("servitors")!.subtypes[0].id, 1, "Neutral");
  const kinds = (ms: { id: string; character: never }[]) => clientWarnings(c, ms as never).map((w) => w.kind);
  r.expect(warbandWarnings(c, [inq1.record, inq2.record]).length > 0, "two Inquisitors break the warband rule (p. 3)", "no engine warning", {});
  r.expect(kinds([inq1, inq2] as never).includes("limit"), "two Inquisitors warn (p. 3)", JSON.stringify(kinds([inq1, inq2] as never)), {});
  r.expect(kinds([inq1, inq2] as never).includes("alignment"), "Puritan and Radical in one warband warn (p. 3, step 2)", JSON.stringify(kinds([inq1, inq2] as never)), {});
  r.expect(!kinds([inq1, neutral] as never).length || !kinds([inq1, neutral] as never).includes("alignment"), "Puritan with Neutral doesn't warn (p. 3, step 2)", JSON.stringify(kinds([inq1, neutral] as never)), {});
  r.expect(!kinds([inq1] as never).length, "one Inquisitor warns of nothing", JSON.stringify(clientWarnings(c, [inq1] as never)), {});
  r.expect(kinds([inq1, member("kroot", c.archetypes.get("kroot")!.subtypes[0].id, 1)] as never).includes("gm"), "an archetype for GM approval warns (p. 3)", "no gm warning", {});
  for (let s = 1; s < 60; s++) {
    const e = randomBuild(c, "enginseers", c.archetypes.get("enginseers")!.subtypes[0].id, s);
    if (!e.character.companions.length) continue;
    r.expect(kinds([{ id: "e", character: e.character }] as never).includes("models"), "a companion is an extra model (p. 3, step 3)", "no models warning", { archetype: "enginseers", seed: s, record: e.record });
    break;
  }

  // --- pool picks with nothing (or only another archetype's things) to choose from ---------
  const archetypeOnly = (x: Ability | Item) => (x.kind === "item" && x.requires ? JSON.stringify(x.requires) : null);
  for (const e of [...c.archetypes.values(), ...c.talents.values(), ...c.exotics.values(), ...c.mutations.values(), ...c.powers.values(), ...c.items.values(), ...c.tables.values(), ...c.rules.values()]) {
    for (const { effects } of effectLists(e)) {
      walkEffects(effects, (x: Effect) => {
        if (!("pick" in x) || !x.pool || x.filter?.owned === true) return;
        const kind = x.pool as keyof typeof KINDS;
        if (!(kind in KINDS)) return;
        const cs = candidates(c, kind, x.filter);
        const where = `${e.kind} ${e.id}/${x.id}`;
        const want = typeof x.pick === "object" || x.pick === "any" ? 0 : dice.max(x.pick as string);
        // (an item pick in a table row with nothing to choose from is the documented `empty` result: "Heavy weapon (Common)", ENGINE.md)
        if (!cs.length && want > 0 && e.kind === "table" && kind === "item") r.note(`${where}: nothing to choose from, shown as an empty result (ENGINE.md)`);
        else r.expect(cs.length > 0 || want === 0, "a pool pick has something to choose from", `${where}: nothing (${JSON.stringify(x.filter)})`, { key: `${e.id}/${x.id}` }, where);
        if (cs.length && cs.every((y) => archetypeOnly(y))) r.fail("a pool pick offers more than one archetype's things", `${where}: only ${cs.map((y) => `${y.name} (${archetypeOnly(y)})`).join(", ")}`, { key: `${e.id}/${x.id}` }, where);
        else if (cs.length) r.pass("a pool pick offers more than one archetype's things");
        if (want > 1 && cs.length < want) r.fail("a pool pick's count fits its options", `${where}: ${want} wanted, ${cs.length} to choose from`, { key: `${e.id}/${x.id}` }, where);
      });
    }
  }

  // --- two units of an item that makes its own choices ------------------------------------
  const deciding = [...c.items.values()].filter((it) => (it.effects ?? []).some((x) => ("pick" in x && x.into === "self" && x.filter?.owned !== true) || ("pick" in x && x.from && !x.into)));
  // (a host whose own rules restrict nothing)
  const restricts = (a: Archetype) => a.sections.some((sec) => {
    let any = false;
    walkEffects(sec.effects, (x) => void (("restrict" in x || "exclusive" in x) && (any = true)));
    return any;
  });
  const host = [...c.archetypes.values()].sort((a, b) => a.id.localeCompare(b.id)).find((a) => !restricts(a) && a.subtypes.length === 1)!;
  for (const it of deciding) {
    if (it.requires) continue; // (only some archetypes may have it; the host may not)
    const test: Archetype = structuredClone(host);
    test.id = "e2e-two";
    test.sections = [...test.sections, { name: "Equipment", effects: [{ item: it.id }, { item: it.id }] as Effect[] }];
    const tc: Compendium = { ...c, archetypes: new Map(c.archetypes).set(test.id, test) };
    for (let seed = 1; seed <= 3; seed++) {
      const b = build(tc, newRecord(c.packs.map((p) => p.id), test.id, test.subtypes[0].id), { mode: "random", roll: seededRoller(seed) });
      const rep = { archetype: host.id, seed, record: b.record, steps: [`${host.id} with a section granting ${it.id} twice`, `random build seededRoller(${seed})`] };
      const owned = b.character.items.find((x) => x.id === it.id);
      const ws = b.warnings.filter((w) => w.includes(it.id) && !explainWarning(tc, b, w));
      r.expect(!ws.length, "two of an item each make its choices", `${it.name}: ${ws.join("; ")}`, rep, it.id);
      const picks = (it.effects ?? []).filter((x): x is Extract<Effect, { pick: unknown }> => "pick" in x && x.into === "self" && x.filter?.owned !== true);
      for (const p of picks) {
        const per = typeof p.pick === "string" || typeof p.pick === "number" ? dice.min(p.pick as string) : 0;
        const got = (owned?.chosen ?? []).filter((x) => x.key.includes(`${it.id}/${p.id}`)).length;
        if (per > 0) r.expect(got >= 2 * per, "two of an item each make its choices", `${it.name} ×${owned?.qty}: ${got} chosen for ${p.id}, ${2 * per} wanted`, rep, `${it.id} ${p.id}`);
      }
    }
  }
}
