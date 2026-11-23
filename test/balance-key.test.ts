// The server's balance key: rules content only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceKey } from "../src/lib/balance-key.ts";
import type { PackEntries } from "../src/shared/rules/compendium.ts";

const talent = (id: string, extra: object = {}) => ({ id, kind: "talent", name: id, source: { page: 1 }, ...extra }) as never;
const packs = (entries: never[], order: "ab" | "ba" = "ab"): PackEntries[] => {
  const book = { pack: { id: "book", name: "Book" }, entries };
  const article = { pack: { id: "article", name: "Article", extends: ["book"] }, entries: [talent("z")] };
  return order === "ab" ? [book, article] : [article, book];
};

test("balance key: card positions and reading order don't change it; content does", () => {
  const k = balanceKey(packs([talent("a"), talent("b")]));
  assert.equal(balanceKey(packs([talent("b"), talent("a")], "ba")), k);
  assert.equal(balanceKey(packs([talent("a", { pos: [10, 20] }), talent("b")])), k);
  assert.notEqual(balanceKey(packs([talent("a", { points: 3 }), talent("b")])), k);
});
