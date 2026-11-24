// The rules canvas's shelves layout (src/client/rules/shelves.ts): regions
// by kind, the book's groups as shelves, cards A–Z down balanced columns,
// reflow when books are hidden, the A–Z index, wire routes.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { matches } from "../src/client/rules/find.ts";
import { anchorOf, columns, indexAt, indexLayout, keepStill, layoutShelves, route, wrap, type ShelfCard } from "../src/client/rules/shelves.ts";

const regions = [{ id: "items", title: "Equipment" }, { id: "tables", title: "Tables" }];
const card = (id: string, name: string, region: string, shelf: string, h = 100, w = 320): ShelfCard => ({ id, name, region, shelf, h, w });
const deck: ShelfCard[] = [
  card("b", "Bolter", "items", "Ranged Weapons", 120),
  card("a", "Autogun", "items", "Ranged Weapons", 90),
  card("l", "lasgun", "items", "Ranged Weapons", 100),
  card("e", "’Ead Banger", "items", "Ranged Weapons", 100),
  card("c", "Chainsword", "items", "Melee Weapons", 80),
  card("x", "Axe", "items", "Melee Weapons", 140),
  card("f", "Flak", "items", "Armour", 60),
  card("t1", "Weapons Table", "tables", "Equipment", 400, 656),
  card("t2", "Common Armour", "tables", "Armour", 200),
  card("t3", "Rare Armour", "tables", "Armour", 220),
];
const rank = (_r: string, s: string) => ({ "Ranged Weapons": 39, "Melee Weapons": 48, Armour: 57, Equipment: 38 })[s] ?? 1000;
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("columns: in order, the tallest column as low as can be, each as wide as its widest card", () => {
  const cs = [10, 10, 10, 50, 10, 10].map((h, i) => ({ id: String(i), w: i === 3 ? 600 : 300, h }));
  const p = columns(cs, 2, 0, 20);
  assert.deepEqual(p.cols.map((c) => c.ids), [["0", "1", "2"], ["3", "4", "5"]]);
  assert.equal(p.h, 70);
  assert.equal(p.w, 300 + 20 + 600);
  assert.equal(columns(cs, 1, 5, 20).h, 100 + 25);
  // No more columns than lower the tallest (it can't be lower than the tallest card).
  assert.equal(columns(cs, 99, 0, 0).h, 50);
  assert.deepEqual(columns([], 3, 0, 0), { cols: [], w: 0, h: 0 });
});

test("shelves: the book's groups in book order, cards A–Z down the columns, no overlaps", () => {
  const l = layoutShelves(regions, deck, { shelfRank: rank });
  assert.deepEqual(l.shelves.map((s) => s.id), ["items/Ranged Weapons", "items/Melee Weapons", "items/Armour", "tables/Equipment", "tables/Armour"]);
  // A–Z, case aside.
  assert.deepEqual(l.shelves[0].ids, ["a", "b", "e", "l"]);
  assert.deepEqual(l.shelves[1].ids, ["x", "c"]);
  // Read down each column, then the next: column order is A–Z order.
  for (const s of l.shelves) assert.deepEqual(s.cols.flatMap((c) => c.ids), s.ids);
  // Shelves stack top to bottom within their region; regions stand side by side.
  const items = l.regions.get("items")!, tables = l.regions.get("tables")!;
  assert.ok(tables.x >= items.x + items.w);
  // Within a stack one below the other; the next stack to the right.
  for (let i = 1; i < 3; i++) {
    const [a, b] = [l.shelves[i - 1], l.shelves[i]];
    if (a.stack === b.stack) assert.ok(b.y >= a.y + a.h);
    else assert.ok(b.stack > a.stack && b.x >= a.x + a.w);
  }
  const rects = deck.map((c) => ({ ...l.positions.get(c.id)!, w: c.w, h: c.h }));
  for (let i = 0; i < rects.length; i++) {
    const c = deck[i], r = l.regions.get(c.region)!;
    assert.ok(rects[i].x >= r.x && rects[i].x + rects[i].w <= r.x + r.w && rects[i].y >= r.y && rects[i].y + rects[i].h <= r.y + r.h, `${c.id} in its region`);
    const s = l.shelves[l.place.get(c.id)!.shelf];
    assert.ok(rects[i].y >= s.top, `${c.id} below its shelf's label`);
    for (let j = 0; j < i; j++) assert.ok(!overlaps(rects[i], rects[j]), `${deck[i].id} overlaps ${deck[j].id}`);
  }
  // A shelf named as its region has no label.
  const same = layoutShelves([{ id: "m", title: "Mutations" }], [card("m1", "Beaked", "m", "Mutations")]);
  assert.equal(same.shelves[0].label, "");
  assert.equal(same.shelves[0].top, same.shelves[0].y);
  // Deterministic.
  assert.deepEqual([...layoutShelves(regions, [...deck].reverse(), { shelfRank: rank }).positions], [...l.positions]);
});

test("shelves: the board comes out about as wide as the aspect asks", () => {
  const many: ShelfCard[] = [];
  for (let i = 0; i < 300; i++) many.push(card(`i${i}`, `Item ${i}`, "items", ["A", "B", "C"][i % 3], 80 + ((i * 37) % 200)));
  for (let i = 0; i < 60; i++) many.push(card(`t${i}`, `Table ${i}`, "tables", "Armour", 150 + ((i * 53) % 400)));
  for (const aspect of [1, 1.6, 3]) {
    const l = layoutShelves(regions, many, { aspect });
    const r = l.bounds.w / l.bounds.h;
    assert.ok(r > aspect / 1.6 && r < aspect * 1.6, `aspect ${aspect}: ${r}`);
  }
});

test("reflow: hiding a book's cards closes the gaps, keeps A–Z, and the anchor card stays still on screen", () => {
  const before = layoutShelves(regions, deck, { shelfRank: rank });
  const shown = deck.filter((c) => c.id !== "a" && c.id !== "t2" && c.id !== "e");
  const after = layoutShelves(regions, shown, { shelfRank: rank });
  assert.deepEqual(after.shelves[0].ids, ["b", "l"]);
  assert.ok(!after.positions.has("a"));
  assert.equal(after.shelves.find((s) => s.id === "tables/Armour")!.ids.length, 1);
  // Every card is placed and none overlap.
  const rects = shown.map((c) => ({ ...after.positions.get(c.id)!, w: c.w, h: c.h }));
  for (let i = 0; i < rects.length; i++) for (let j = 0; j < i; j++) assert.ok(!overlaps(rects[i], rects[j]));
  // The card under the centre (here: "b") is kept where it was on screen.
  const size = (id: string) => deck.find((c) => c.id === id) ?? null;
  const pb = before.positions.get("b")!;
  const view = { x: 400 - (pb.x + 10) * 0.5, y: 300 - (pb.y + 10) * 0.5, k: 0.5 };
  const stays = (id: string) => id !== "a" && id !== "t2" && id !== "e";
  const anchor = anchorOf(before.positions, size, stays, view, { w: 800, h: 600 }, null);
  assert.equal(anchor, "b");
  const v2 = keepStill(view, before.positions.get("b")!, after.positions.get("b")!);
  const scr = (v: typeof view, p: { x: number; y: number }) => ({ x: p.x * v.k + v.x, y: p.y * v.k + v.y });
  assert.deepEqual(scr(v2, after.positions.get("b")!), scr(view, before.positions.get("b")!));
  // The selected card wins while it's in view and stays; a hidden one doesn't.
  assert.equal(anchorOf(before.positions, size, stays, view, { w: 800, h: 600 }, "l"), "l");
  assert.equal(anchorOf(before.positions, size, stays, view, { w: 800, h: 600 }, "a"), "b");
});

test("index: shelves' labels as headings over their names A–Z, in columns, hit-tested by point", () => {
  const names = (l: string[]) => l.map((n) => ({ id: n, name: n }));
  const groups = [{ label: "Ranged Weapons", items: names(["Autogun", "Bolter", "Hellgun", "Lasgun"]) }, { label: "Armour", items: names(["Carapace", "Flak"]) }];
  const wide = indexLayout({ x: 0, y: 0, w: 3000, h: 400 }, groups);
  const tall = indexLayout({ x: 0, y: 0, w: 400, h: 3000 }, groups);
  assert.ok(wide.size > 0 && tall.size > 0);
  assert.deepEqual(tall.items.map((i) => i.name), ["Ranged Weapons", "Autogun", "Bolter", "Hellgun", "Lasgun", "Armour", "Carapace", "Flak"]);
  assert.deepEqual(tall.items.filter((i) => i.heading).map((i) => i.id), [null, null]);
  // One column when tall: read straight down.
  assert.ok(tall.items.every((it, i) => !i || it.y > tall.items[i - 1].y));
  // Within the area; several columns when wide, and no heading at a column's foot.
  assert.ok(wide.items.every((it) => it.y + wide.line <= 400 + 1e-6 && it.x + it.w <= 3000 + 1e-6));
  assert.ok(new Set(wide.items.map((i) => Math.round(i.x - (i.heading ? 0 : wide.size)))).size > 1);
  const foot = Math.max(...wide.items.map((i) => i.y));
  assert.ok(wide.items.every((i) => !i.heading || i.y < foot));
  const it = wide.items.find((i) => i.name === "Lasgun")!;
  assert.equal(indexAt(wide, { x: it.x + 1, y: it.y + 1 })?.id, "Lasgun");
  const h = wide.items[0];
  assert.equal(indexAt(wide, { x: h.x + 1, y: h.y + 1 }), null);
  assert.equal(indexLayout({ x: 0, y: 0, w: 100, h: 100 }, []).items.length, 0);
});

test("titles wrap by word within the card", () => {
  assert.deepEqual(wrap("Bolter", 36, 300), ["Bolter"]);
  const lines = wrap("Random Special Ammunition By Weapon Type", 36, 300);
  assert.ok(lines.length >= 2 && lines.length <= 3);
  assert.equal(lines.join(" "), "Random Special Ammunition By Weapon Type");
});

test("wires run at right angles, outside every card but their own ends", () => {
  const l = layoutShelves(regions, deck, { shelfRank: rank });
  const rectOf = (id: string) => {
    const c = deck.find((d) => d.id === id);
    const p = l.positions.get(id);
    return c && p ? { ...p, w: c.w, h: c.h } : null;
  };
  for (const [a, b] of [["b", "t2"], ["a", "l"], ["f", "x"], ["t1", "t3"], ["c", "t1"]]) {
    const ps = route(l, a, b, rectOf)!;
    assert.ok(ps && ps.length >= 2, `${a}→${b}`);
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i].x === ps[i - 1].x || ps[i].y === ps[i - 1].y, `${a}→${b} segment ${i} isn't straight`);
    // Inner segments touch no card (the first and last leave and enter their own).
    for (let i = 2; i < ps.length - 1; i++) {
      const s = { x: Math.min(ps[i].x, ps[i - 1].x), y: Math.min(ps[i].y, ps[i - 1].y), w: Math.abs(ps[i].x - ps[i - 1].x) + 0.01, h: Math.abs(ps[i].y - ps[i - 1].y) + 0.01 };
      for (const c of deck) assert.ok(!overlaps(s, rectOf(c.id)!), `${a}→${b} crosses ${c.id}`);
    }
  }
});

test("wires stay in the gutters on a board with several stacks of shelves per region", () => {
  const many: ShelfCard[] = [];
  for (let i = 0; i < 120; i++) many.push(card(`i${i}`, `Item ${i}`, "items", ["Pistols", "Armour", "Bionics", "Stimms", "Gear"][i % 5], 80 + ((i * 37) % 300)));
  many.push(card("tall", "Gizmo", "items", "Gear", 4000));
  for (let i = 0; i < 30; i++) many.push(card(`t${i}`, `Table ${i}`, "tables", ["Armour", "Equipment", "Mutations"][i % 3], 150 + ((i * 53) % 400), i % 4 ? 320 : 656));
  const l = layoutShelves(regions, many);
  assert.ok(l.stacks.filter((s) => s.region === "items").length > 1, "items take more than one stack");
  const rectOf = (id: string) => {
    const c = many.find((d) => d.id === id);
    const p = l.positions.get(id);
    return c && p ? { ...p, w: c.w, h: c.h } : null;
  };
  const ids = many.map((c) => c.id);
  for (let n = 0; n < 300; n++) {
    const a = ids[(n * 7919) % ids.length], b = ids[(n * 104729 + 13) % ids.length];
    if (a === b) continue;
    const ps = route(l, a, b, rectOf)!;
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i].x === ps[i - 1].x || ps[i].y === ps[i - 1].y);
    for (let i = 2; i < ps.length - 1; i++) {
      const s = { x: Math.min(ps[i].x, ps[i - 1].x), y: Math.min(ps[i].y, ps[i - 1].y), w: Math.abs(ps[i].x - ps[i - 1].x) + 0.01, h: Math.abs(ps[i].y - ps[i - 1].y) + 0.01 };
      for (const c of many) assert.ok(!overlaps(s, rectOf(c.id)!), `${a}→${b} crosses ${c.id}`);
    }
  }
});

test("search: names holding the query, those starting with it first, then a word starting with it, A–Z", () => {
  const c = (name: string, book = "Loyalist") => ({ key: `${book}:${name}`, name, kind: "item" as const, mark: null, book });
  const cards = [c("Heavy Bolter"), c("Bolt Pistol"), c("Bolter"), c("Psycannon Bolts"), c("Thunderbolt"), c("Lasgun"), c("Bolter", "Article")];
  assert.deepEqual(matches(cards, "bolt").map((x) => x.name), ["Bolt Pistol", "Bolter", "Bolter", "Heavy Bolter", "Psycannon Bolts", "Thunderbolt"]);
  assert.deepEqual(matches(cards, "  BOLTER ").map((x) => x.book), ["Article", "Loyalist", "Loyalist"]);
  assert.deepEqual(matches([c("Émpyrean Blade")], "empyrean").length, 1);
  assert.deepEqual(matches(cards, ""), []);
  assert.equal(matches(cards, "o", 2).length, 2);
});
