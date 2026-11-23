// The canvas engine's pure parts: transforms, culling, the fly path, wires
// and the region layout (src/client/canvas).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  contains, cull, facingSides, fitView, flyPath, intersects, miniMapping, panBy, snap, toScreen, toWorld, union, visibleRect, wirePath, zoomAt,
  type Rect, type View,
} from "../src/client/canvas/geometry.ts";
import { layoutRegions, type LayoutEntry } from "../src/client/canvas/layout.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const limits = { min: 0.05, max: 4 };

test("world and screen transforms are inverse", () => {
  const v: View = { x: 120, y: -40, k: 0.37 };
  for (const p of [{ x: 0, y: 0 }, { x: 1234.5, y: -987 }, { x: -3, y: 4 }]) {
    const back = toWorld(v, toScreen(v, p));
    near(back.x, p.x);
    near(back.y, p.y);
  }
  assert.deepEqual(toScreen({ x: 10, y: 20, k: 2 }, { x: 5, y: 5 }), { x: 20, y: 30 });
  assert.deepEqual(panBy({ x: 1, y: 2, k: 3 }, 10, -5), { x: 11, y: -3, k: 3 });
});

test("zooming keeps the point under the cursor fixed and respects limits", () => {
  const v: View = { x: 50, y: 70, k: 1 };
  const at = { x: 300, y: 200 };
  const before = toWorld(v, at);
  const z = zoomAt(v, at, 2.5, limits);
  near(z.k, 2.5);
  const after = toWorld(z, at);
  near(after.x, before.x);
  near(after.y, before.y);
  assert.equal(zoomAt(v, at, 100, limits).k, 4);
  assert.equal(zoomAt(v, at, 1e-6, limits).k, 0.05);
});

test("visibleRect is the viewport in world units, with a margin", () => {
  const v: View = { x: -200, y: -100, k: 2 };
  assert.deepEqual(visibleRect(v, { w: 800, h: 600 }), { x: 100, y: 50, w: 400, h: 300 });
  assert.deepEqual(visibleRect(v, { w: 800, h: 600 }, 20), { x: 90, y: 40, w: 420, h: 320 });
});

test("fitView centres the rect and fits it within the padding", () => {
  const r: Rect = { x: 1000, y: 500, w: 2000, h: 500 };
  const s = { w: 1000, h: 800 };
  const v = fitView(r, s, limits, 50);
  near(v.k, 0.45);
  const c = toScreen(v, { x: 2000, y: 750 });
  near(c.x, 500);
  near(c.y, 400);
  const vis = visibleRect(v, s);
  assert.ok(contains(vis, r));
  // A tiny rect stops at the max zoom.
  assert.equal(fitView({ x: 0, y: 0, w: 1, h: 1 }, s, limits).k, 4);
});

test("culling keeps what meets the rect, in order", () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, r: { x: (i % 40) * 300, y: Math.floor(i / 40) * 200, w: 280, h: 180 } }));
  const view: Rect = { x: 900, y: 400, w: 1000, h: 500 };
  const got = cull(items, (t) => t.r, view);
  assert.ok(got.length > 0 && got.length < 40);
  for (const t of got) assert.ok(intersects(t.r, view));
  for (const t of items) if (!got.includes(t)) assert.ok(!intersects(t.r, view));
  assert.deepEqual(got.map((t) => t.id), [...got.map((t) => t.id)].sort((a, b) => a - b));
  // Edges that only touch don't count.
  assert.ok(!intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }));
});

test("union, contains, snap", () => {
  assert.equal(union([]), null);
  assert.deepEqual(union([{ x: 0, y: 0, w: 10, h: 10 }, { x: -5, y: 20, w: 5, h: 5 }]), { x: -5, y: 0, w: 15, h: 25 });
  assert.ok(contains({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 3, h: 3 }));
  assert.ok(!contains({ x: 0, y: 0, w: 10, h: 10 }, { x: 8, y: 2, w: 3, h: 3 }));
  assert.deepEqual(snap({ x: 23, y: -14 }, 10), { x: 20, y: -10 });
  assert.deepEqual(snap({ x: 23, y: -14 }), { x: 23, y: -14 });
});

test("flyPath starts and ends at the views and zooms out on long flights", () => {
  const s = { w: 1000, h: 800 };
  const a: View = { x: 0, y: 0, k: 1 };
  const b: View = { x: -20000, y: -5000, k: 1 };
  const f = flyPath(a, b, s);
  const v0 = f.at(0), v1 = f.at(1);
  near(v0.k, 1);
  near(v0.x, 0, 1e-3);
  assert.deepEqual(v1, b);
  assert.ok(f.at(0.5).k < 0.5, "zoomed out mid-flight");
  assert.ok(f.ms >= 250 && f.ms <= 1400);
  // Zoom only.
  const z = flyPath(a, { x: -500, y: -400, k: 2 }, s);
  near(z.at(1).k, 2);
  near(z.at(0.5).k, Math.SQRT2);
});

test("wires leave by facing sides and their box holds both ends", () => {
  const a: Rect = { x: 0, y: 0, w: 100, h: 50 };
  const b: Rect = { x: 400, y: 20, w: 100, h: 50 };
  assert.deepEqual(facingSides(a, b), ["right", "left"]);
  assert.deepEqual(facingSides(b, a), ["left", "right"]);
  assert.deepEqual(facingSides(a, { x: 0, y: 300, w: 100, h: 50 }), ["bottom", "top"]);
  const w = wirePath(a, b);
  assert.match(w.d, /^M100,25 C[\d.,\- ]+ 400,45$/);
  assert.ok(contains(w.box, { x: 100, y: 25, w: 300, h: 20 }));
  assert.match(wirePath(a, b, ["bottom", "top"]).d, /^M50,50 /);
});

test("miniMapping fits the world into the box", () => {
  const m = miniMapping({ x: -100, y: 0, w: 2000, h: 1000 }, { w: 212, h: 150 }, 6);
  near(m.s, 0.1);
  near(-100 * m.s + m.ox, 6);
  near(500 * m.s + m.oy, 75);
});

const entries = (n: number, region: string, seed = 1): LayoutEntry[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${region}-${i}`, region, h: 60 + ((i * 37 + seed * 11) % 140) }));

test("layout: masonry by height, in order, deterministic, no overlaps", () => {
  const regions = [{ id: "a", columns: 3 }, { id: "b" }, { id: "c" }];
  const list = [...entries(30, "a"), ...entries(50, "b", 2), ...entries(7, "c", 3)];
  const opts = { columnWidth: 280, gap: 16, padding: 32, header: 0, regionGap: 120 };
  const l1 = layoutRegions(regions, list, opts);
  const l2 = layoutRegions(regions, [...list], opts);
  assert.deepEqual([...l1.positions], [...l2.positions]);
  assert.deepEqual([...l1.regions], [...l2.regions]);
  assert.equal(l1.positions.size, list.length);

  const rects = list.map((e) => ({ ...l1.positions.get(e.id)!, w: 280, h: e.h }));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!intersects(rects[i], rects[j]), `${list[i].id} overlaps ${list[j].id}`);
  // Every card sits inside its region, regions don't overlap.
  list.forEach((e, i) => assert.ok(contains(l1.regions.get(e.region)!, rects[i]), e.id));
  const [ra, rb, rc] = ["a", "b", "c"].map((id) => l1.regions.get(id)!);
  assert.ok(!intersects(ra, rb) && !intersects(rb, rc));
  assert.ok(rb.x > ra.x && rc.x > rb.x, "regions run left to right");
  // Region a has the 3 columns asked for.
  assert.equal(new Set(entries(30, "a").map((e) => l1.positions.get(e.id)!.x)).size, 3);
  assert.equal(ra.w, 2 * 32 + 3 * 280 + 2 * 16);
  // The first three go across the top in order; the fourth under the shortest.
  const a = (i: number) => l1.positions.get(`a-${i}`)!;
  assert.deepEqual([a(0).y, a(1).y, a(2).y], [32, 32, 32]);
  assert.ok(a(0).x < a(1).x && a(1).x < a(2).x);
  const hs = entries(3, "a").map((e) => e.h);
  const shortest = hs.indexOf(Math.min(...hs));
  assert.equal(a(3).x, a(shortest).x);
  assert.equal(a(3).y, 32 + hs[shortest] + 16);
});

test("layout: auto columns aim at the aspect; rows wrap; wide entries span", () => {
  const l = layoutRegions([{ id: "a" }], entries(200, "a"), { columnWidth: 280, aspect: 16 / 10 });
  const r = l.regions.get("a")!;
  assert.ok(r.w / r.h > 1.1 && r.w / r.h < 2.3, `aspect ${r.w / r.h}`);

  const wrapped = layoutRegions([{ id: "a", columns: 2 }, { id: "b", columns: 2 }, { id: "c", columns: 2 }], [...entries(4, "a"), ...entries(4, "b"), ...entries(4, "c")], {
    columnWidth: 100, rowWidth: 700, regionGap: 50,
  });
  const [ra, rb, rc] = ["a", "b", "c"].map((id) => wrapped.regions.get(id)!);
  assert.equal(ra.y, rb.y);
  assert.ok(rc.y > ra.y + Math.max(ra.h, rb.h), "third region on a new row");
  assert.equal(rc.x, 0);
  assert.deepEqual(wrapped.bounds, union([ra, rb, rc]));

  const span = layoutRegions([{ id: "a", columns: 3 }], [{ id: "x", region: "a", h: 50 }, { id: "wide", region: "a", h: 50, w: 216 }], { columnWidth: 100, gap: 16, padding: 0 });
  // The wide one needs two columns: it goes in columns 1-2, beside x.
  assert.deepEqual(span.positions.get("wide"), { x: 116, y: 0 });
  // Unknown regions are ignored, empty regions still get a rect.
  const e = layoutRegions([{ id: "a" }, { id: "empty" }], [{ id: "lost", region: "nope", h: 10 }], { columnWidth: 100 });
  assert.equal(e.positions.size, 0);
  assert.ok(e.regions.get("empty"));
});
