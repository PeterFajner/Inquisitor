// The rules database's packs and shelves (data/rules, when it's here): every
// pack has a short name, and the book's misc gear is shelved by its tables
// (p. 70–79: Common and Rare under Miscellaneous Equipment, then Exotic and
// Legendary on their own, as with melee weapons).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAllPacks } from "../src/lib/rules-files.ts";

const dir = join(import.meta.dirname, "../data/rules");
const packs = existsSync(dir) ? loadAllPacks(dir) : [];

test("every pack has a short name", { skip: !packs.length }, () => {
  for (const { pack } of packs) assert.ok(pack.short, pack.id);
  assert.equal(packs.find((p) => p.pack.id === "loyalist")?.pack.short, "Loyalist Edition");
});

test("misc gear: Exotic and Legendary on the book's tables' shelves, Common and Rare under Miscellaneous Equipment", { skip: !packs.length }, () => {
  const shelf: Record<string, string> = {
    Common: "Miscellaneous Equipment",
    Rare: "Miscellaneous Equipment",
    Exotic: "Exotic Miscellaneous Gear (D100 Roll)",
    Legendary: "Legendary Miscellaneous Gear (D100 Roll)",
  };
  const items = packs.flatMap((p) => p.entries).flatMap((e) => (e.kind === "item" ? [e] : []));
  const misc = items.filter((e) => Object.values(shelf).includes(e.group ?? ""));
  assert.ok(misc.length > 70);
  for (const e of misc) if (e.availability) assert.equal(e.group, shelf[e.availability], e.id);
  const group = (id: string) => items.find((e) => e.id === id)?.group;
  assert.equal(group("archeotech-wargear-exotic"), "Exotic Miscellaneous Gear (D100 Roll)");
  assert.equal(group("archeotech-wargear"), "Legendary Miscellaneous Gear (D100 Roll)");
});
