// The card layout engine (src/shared/layout) and the card sizes' keys
// (src/client/rules/sizes.ts). Whole cards against Chrome: npm run heights:check.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createLayout } from "../src/shared/layout/box.ts";
import { parseCss, computeStyle, ROOT_STYLE } from "../src/shared/layout/css.ts";
import { createRoot, type FElement } from "../src/shared/layout/dom.ts";
import { breakBetween, faceFor, textWidth } from "../src/shared/layout/text.ts";
import { contentKey, depsHash, depValue, fnv1a, holds, recordingNames, widthsFor, COL, WIDE, XWIDE } from "../src/client/rules/sizes.ts";
import type { Names } from "../src/client/rules/ctx.ts";
import type { Entry } from "../src/shared/rules/schema.ts";

/** A tree from [tag, class, ...children] (strings are text). */
type Spec = string | [string, string, ...Spec[]];
function el(spec: Spec, parent?: FElement): FElement {
  if (typeof spec === "string") throw new Error("root must be an element");
  const [tag, cls, ...kids] = spec;
  const e = createRoot(tag);
  if (cls) e.setAttribute("class", cls);
  for (const k of kids) {
    if (typeof k === "string") e.appendChild(e.ownerDocument.createTextNode(k));
    else el(k, e);
  }
  parent?.appendChild(e);
  return e;
}

const BASE = `* { box-sizing: border-box } body { font: 16px/1.4 "Ubuntu" }`;

test("text widths are the fonts' advances; weights match as CSS does", () => {
  const regular = faceFor('"Ubuntu", sans-serif', 400, "normal");
  assert.equal(regular.key, "Ubuntu 400 normal");
  assert.equal(faceFor("Ubuntu", 600, "normal").key, "Ubuntu 700 normal");
  assert.equal(faceFor("Ubuntu", 650, "italic").key, "Ubuntu 700 italic");
  assert.equal(faceFor("Ubuntu", 450, "normal").key, "Ubuntu 500 normal");
  // Ubuntu's figures are all 0.564 em.
  assert.equal(Math.round(textWidth(regular, 13, "0123") * 1000) / 1000, 29.328);
  // ≤ comes from the math subset; a character no face has counts a full em.
  assert.ok(textWidth(regular, 10, "≤") > 5);
  assert.equal(textWidth(regular, 10, "➔"), 10);
});

test("line breaks: spaces, hyphens, dashes, never a slash", () => {
  assert.equal(breakBetween("a", "-"), false);
  assert.equal(breakBetween("-", "a"), true);
  assert.equal(breakBetween("-", "3", " "), false);
  assert.equal(breakBetween("-", "3", "4"), true);
  assert.equal(breakBetween("–", "1"), true);
  assert.equal(breakBetween("a", "—"), true);
  assert.equal(breakBetween("/", "a"), false);
  assert.equal(breakBetween(")", "("), true);
  assert.equal(breakBetween("a", "("), false);
});

test("the cascade: specificity, order, the browser's defaults below the app's, inheritance", () => {
  const sheet = parseCss("button { padding: 9px } span { display: inline }", undefined, 0);
  parseCss(`.a .b { font-size: 20px } .b { font-size: 10px; padding: 1px 2px } .c > .b { line-height: 1.5 } .x:first-of-type { display: none }`, sheet, 1);
  const root = el(["div", "a c", ["button", "b"], ["span", "x"], ["span", "x"]]);
  const s0 = computeStyle(sheet, root, ROOT_STYLE);
  const b = computeStyle(sheet, root.childNodes[0] as FElement, s0);
  assert.equal(b.fontSize, 20);
  assert.equal(b.lineHeight, 1.5);
  assert.deepEqual(b.padding.map((p) => (typeof p === "object" ? p.px : p)), [1, 2, 1, 2]);
  assert.equal(computeStyle(sheet, root.childNodes[1] as FElement, s0).display, "none");
  assert.equal(computeStyle(sheet, root.childNodes[2] as FElement, s0).display, "inline");
});

test("block text: lines of the floored line height, wrapped at the width, newlines kept with pre-line", () => {
  const layout = createLayout(`${BASE} .t { font: 13px/1.4 Ubuntu } .p { white-space: pre-line }`);
  const body = el(["body", ""]);
  const one = el(["div", "t", "Hello"], body);
  assert.equal(layout.height(one, 300), 18.1875); // 13 × 1.4 = 18.2, floored to 1/64 px
  const words = "word ".repeat(40).trim();
  const many = el(["div", "t", words], body);
  const w = textWidth(faceFor("Ubuntu", 400, "normal"), 13, "word word word word word");
  // Five words a line at that width: 40 words, 8 lines.
  assert.equal(layout.height(many, Math.ceil(w)), 8 * 18.1875);
  const pre = el(["div", "t p", "one\ntwo\n\nfour"], body);
  assert.equal(layout.height(pre, 300), 4 * 18.1875);
  // Without pre-line, newlines are spaces.
  assert.equal(layout.height(el(["div", "t", "one\ntwo"], body), 300), 18.1875);
});

test("flex rows wrap their items; padding, gaps and min-height count", () => {
  const layout = createLayout(`${BASE}
    .flow { display: flex; flex-wrap: wrap; gap: 4px; font: 12px/1.5 Ubuntu }
    .chip { display: inline-flex; padding: 1px 7px; min-height: 22px }
    .col { display: flex; flex-direction: column; gap: 8px; padding: 10px }`);
  const body = el(["body", ""]);
  const chips = (n: number) => el(["div", "flow", ...Array.from({ length: n }, () => ["span", "chip", "Chip"] as Spec)], body);
  const chipW = textWidth(faceFor("Ubuntu", 400, "normal"), 12, "Chip") + 14;
  assert.equal(layout.height(chips(1), 300), 22);
  // Three to a line.
  assert.equal(layout.height(chips(6), Math.ceil(3 * chipW + 8)), 22 + 4 + 22);
  const col = el(["div", "col", ["div", "flow", ["span", "chip", "a"]], ["div", "flow", ["span", "chip", "b"]]], body);
  assert.equal(layout.height(col, 300), 10 + 22 + 8 + 22 + 10);
});

test("grids: a fixed and a flexible column, rows as tall as their tallest item", () => {
  const layout = createLayout(`${BASE} .g { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 4px 10px; font: 10px/2 Ubuntu } .full { grid-column: 1 / -1 }`);
  const body = el(["body", ""]);
  const g = el(["div", "g", ["div", "", "a"], ["div", "", "b ".repeat(1) + "x"], ["div", "full", "c"]], body);
  assert.equal(layout.height(g, 200), 20 + 4 + 20);
});

test("tables: rows of cells; a 100% column leaves the others their minimum", () => {
  const layout = createLayout(`${BASE} table { border-collapse: collapse; font: 12px/1.4 Ubuntu } td { padding: 2px 6px; white-space: nowrap } td.e { width: 100%; white-space: normal }`);
  const body = el(["body", ""]);
  const t = el(["table", "", ["tbody", "", ["tr", "", ["td", "", "1–3"], ["td", "e", "Short"]], ["tr", "", ["td", "", "4"], ["td", "e", "Two"]]]], body);
  assert.equal(layout.height(t, 300), 2 * (16.796875 + 4));
});

test("a scroll container's content wider than it is reported", () => {
  const layout = createLayout(`${BASE} .s { overflow-x: auto } table { font: 12px/1.4 Ubuntu } td { white-space: nowrap }`);
  const body = el(["body", ""]);
  const box = el(["div", "s", ["table", "", ["tbody", "", ["tr", "", ["td", "", "A rather long line of text in a cell"]]]]], body);
  assert.equal(layout.measure(box, 100).overflow, true);
  assert.equal(layout.measure(box, 600).overflow, false);
});

test("the cards' own stylesheets parse", () => {
  const css = ["styles/base.css", "canvas/canvas.css", "rules/rules.css"].map((f) => readFileSync(new URL(`../src/client/${f}`, import.meta.url), "utf8")).join("\n");
  const layout = createLayout(css);
  const body = el(["body", ""]);
  const slot = el(["div", "cv-card", ["article", "rc k-talent", ["header", "", ["h3", "name", "Dodge"]], ["div", "body", ["div", "text", "Dodges."]]]], body);
  // header: 7 + 18.75 (15px/1.25) … at least its min-height; body: 8 + 21 (14px/1.5) + 10; the top border 3.
  const h = layout.height(slot.childNodes[0], 320);
  assert.equal(h, 3 + 38 + 8 + 21 + 10);
});

const talent = (name: string): Entry => ({ id: "x", kind: "talent", name, source: { page: 1 }, text: "t" }) as Entry;
const names = (map: Record<string, string>): Names => ({
  name: (k, id) => map[`${k}/${id}`] ?? id,
  has: (k, id) => `${k}/${id}` in map,
  die: () => "D100",
  columns: () => [],
  list: () => [],
});

test("card sizes: content keys, widths to try, and records that hold while their names do", () => {
  assert.equal(fnv1a("foobar"), "bf9cf968");
  assert.notEqual(contentKey(talent("A"), false), contentKey(talent("B"), false));
  assert.notEqual(contentKey(talent("A"), false), contentKey(talent("A"), true));
  assert.deepEqual(widthsFor(talent("A")), [COL, WIDE, XWIDE]);
  const n = names({ "talent/dodge": "Dodge" });
  const log = new Map<string, string>();
  const rec = recordingNames(n, log);
  rec.name("talent", "dodge");
  rec.has("talent", "nope");
  const d = [...log.keys()].sort();
  assert.deepEqual(d, ["h talent/nope", "n talent/dodge"]);
  assert.equal(depValue(n, "n talent/dodge"), "Dodge");
  const record = { c: contentKey(talent("A"), false), w: COL, h: 100, d, dh: depsHash(d.map((k) => log.get(k)!)) };
  assert.equal(holds(record, talent("A"), false, n), true);
  assert.equal(holds(record, talent("B"), false, n), false);
  assert.equal(holds(record, talent("A"), false, names({ "talent/dodge": "Dodging" })), false);
  assert.equal(holds(undefined, talent("A"), false, n), false);
});
