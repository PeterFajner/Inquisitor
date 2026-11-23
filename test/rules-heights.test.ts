// The rules canvas's stored card heights (src/client/rules/heights.ts).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fnv1a, heightKey, parseHeights, serializeHeights } from "../src/client/rules/heights.ts";

test("FNV-1a is the standard 32-bit hash", () => {
  assert.equal(fnv1a(""), "811c9dc5");
  assert.equal(fnv1a("a"), "e40c292c");
  assert.equal(fnv1a("foobar"), "bf9cf968");
});

test("a height's key changes with the card's content, width and edited mark", () => {
  const j = JSON.stringify({ kind: "talent", id: "x", name: "X" });
  const k = heightKey(j, 320, false);
  assert.equal(heightKey(j, 320, false), k);
  assert.notEqual(heightKey(j, 656, false), k);
  assert.notEqual(heightKey(j, 320, true), k);
  assert.notEqual(heightKey(j.replace("X", "Y"), 320, false), k);
});

test("stored heights round-trip for the same build only", () => {
  const h = new Map([["320:10:abcd", 180.5], ["656e:20:ef01", 402]]);
  const raw = serializeHeights("b1", h);
  assert.deepEqual(parseHeights(raw, "b1"), h);
  assert.equal(parseHeights(raw, "b2").size, 0);
  assert.equal(parseHeights(null, "b1").size, 0);
  assert.equal(parseHeights("{not json", "b1").size, 0);
  assert.deepEqual([...parseHeights(JSON.stringify({ build: "b1", h: { a: 3, b: "x", c: -1 } }), "b1")], [["a", 3]]);
});
