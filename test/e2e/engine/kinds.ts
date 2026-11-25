// What the effect kinds the suite otherwise only counts must make, worked
// out again from the character's parts and its rules (docs/RULES-FORMAT.md
// "The extended vocabulary"): derived values, attributes, items' wielded
// effects, removed things, natural weapons, armour per location, exclusive
// scopes, reloads, powers within their effect's disciplines and difficulty,
// rolls that re-roll duplicates. Each failure names the kind.
import { deriveStats } from "../../../src/shared/engine/derived.ts";
import { difficultyWithin, roundOff, type BuildResult, type Character, type Owned } from "../../../src/shared/engine/build.ts";
import { effectLists, entryNames, walkEffects, type Compendium } from "../../../src/shared/rules/compendium.ts";
import { STATS, type Ability, type Effect, type Item } from "../../../src/shared/rules/schema.ts";
import { SHEET_LOCATION_OF } from "../../../src/shared/sheet-map.ts";
import type { SheetCharacter } from "../../../src/shared/sheet.ts";
import { optionsOf } from "../lib/outcomes.ts";
import type { Report, Repro } from "../lib/report.ts";

const DERIVED = ["Kbk", "BIV", "SS", "Cnc", "Spd"] as const;
/** The entry/effect a key ends in (as archetype.ts's leafOf). */
const leafOf = (key: string): string => key.split(">").pop()!.replace(/(\*\d+|#\d+|~\d+)+$/, "");
const ownedAll = (ch: Character): Owned[] => [...ch.talents, ...ch.exotics, ...ch.mutations, ...ch.powers, ...ch.items];

let effectIndex: WeakMap<Compendium, Map<string, Effect[]>> = new WeakMap();
/** Every effect with an id, by "<entry>/<effect id>" (several when an id is reused in other branches). */
export function effectsById(c: Compendium): Map<string, Effect[]> {
  let m = effectIndex.get(c);
  if (m) return m;
  m = new Map();
  for (const e of [...c.archetypes.values(), ...c.talents.values(), ...c.exotics.values(), ...c.mutations.values(), ...c.powers.values(), ...c.items.values(), ...c.tables.values(), ...c.rules.values()]) {
    for (const { effects } of effectLists(e)) walkEffects(effects, (x) => {
      if (!("id" in x) || !x.id) return;
      const k = `${e.id}/${x.id}`;
      m!.set(k, [...(m!.get(k) ?? []), x]);
    });
  }
  effectIndex.set(c, m);
  return m;
}

/** An entry's own top-level effects (what having it does outright, not what its options or branches do). */
const topEffects = (c: Compendium, kind: string, id: string): Effect[] => {
  const map = { talent: c.talents, exotic: c.exotics, mutation: c.mutations, power: c.powers, item: c.items }[kind] as Map<string, { effects?: Effect[] }> | undefined;
  return map?.get(id)?.effects ?? [];
};

export function checkKinds(r: Report, c: Compendium, b: BuildResult, sheet: SheetCharacter, rep: Repro, what: string): void {
  const ch = b.character;
  const owned = ownedAll(ch);
  const has = (kind: string, id: string) => owned.some((t) => t.kind === kind && t.id === id);
  const sources = new Set([ch.archetype.id, ...owned.map((t) => t.id), ...c.rules.keys(), ...c.tables.keys()]);

  // --- derived: the core formulas from the final stats (with "counts"), then adds, then sets; the sheet's Starting row shows it.
  const finals = Object.fromEntries(STATS.map((s) => [s, ch.stats[s].final])) as Record<(typeof STATS)[number], number>;
  for (const k of DERIVED) {
    const line = ch.derived[k];
    const counted = { ...finals };
    for (const m of line.mods) for (const [s, v] of Object.entries(m.counts ?? {})) counted[s as keyof typeof counted] += v as number;
    let n = deriveStats(counted)[k];
    for (const m of line.mods) if (m.add !== undefined) n += m.add;
    let v: number | "No" = n;
    // (the last set wins whatever order it came in: Curse of Thlezzloath and Scales, BIV 7; owner, November 2026)
    for (const m of line.mods) if (m.set !== undefined) v = m.set;
    r.expect(line.value === v, `${what}: derived values worked out from the final stats (derived)`, `${k}: ${line.value}, worked out ${v} (${JSON.stringify(line.mods)})`, rep, k);
    r.expect(sheet.starting[k] === String(line.value), `${what}: derived values on the sheet's Starting row (derived)`, `${k}: sheet ${sheet.starting[k]}, character ${line.value}`, rep, k);
    for (const m of line.mods) r.expect(sources.has(m.source), `${what}: derived changes come from what the character has (derived)`, `${k} ${JSON.stringify(m)} from ${m.source}, not owned`, rep, `${k} ${m.source}`);
  }
  // Every top-level derived effect of something owned is applied.
  for (const t of owned) for (const e of topEffects(c, t.kind, t.id)) {
    if (!("derived" in e)) continue;
    const ks = Array.isArray(e.derived) ? e.derived : [e.derived];
    for (const k of ks) r.expect(ch.derived[k].mods.some((m) => m.source === t.id), `${what}: an owned thing's derived effect is applied (derived)`, `${t.name}: ${k} has no change from it`, rep, `${t.id} ${k}`);
  }

  // --- attributes: in Game Notes, from something owned; an owned thing's attribute effect is there.
  for (const a of ch.attributes) {
    r.expect(sheet.gameNotes.includes(`${a.name} ${a.value}`), `${what}: attributes in Game Notes (attribute)`, `${a.name} ${a.value} not in Game Notes`, rep, a.name);
    r.expect(Number.isInteger(a.value), `${what}: attributes are whole numbers (attribute)`, `${a.name} ${a.value}`, rep, a.name);
  }
  for (const t of owned) for (const e of topEffects(c, t.kind, t.id)) {
    if ("attribute" in e) r.expect(ch.attributes.some((a) => a.name === e.attribute), `${what}: an owned thing's attribute is listed (attribute)`, `${t.name}: no ${e.attribute}`, rep, `${t.id} ${e.attribute}`);
  }

  // --- wielded: listed on the item's weapon row, never applied (no talent, no stat change from it).
  for (const it of ch.items) for (const e of topEffects(c, "item", it.id)) {
    if (!("wielded" in e)) continue;
    const w = ch.wielded.find((x) => x.source === it.id);
    r.expect(!!w, `${what}: wielded effects are listed (wielded)`, `${it.name}: no wielded entry`, rep, it.id);
    const row = [...sheet.firearms, ...sheet.melee].find((x) => x.name.startsWith(it.name));
    if (w && row) for (const label of w.effects) r.expect(row.special.includes(label), `${what}: wielded effects on the weapon's row (wielded)`, `${it.name}: "${label}" not in "${row.special}"`, rep, it.id);
    for (const x of e.wielded) {
      if ("stat" in x) {
        const list = x.stat === "all" ? STATS : Array.isArray(x.stat) ? x.stat : [x.stat];
        const itemStat = topEffects(c, "item", it.id).some((y) => "stat" in y);
        for (const s of list) if (!itemStat) r.expect(!ch.stats[s].mods.some((m) => m.source === it.id), `${what}: wielded stat changes aren't applied (wielded)`, `${it.name}: ${s} mods ${JSON.stringify(ch.stats[s].mods.filter((m) => m.source === it.id))}`, rep, `${it.id} ${s}`);
      }
      for (const k of ["talent", "exotic"] as const) {
        if (k in x) {
          const id = (x as Record<string, string>)[k];
          const t = owned.find((o) => o.kind === k && o.id === id);
          r.expect(!t || t.from.some((f) => f.entry !== it.id), `${what}: wielded grants aren't given (wielded)`, `${it.name} gave ${k} ${id}`, rep, `${it.id} ${id}`);
        }
      }
    }
  }

  // --- remove: what was taken is gone (even when something later gave it again).
  for (const t of ch.taken) r.expect(!has(t.kind, t.id), `${what}: removed things are gone (remove)`, `${t.kind} ${t.name} taken by ${t.by} but still owned`, rep, `${t.by} ${t.id}`);
  for (const t of owned) for (const e of topEffects(c, t.kind, t.id)) {
    if (!("remove" in e)) continue;
    for (const [k, ids] of Object.entries(e.remove)) for (const id of ids ?? []) {
      const x = owned.find((o) => o.kind === k && o.id === id && !o.overridden);
      r.expect(!x, `${what}: removed things are gone (remove)`, `${t.name} removes ${k} ${id}, still owned`, rep, `${t.id} ${id}`);
    }
  }

  // --- natural weapons: each a Melee or Firearm row.
  for (const w of ch.weapons) {
    const row = [...sheet.firearms, ...sheet.melee].some((x) => x.name === w.name || x.name.startsWith(w.name));
    r.expect(row, `${what}: natural weapons on the sheet (weapon)`, `${w.name} (from ${w.source}) has no row`, rep, `${w.source} ${w.name}`);
  }

  // --- armour: per location, the best piece plus every extra; from things owned; the sheet's Armour row.
  for (const loc of Object.keys(ch.armour) as (keyof Character["armour"])[]) {
    const pieces = ch.armourPieces.filter((p) => p.locations.includes(loc));
    const best = Math.max(0, ...pieces.filter((p) => p.av !== undefined).map((p) => p.av!));
    const extra = pieces.filter((p) => p.av === undefined && p.add !== undefined).reduce((n, p) => n + p.add!, 0);
    const want = best + extra;
    r.expect(ch.armour[loc].av === want, `${what}: armour per location is the best piece plus extras (armour)`, `${loc}: AV ${ch.armour[loc].av}, worked out ${want} from ${JSON.stringify(pieces.map((p) => [p.source, p.av, p.add]))}`, rep, loc);
    const col = SHEET_LOCATION_OF[loc];
    if (col) {
      const fields = ch.armourPieces.filter((p) => p.field && p.locations.includes(loc)).length;
      const cell = sheet.armour[col];
      r.expect(cell === "" ? ch.armour[loc].av === 0 && !fields : cell.split("+")[0] === String(ch.armour[loc].av) || (!ch.armour[loc].av && fields > 0), `${what}: the sheet's Armour row (armour)`, `${col}: "${cell}", AV ${ch.armour[loc].av}`, rep, col);
    }
  }
  for (const p of ch.armourPieces) r.expect(sources.has(p.source), `${what}: armour from things owned (armour)`, `${p.name} (${p.source}) isn't owned`, rep, p.source);
  // `choose: N` covers N distinct locations.
  for (const t of owned) for (const e of topEffects(c, t.kind, t.id)) {
    if (!("armour" in e) || !e.armour.choose) continue;
    for (const p of ch.armourPieces.filter((x) => x.source === t.id && x.av !== undefined)) {
      r.expect(new Set(p.locations).size === p.locations.length && p.locations.length <= Math.max(e.armour.choose, 8), `${what}: chosen armour locations are distinct (armour)`, `${t.name}: ${p.locations.join(", ")}`, rep, t.id);
    }
  }

  // --- exclusive: while the character has the entry, nothing else in its scope.
  for (const x of ch.restrictions.filter((x) => x.exclusive)) {
    const kind = x.pool;
    const others = owned.filter((t) => t.kind === kind && t.id !== x.source && !t.overridden).filter((t) => {
      const e = ({ talent: c.talents, exotic: c.exotics, mutation: c.mutations, power: c.powers, item: c.items } as Record<string, Map<string, Ability | Item>>)[kind]?.get(t.id);
      if (!e) return false;
      const names = entryNames(e);
      return (!x.group || x.group.some((g) => names.includes(g))) && (!x.tag || x.tag.some((g) => names.includes(g))) && (!x.category || x.category.some((g) => names.includes(g)));
    });
    r.expect(!others.length, `${what}: nothing else in an exclusive scope (exclusive)`, `${x.source} with ${others.map((t) => t.name).join(", ")}`, rep, `${x.source} ${others.map((t) => t.id).join(",")}`);
  }

  // --- reloads: the sheet's # Rld is the item's reloads times multiply plus add.
  for (const it of ch.items) {
    const row = sheet.firearms.find((x) => x.name.startsWith(it.name));
    if (!row) continue;
    const n = (it.reloads ?? 0) * ch.reloads.multiply + ch.reloads.add;
    const want = it.reloads === undefined && !ch.reloads.add ? "" : n > 0 ? String(n) : "";
    r.expect(row.reloads === want, `${what}: # Rld is the item's reloads with the character's (reloads)`, `${it.name}: "${row.reloads}", wanted "${want}" (item ${it.reloads}, ×${ch.reloads.multiply} +${ch.reloads.add})`, rep, it.id);
  }

  // --- powers: each slot's power is within its powers effect's difficulty and disciplines (plus access).
  const byId = effectsById(c);
  // The groups `access` opened for this character only: stated outright by its archetype or something it has, by an
  // option it chose, or by an optional access it took ("yes"); not every rule's (they would open every Chaos discipline).
  const opened = new Set<string>();
  const openBy = (list: Effect[]) => list.forEach((e) => "access" in e && e.access.pool === "power" && e.access.group.forEach((g) => opened.add(g)));
  openBy(c.archetypes.get(ch.archetype.id)!.sections.flatMap((s) => s.effects));
  for (const t of owned) openBy(topEffects(c, t.kind, t.id));
  for (const o of ch.options) openBy(optionsOf(c).get(`${o.source}|${o.id}`)?.effects ?? []);
  for (const e of b.log) {
    if (e.type !== "choice" || b.record.choices[e.key]?.[0] !== "yes") continue;
    for (const x of byId.get(leafOf(e.key)) ?? []) if ("optional" in x) openBy(x.optional);
  }
  for (const p of ch.powers) {
    if (p.overridden) continue;
    const entry = c.powers.get(p.id);
    for (const f of p.from) {
      if (!f.key) continue;
      const segs = f.key.split(">");
      for (let i = segs.length - 1; i >= 0; i--) {
        const k = segs[i].replace(/(#\d+|~\d+|\*\d+)+$/, "");
        const eff = byId.get(k)?.find((x) => "powers" in x);
        if (!eff || !("powers" in eff)) continue;
        const pw = eff.powers;
        if (pw.maxDifficulty !== undefined) r.expect(difficultyWithin(entry?.difficulty, pw.maxDifficulty), `${what}: powers within their effect's difficulty (powers)`, `${p.name} difficulty ${entry?.difficulty} > ${pw.maxDifficulty} (${f.key})`, rep, `${k} ${p.id}`);
        // (a Wyrd's powers are its own disciplines', never widened by `access`: ENGINE.md)
        const allowed = [...(pw.disciplines ?? []), ...(pw.wyrd ? [] : opened)];
        if (pw.disciplines?.length) r.expect(!!entry?.group && allowed.includes(entry.group), `${what}: powers within their effect's disciplines (powers)`, `${p.name} (${entry?.group}) not in ${allowed.join(", ")} (${f.key})`, rep, `${k} ${p.id}`);
        break;
      }
    }
  }

  // --- rerollDuplicates: no row twice under one roll key that re-rolls duplicates (stat rows aside).
  const byKey = new Map<string, string[]>();
  for (const x of ch.rolls) {
    const t = c.tables.get(x.table);
    if (!t?.rerollDuplicates) continue;
    const row = t.rows.find((rw) => rw.label === x.label);
    // (a row is a duplicate when it grants an ability the character has: ENGINE.md "Duplicates"; items may repeat)
    if (!row || !row.effects.some((e) => "talent" in e || "exotic" in e || "mutation" in e || "power" in e)) continue;
    const k = x.key.replace(/(#\d+|~\d+)+$/, "");
    byKey.set(`${k}|${x.table}`, [...(byKey.get(`${k}|${x.table}`) ?? []), x.label]);
  }
  for (const [k, labels] of byKey) {
    const twice = labels.filter((l, i) => labels.indexOf(l) !== i);
    r.expect(!twice.length, `${what}: no duplicate rows where duplicates are re-rolled (roll)`, `${k}: ${twice.join(", ")} twice`, rep, `${k.replace(/#\d+/g, "#N")} ${twice.join(",")}`);
  }
  void roundOff;
}
