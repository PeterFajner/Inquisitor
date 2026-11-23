// What changes for a character when the rules change: build the record
// against the old and the new compendium and compare. For the "rules
// changed, update?" prompt.
import type { Compendium } from "../rules/compendium.ts";
import { STATS, type Alignment, type Stat } from "../rules/schema.ts";
import { build, type BuildMode, type Character, type PendingChoice } from "./build.ts";
import type { CharacterRecord, ThingKind } from "./record.ts";

export type ThingChange = { kind: ThingKind; id: string; name: string; qty?: number };

export type CharacterDiff = {
  changed: boolean;
  stats: { stat: Stat; from: number; to: number }[]; // final values
  alignment?: { from?: Alignment; to?: Alignment };
  gained: ThingChange[];
  lost: ThingChange[];
  options: { gained: { id: string; name: string }[]; lost: { id: string; name: string }[] };
  rolls: { gained: string[]; lost: string[] }; // table row labels
  needsRolling: { key: string; label: string }[]; // dice the record lacks under the new rules
  pending: PendingChoice[]; // choices the record lacks under the new rules
  dropped: string[]; // record keys the new rules no longer use
  warnings: string[]; // the new build's warnings not in the old one
};

// Dice the record lacks are shown at a middle face while the update is
// only being previewed; they are rolled for real on update.
const middle = (sides: number) => Math.ceil(sides / 2);

const things = (ch: Character): Map<string, ThingChange> => {
  const m = new Map<string, ThingChange>();
  for (const list of [ch.talents, ch.exotics, ch.mutations, ch.powers]) {
    for (const t of list) m.set(`${t.kind}/${t.id}`, { kind: t.kind, id: t.id, name: t.name });
  }
  for (const t of ch.items) m.set(`item/${t.id}`, { kind: "item", id: t.id, name: t.name, qty: t.qty });
  return m;
};

const multiset = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};
const minus = (a: string[], b: string[]) => {
  const mb = multiset(b);
  return a.filter((x) => {
    const n = mb.get(x) ?? 0;
    if (n > 0) {
      mb.set(x, n - 1);
      return false;
    }
    return true;
  });
};

export function diff(
  oldC: Compendium,
  newC: Compendium,
  record: CharacterRecord,
  opts: { mode?: BuildMode } = {},
): CharacterDiff {
  const mode = opts.mode ?? "freeform";
  const before = build(oldC, record, { mode, roll: middle });
  const after = build(newC, record, { mode, roll: middle });
  const a = before.character;
  const b = after.character;
  const stats = STATS.filter((s) => a.stats[s].final !== b.stats[s].final).map((s) => ({
    stat: s,
    from: a.stats[s].final,
    to: b.stats[s].final,
  }));
  const ta = things(a);
  const tb = things(b);
  const gained: ThingChange[] = [];
  const lost: ThingChange[] = [];
  for (const [k, t] of tb) {
    const o = ta.get(k);
    if (!o) gained.push(t);
    else if (t.qty !== undefined && o.qty !== undefined && t.qty > o.qty) gained.push({ ...t, qty: t.qty - o.qty });
  }
  for (const [k, t] of ta) {
    const n = tb.get(k);
    if (!n) lost.push(t);
    else if (t.qty !== undefined && n.qty !== undefined && t.qty > n.qty) lost.push({ ...t, qty: t.qty - n.qty });
  }
  const optA = a.options.map((o) => ({ id: o.id, name: o.name }));
  const optB = b.options.map((o) => ({ id: o.id, name: o.name }));
  const rollsA = a.rolls.map((r) => r.label);
  const rollsB = b.rolls.map((r) => r.label);
  const needsRolling = after.log
    .filter((e) => e.type === "dice" && !e.reused)
    .map((e) => ({ key: e.key, label: e.label }));
  const used = new Set([...Object.keys(after.record.dice), ...Object.keys(after.record.choices)]);
  const dropped = [...Object.keys(record.dice), ...Object.keys(record.choices)].filter((k) => !used.has(k));
  const warnings = after.warnings.filter((w) => !before.warnings.includes(w));
  const d: CharacterDiff = {
    changed: false,
    stats,
    gained,
    lost,
    options: {
      gained: optB.filter((o) => !optA.some((x) => x.id === o.id)),
      lost: optA.filter((o) => !optB.some((x) => x.id === o.id)),
    },
    rolls: { gained: minus(rollsB, rollsA), lost: minus(rollsA, rollsB) },
    needsRolling,
    pending: after.pending,
    dropped: [...new Set(dropped)],
    warnings,
  };
  if (a.alignment !== b.alignment) d.alignment = { from: a.alignment, to: b.alignment };
  d.changed =
    stats.length > 0 ||
    !!d.alignment ||
    gained.length > 0 ||
    lost.length > 0 ||
    d.options.gained.length > 0 ||
    d.options.lost.length > 0 ||
    d.rolls.gained.length > 0 ||
    d.rolls.lost.length > 0 ||
    needsRolling.length > 0 ||
    d.pending.length > 0 ||
    d.dropped.length > 0;
  return d;
}
