// The rules page's pure parts (src/client/rules/book.ts, and groupShelves in
// shelves.ts): the tabs' shelves and their Table of Contents, the columns,
// the address, where a link goes, and where the reader is.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { byDistance, cardAt, columnsIn, hashOf, linkTarget, masonry, parseHash } from "../src/client/rules/book.ts";
import { REGIONS } from "../src/client/rules/regions.ts";
import { groupShelves, layoutShelves, type ShelfCard } from "../src/client/rules/shelves.ts";

const regions = [{ id: "equipment", title: "Equipment" }, { id: "tables", title: "Tables" }, { id: "archetypes", title: "Character Archetypes" }];
const card = (id: string, name: string, region: string, shelf: string, h = 100, w = 320): ShelfCard => ({ id, name, region, shelf, h, w });
const deck: ShelfCard[] = [
  card("b", "Bolter", "equipment", "Ranged Weapons", 120),
  card("a", "Autogun", "equipment", "Ranged Weapons", 90),
  card("l", "lasgun", "equipment", "Ranged Weapons", 100),
  card("e", "’Ead Banger", "equipment", "Ranged Weapons", 100),
  card("c", "Chainsword", "equipment", "Melee Weapons", 80),
  card("x", "Axe", "equipment", "Melee Weapons", 140),
  card("t1", "Weapons Table", "tables", "Equipment", 400, 656),
  card("t2", "Common Armour", "tables", "Tables", 200),
  card("z", "Zealot", "archetypes", "", 300, 656),
  card("i", "Inquisitor", "archetypes", "", 300, 656),
  card("q", "Stray", "nowhere", "Lost"),
];
const rank = (_r: string, s: string) => ({ "Ranged Weapons": 39, "Melee Weapons": 48, Equipment: 38 })[s] ?? 1000;

test("groupShelves: region by region, shelves in book order, cards A–Z (as the canvas shelves them)", () => {
  const g = groupShelves(regions, deck, rank);
  assert.deepEqual(
    g.map((s) => [s.region, s.name, s.label, s.cards.map((c) => c.id).join("")]),
    [
      ["equipment", "Ranged Weapons", "Ranged Weapons", "abel"],
      ["equipment", "Melee Weapons", "Melee Weapons", "xc"],
      ["tables", "Equipment", "Equipment", "t1"],
      // A shelf named as its region has no label; nor have archetypes (no group).
      ["tables", "Tables", "", "t2"],
      ["archetypes", "", "", "iz"],
    ],
  );
  // The canvas's shelves are the same groups in the same order.
  const l = layoutShelves(regions, deck, { shelfRank: rank });
  assert.deepEqual(l.shelves.map((s) => s.ids.join("")), g.map((s) => s.cards.map((c) => c.id).join("")));
});

test("the tabs are the canvas's regions, in its order", () => {
  assert.deepEqual(REGIONS.map((r) => r.title), ["Character Archetypes", "Talents & Exotic Abilities", "Equipment", "Psychic Powers", "Mutations", "Tables", "Rules"]);
});

test("masonry: as many columns as fit, each card where it sits highest (ties left), wide cards spanning", () => {
  assert.equal(columnsIn(319), 1);
  assert.equal(columnsIn(320), 1);
  assert.equal(columnsIn(656), 2);
  assert.equal(columnsIn(1000), 3);
  const m = masonry(
    [
      { id: "a", w: 320, h: 100 },
      { id: "b", w: 320, h: 50 },
      { id: "c", w: 320, h: 80 },
      { id: "d", w: 320, h: 10 },
      { id: "w", w: 656, h: 40 },
    ],
    1000,
  );
  assert.equal(m.cols, 3);
  const at = (id: string) => m.pos.get(id)!;
  // a b c across, then d under b (the highest), then the wide one where two columns are lowest: b+d's and c's.
  assert.deepEqual([at("a"), at("b"), at("c")], [{ x: 0, y: 0, w: 320 }, { x: 336, y: 0, w: 320 }, { x: 672, y: 0, w: 320 }]);
  assert.deepEqual(at("d"), { x: 336, y: 66, w: 320 });
  assert.deepEqual(at("w"), { x: 336, y: 96, w: 656 });
  assert.equal(m.h, 136);
  assert.equal(m.w, 992);
  // No two overlap.
  const r = [...m.pos].map(([id, p]) => ({ ...p, h: { a: 100, b: 50, c: 80, d: 10, w: 40 }[id]! }));
  for (const p of r) for (const q of r) if (p !== q) assert.ok(!(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h));
  // One column: one under another in order; a card wider than the page is made as wide as the page.
  const one = masonry([{ id: "a", w: 320, h: 100 }, { id: "x", w: 992, h: 50 }], 600);
  assert.deepEqual([...one.pos.values()], [{ x: 0, y: 0, w: 320 }, { x: 0, y: 116, w: 600 }]);
  assert.deepEqual(masonry([], 600), { pos: new Map(), h: 0, w: 0, cols: 1 });
});

test("the address: a card's key or a tab", () => {
  const tabs = REGIONS.map((r) => r.id);
  const tabOf = (k: string) => (k === "loyalist:table/boons" ? "tables" : null);
  assert.equal(hashOf({ tab: "tables", key: "loyalist:table/boons" }), "#loyalist%3Atable%2Fboons");
  assert.equal(hashOf({ tab: "equipment", key: null }), "#equipment");
  assert.deepEqual(parseHash("#loyalist%3Atable%2Fboons", tabOf, tabs), { tab: "tables", key: "loyalist:table/boons" });
  // The canvas's links were the same, and an unencoded one still works.
  assert.deepEqual(parseHash("#loyalist:table/boons", tabOf, tabs), { tab: "tables", key: "loyalist:table/boons" });
  assert.deepEqual(parseHash("#equipment", tabOf, tabs), { tab: "equipment", key: null });
  assert.equal(parseHash("#loyalist:table/gone", tabOf, tabs), null);
  assert.equal(parseHash("#nowhere", tabOf, tabs), null);
  assert.equal(parseHash("", tabOf, tabs), null);
  assert.equal(parseHash("#%E0%A4%A", tabOf, tabs), null);
});

test("a link goes to the topmost shown book's entry, else nowhere", () => {
  const origin = new Map([["table/boons", "loyalist"], ["archetype/cherubim", "on-angels-wings"]]);
  assert.equal(linkTarget(origin, "table", "boons"), "loyalist:table/boons");
  assert.equal(linkTarget(origin, "archetype", "cherubim"), "on-angels-wings:archetype/cherubim");
  // A hidden book's (or a hidden entry's) card isn't there to go to.
  assert.equal(linkTarget(origin, "item", "lasgun"), null);
});

test("cardAt: the last card in reading order whose top has passed the line", () => {
  const tops = [{ id: "a", top: 100 }, { id: "b", top: 100 }, { id: "c", top: 400 }, { id: "d", top: 250 }];
  assert.equal(cardAt(tops, 50), "a");
  assert.equal(cardAt(tops, 100), "b");
  assert.equal(cardAt(tops, 300), "d");
  assert.equal(cardAt(tops, 1000), "d");
  assert.equal(cardAt([], 0), null);
});

test("byDistance: cards in view first (in order), then the nearest", () => {
  const cs = [
    { id: "far-above", top: 0, h: 100 },
    { id: "above", top: 800, h: 100 },
    { id: "in", top: 1000, h: 100 },
    { id: "in2", top: 1500, h: 600 },
    { id: "below", top: 2200, h: 100 },
    { id: "far-below", top: 5000, h: 100 },
  ];
  assert.deepEqual(byDistance(cs, 1000, 1800), ["in", "in2", "above", "below", "far-above", "far-below"]);
});
