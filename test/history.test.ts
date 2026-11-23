// The history canvas's pure parts (src/client/history): the version tree's
// layout, the version summaries and their comparison, the numeric times.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadPack } from "../src/lib/rules-files.ts";
import { buildCompendium, type Compendium } from "../src/shared/rules/compendium.ts";
import { seededRoller } from "../src/shared/engine/rng.ts";
import * as ops from "../src/client/builder/ops.ts";
import { tidyTree, type TreeNode } from "../src/client/history/tree.ts";
import { compare, summarize, when } from "../src/client/history/summary.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const C: Compendium = buildCompendium(["base", "extra"].map((id) => loadPack(id, FIXTURES).pack!));

const W = 100;
const overlaps = (nodes: TreeNode[], pos: Map<string, { x: number; y: number }>) => {
  for (const a of nodes)
    for (const b of nodes) {
      if (a.id >= b.id) continue;
      const pa = pos.get(a.id)!;
      const pb = pos.get(b.id)!;
      if (pa.x === pb.x && pa.y < pb.y + b.h && pb.y < pa.y + a.h) return `${a.id} overlaps ${b.id}`;
    }
  return null;
};

test("tree: a straight history is a straight row", () => {
  const nodes: TreeNode[] = ["a", "b", "c", "d"].map((id, i, all) => ({ id, parent: i ? all[i - 1] : null, h: 50 + i * 10 }));
  const { positions, depth } = tidyTree(nodes, { w: W, gapX: 20 });
  assert.deepEqual(nodes.map((n) => positions.get(n.id)!.x), [0, 120, 240, 360]);
  assert.deepEqual(nodes.map((n) => depth.get(n.id)), [0, 1, 2, 3]);
  // Centres in line.
  const mids = nodes.map((n) => positions.get(n.id)!.y + n.h / 2);
  assert.ok(mids.every((m) => Math.abs(m - mids[0]) < 1e-9));
});

test("tree: branches fan out without overlapping, parent centred", () => {
  const nodes: TreeNode[] = [
    { id: "r", parent: null, h: 100 },
    { id: "a", parent: "r", h: 120 },
    { id: "b", parent: "r", h: 80 },
    { id: "c", parent: "r", h: 60 },
    { id: "a1", parent: "a", h: 200 },
    { id: "a2", parent: "a", h: 90 },
    { id: "b1", parent: "b", h: 300 },
    { id: "c1", parent: "c", h: 40 },
  ];
  const { positions, bounds } = tidyTree(nodes, { w: W, gapX: 20, gapY: 10 });
  assert.equal(overlaps(nodes, positions), null);
  const y = (id: string) => positions.get(id)!.y;
  const h = (id: string) => nodes.find((n) => n.id === id)!.h;
  // Children keep their order.
  assert.ok(y("a") < y("b") && y("b") < y("c"));
  assert.ok(y("a1") < y("a2") && y("a2") < y("b1") && y("b1") < y("c1"));
  // The root is centred on its first and last child.
  assert.ok(Math.abs(y("r") + h("r") / 2 - (y("a") + h("a") / 2 + y("c") + h("c") / 2) / 2) < 1e-9);
  // Packed by contour: b sits right under a's column, not under a's whole subtree.
  assert.ok(y("b") < y("a1") + h("a1") + y("a2") + h("a2"));
  assert.equal(Math.min(...[...positions.values()].map((p) => p.y)), 0);
  assert.equal(bounds.w, 3 * W + 2 * 20);
});

test("tree: missing parents and cycles become roots; deterministic", () => {
  const nodes: TreeNode[] = [
    { id: "x", parent: "gone", h: 40 },
    { id: "y", parent: "x", h: 40 },
    { id: "p", parent: "q", h: 40 },
    { id: "q", parent: "p", h: 40 },
  ];
  const a = tidyTree(nodes, { w: W });
  const b = tidyTree(nodes, { w: W });
  assert.deepEqual([...a.positions], [...b.positions]);
  assert.equal(a.positions.size, 4);
  assert.equal(overlaps(nodes, a.positions), null);
  assert.equal(tidyTree([], { w: W }).positions.size, 0);
});

test("tree: a long history lays out without recursion limits", () => {
  const nodes: TreeNode[] = Array.from({ length: 20_000 }, (_, i) => ({ id: `v${i}`, parent: i ? `v${i - 1}` : null, h: 30 }));
  const { positions } = tidyTree(nodes, { w: 10, gapX: 0 });
  assert.equal(positions.get("v19999")!.x, 199_990);
});

test("summary: compare in the book's terms", () => {
  const r = ops.create(C, "hero", "fighter", "random", { name: "Vex", roll: seededRoller(3) });
  const a = summarize(ops.view(C, r).character);
  assert.equal(a.name, "Vex");
  assert.equal(Object.keys(a.stats).length, 14);
  assert.equal(compare(a, a).changed, false);

  const ws = a.stats.WS as number;
  const up = ops.setStat(C, r, "WS", ws + 7);
  const thing = [...C.talents.keys()].find((id) => !a.things.some((t) => t.id === id))!;
  const more = ops.addThing(ops.rename(up, "Vex II"), "talent", thing);
  const b = summarize(ops.view(C, more).character);
  const d = compare(a, b);
  assert.ok(d.changed);
  assert.deepEqual(d.name, { from: "Vex", to: "Vex II" });
  assert.deepEqual(
    d.stats.find((s) => s.stat === "WS"),
    { stat: "WS", from: ws, to: ws + 7, dir: 1 },
  );
  assert.deepEqual(d.gained.map((t) => t.id), [thing]);
  assert.equal(d.lost.length, 0);
  const back = compare(b, a);
  assert.equal(back.stats.find((s) => s.stat === "WS")!.dir, -1);
  assert.deepEqual(back.lost.map((t) => t.id), [thing]);
});

test("when: numbers only", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  assert.equal(when("2026-11-23T11:55:00Z", now), "−0:05");
  assert.equal(when("2026-11-23T08:48:30Z", now), "−3:11");
  assert.equal(when("2026-11-23T12:00:30Z", now), "−0:00");
  assert.match(when("2026-11-01T12:00:00Z", now), /^2026-11-0[12]$/);
  assert.equal(when("nonsense", now), "");
});
