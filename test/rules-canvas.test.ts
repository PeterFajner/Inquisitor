// The rules canvas's pure parts: diffs and conflict merging, regions, and
// the editor's blanks (src/client/rules).
import assert from "node:assert/strict";
import { test } from "node:test";
import { conflictFields, diffEntries, merge, textDiff } from "../src/client/rules/diff.ts";
import { blankEffect, blankEntry, freshId, idsIn, kebab } from "../src/client/rules/edit/blank.ts";
import { regionOf, shelfOf, shelfRanker } from "../src/client/rules/regions.ts";
import { Effect, Entry } from "../src/shared/rules/schema.ts";

const talent = (over: Record<string, unknown> = {}) =>
  ({ id: "athlete", kind: "talent", name: "Athlete", source: { page: 24, text: "t" }, text: "Runs.", ...over }) as Entry;

test("diffEntries: values, effects, created and deleted", () => {
  const a = talent();
  const b = talent({ text: "Runs fast.", points: 5, effects: [{ stat: "I", add: 5 }] });
  const d = diffEntries(a, b);
  assert.deepEqual(
    d.map((c) => c.type === "value" ? `${c.field}` : c.type),
    ["text", "points", "effects"],
  );
  const eff = d.find((c) => c.type === "effects");
  assert.ok(eff && eff.type === "effects" && eff.added.length === 1 && eff.removed.length === 0);
  assert.deepEqual(diffEntries(null, a), [{ type: "created" }]);
  assert.deepEqual(diffEntries(a, null), [{ type: "deleted" }]);
  assert.deepEqual(diffEntries(a, talent({ pos: [1, 2] })), [{ type: "pos", field: "pos" }]);
});

test("diffEntries: archetype sections by name, subtype stats", () => {
  const arch = (ws: string, effects: Effect[]) =>
    ({
      id: "a", kind: "archetype", name: "A", source: { page: 4 },
      subtypes: [{ id: "fighter", name: "Fighter", stats: { WS: ws, BS: "1", S: "1", T: "1", I: "1", Wp: "1", Sg: "1", Nv: "1", Ld: "1" } }],
      sections: [{ name: "Talents", effects }],
    }) as Entry;
  const d = diffEntries(arch("60+2D10", [{ talent: "dodge" }]), arch("65+2D10", [{ talent: "dodge" }, { talent: "leader" }]));
  assert.equal(d.length, 2);
  const sec = d.find((c) => c.type === "effects");
  assert.ok(sec && sec.type === "effects" && sec.label === "Talents" && sec.added.length === 1);
  const st = d.find((c) => c.type === "stats");
  assert.ok(st && st.type === "stats" && st.stats[0].stat === "WS" && st.stats[0].after === "65+2D10");
});

test("conflict: re-apply takes mine where I changed, theirs elsewhere", () => {
  const base = talent();
  const theirs = talent({ text: "Theirs." });
  const mine = talent({ points: 9 });
  const f = conflictFields(base, theirs, mine);
  assert.deepEqual(
    f.map((x) => [x.field, x.auto, x.both]),
    [["text", "theirs", false], ["points", "mine", false]],
  );
  const m = merge(theirs, mine, Object.fromEntries(f.map((x) => [x.field, x.auto])));
  assert.equal((m as { text: string }).text, "Theirs.");
  assert.equal(m.points, 9);
  // Both changed the same field: flagged, and mine by default.
  const both = conflictFields(base, theirs, talent({ text: "Mine." }));
  assert.deepEqual(both.map((x) => [x.field, x.auto, x.both]), [["text", "mine", true]]);
  // Deleted since: mine is restored whole.
  const restored = merge(null, mine, {});
  assert.equal(restored.points, 9);
});

test("textDiff keeps the changed words with a little context", () => {
  const d = textDiff("one two three four five six seven eight nine ten", "one two three four five SIX seven eight nine ten");
  assert.equal(d.removed, "six");
  assert.equal(d.added, "SIX");
  assert.ok(d.before.startsWith("…"));
  assert.ok(d.after.endsWith("…") || d.after.trim().length > 0);
});

test("regions by kind across every book; shelves are the book's groups", () => {
  assert.equal(regionOf(talent()), "talents");
  assert.equal(regionOf({ ...talent(), kind: "exotic" } as Entry), "talents");
  assert.equal(regionOf({ ...talent(), kind: "table", source: { page: 22 } } as unknown as Entry), "tables");
  assert.equal(regionOf({ ...talent(), kind: "rule", source: { page: 98 } } as unknown as Entry), "rules");
  assert.equal(shelfOf(talent(), "Loyalist"), "Talents");
  assert.equal(shelfOf(talent({ group: "Psyker Talents" }), "Loyalist"), "Psyker Talents");
  assert.equal(shelfOf({ ...talent(), kind: "rule" } as Entry, "Crone World"), "Crone World");
  assert.equal(shelfOf({ ...talent(), kind: "table", group: "Armour" } as unknown as Entry, "Dead or Alive"), "Armour");
  assert.equal(shelfOf({ ...talent(), kind: "archetype" } as unknown as Entry, "Loyalist"), "");
  // Book order: the first page the book has the shelf on (any kind), then articles' own shelves by pack.
  const rank = shelfRanker(
    [
      { pack: "loyalist", entry: talent({ group: "Psyker Talents", source: { page: 34 } }) },
      { pack: "loyalist", entry: talent({ source: { page: 24 } }) },
      { pack: "crone-world", entry: { ...talent(), kind: "rule", source: { page: 2 } } as Entry },
      { pack: "dead-or-alive", entry: { ...talent(), kind: "table", group: "Talents", source: { page: 3 } } as unknown as Entry },
    ],
    ["loyalist", "dead-or-alive", "crone-world"],
    (id) => (id === "crone-world" ? "Crone World" : id),
  );
  assert.ok(rank("talents", "Talents") < rank("talents", "Psyker Talents"));
  assert.equal(rank("tables", "Talents"), 24);
  assert.ok(rank("rules", "Crone World") > 1000);
});

test("blanks: ids are unique, every effect type's blank fits the schema once its references are chosen", () => {
  const used = idsIn({ sections: [{ effects: [{ id: "pick-1", pick: 1, from: [] }] }] });
  assert.equal(freshId("pick", used), "pick-2");
  assert.equal(kebab("Study Thy Weapon’s Edge"), "study-thy-weapons-edge");
  const types = ["stat", "pick", "optional", "chance", "when", "alignment", "gear", "powers", "armour", "restrict", "exclusive", "derived",
    "wielded", "remove", "reloads", "trade", "upgrade", "bionics", "weapon", "psyker", "location"];
  for (const t of types) {
    const e = blankEffect(t, new Set());
    const r = Effect.safeParse(e);
    assert.ok(r.success, `${t}: ${JSON.stringify(e)} ${r.success ? "" : r.error.message}`);
  }
  for (const k of ["talent", "item", "table", "rule", "archetype"] as const) {
    const e = { ...blankEntry(k), id: "x", name: "X" } as Record<string, unknown>;
    if (k === "archetype") (e.subtypes as { id: string; name: string }[])[0] = { ...(e.subtypes as object[])[0], id: "s", name: "S" } as never;
    if (k === "item") e.group = "Ranged Weapons";
    if (k === "talent" || k === "rule") e.text = "T";
    if (k === "table") (e.rows as { label: string }[])[0].label = "L";
    const r = Entry.safeParse(e);
    assert.ok(r.success, `${k}: ${r.success ? "" : r.error.message}`);
  }
});
