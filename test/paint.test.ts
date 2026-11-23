// Card geometry: where the layout engine puts boxes, words and images
// (src/shared/layout/box.ts, measure(…, true)), its compact encoding
// (src/shared/layout/paint.ts), and the canvas's tile maths
// (src/client/canvas/tiles.ts). Whole cards against Chrome: npm run heights:check.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createLayout, type PaintOp } from "../src/shared/layout/box.ts";
import { ROOT_STYLE, type Style } from "../src/shared/layout/css.ts";
import { createRoot, type FElement } from "../src/shared/layout/dom.ts";
import { decodeGeo, GeoWriter, geoOf, STRIDE } from "../src/shared/layout/paint.ts";
import { faceFor, textWidth } from "../src/shared/layout/text.ts";
import { tileLevel, tileRange, TILE } from "../src/client/canvas/tiles.ts";

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

const BASE = `:root { --ink: #eee; --chip: #333; --line: #444 } * { box-sizing: border-box } body { font: 13px/1.4 "Ubuntu"; color: var(--ink) }`;
const regular = faceFor("Ubuntu", 400, "normal");
const texts = (ops: PaintOp[]) => ops.filter((o): o is Extract<PaintOp, { t: "text" }> => o.t === "text");

test("words: each at its x, on its line's baseline; text-align moves the line", () => {
  const layout = createLayout(`${BASE} .r { text-align: right }`);
  const body = el(["body", ""]);
  const p = el(["div", "", "one two"], body);
  const ops = texts(layout.measure(p, 300, true).ops!);
  assert.equal(ops.length, 2);
  const one = textWidth(regular, 13, "one"), space = textWidth(regular, 13, " ");
  assert.equal(ops[0].x, 0);
  assert.equal(ops[0].w, one);
  assert.ok(Math.abs(ops[1].x - (one + space)) < 1e-9);
  // 13px/1.4: ascent round(0.932 × 13) = 12, half the leading floored to a whole pixel (2).
  assert.equal(ops[0].y, 14);
  assert.equal(ops[0].s.color, "var(--ink)");
  const r = el(["div", "r", "one"], body);
  const [right] = texts(layout.measure(r, 300, true).ops!);
  assert.ok(Math.abs(right.x + right.w - 300) < 1e-9);
});

test("boxes: a chip's background and radius, centred in a line as tall as its min-height; borders keep their style", () => {
  const layout = createLayout(`${BASE}
    .flow { display: flex; flex-wrap: wrap; gap: 4px; align-items: center }
    .chip { display: inline-flex; align-items: center; min-height: 22px; padding: 1px 7px; border-radius: 6px; background: var(--chip); font: 12.5px/1.3 Ubuntu }
    .sec { border-top: 1px dashed var(--line); padding-top: 6px }`);
  const body = el(["body", ""]);
  const flow = el(["div", "sec", ["div", "flow", ["span", "chip", "Chip"], ["span", "chip", "Other"]]], body);
  const ops = layout.measure(flow, 300, true).ops!;
  const boxes = ops.filter((o) => o.t === "box");
  assert.equal(boxes.length, 3);
  const [sec, chip, other] = boxes as Extract<PaintOp, { t: "box" }>[];
  assert.deepEqual(sec.s.borderStyle, ["dashed", "none", "none", "none"]);
  assert.equal(sec.s.borderColor[0], "var(--line)");
  assert.deepEqual([chip.x, chip.y, chip.h], [0, 7, 22]);
  assert.equal(chip.s.background, "var(--chip)");
  assert.equal(chip.s.radius, 6);
  assert.ok(Math.abs(other.x - (chip.w + 4)) < 1e-9);
  // The text (16.25px tall) sits in the middle of the chip's 20px content box.
  const [word] = texts(ops);
  assert.equal(word.x, 7);
  assert.ok(Math.abs(word.y - (7 + 1 + (20 - 16.25) / 2 + 13)) < 1e-6);
});

test("a custom property set on an element reaches its descendants' colours as the token it names", () => {
  const layout = createLayout(`${BASE} :root { --accent: red } .k { --kc: var(--accent) } .c { border-top: 3px solid var(--kc, var(--line)); color: var(--kc) }`);
  const body = el(["body", ""]);
  const c = el(["div", "k", ["div", "c", "x"]], body);
  const ops = layout.measure(c, 100, true).ops!;
  const box = ops.find((o) => o.t === "box")!;
  assert.equal(box.s.borderColor[0], "var(--accent)");
  assert.equal(texts(ops)[0].s.color, "var(--accent)");
});

const style = (patch: Partial<Style>): Style => ({ ...ROOT_STYLE, ...patch });

test("geometry encoding: half-pixel rectangles, looks shared and kept across writers", () => {
  const text = style({ color: "var(--ink)", fontSize: 13 });
  const chip = style({ background: "var(--chip)", radius: 6 });
  const ops: PaintOp[] = [
    { t: "box", x: 10.2, y: 40, w: 50.26, h: 22, s: chip },
    { t: "text", x: 17, y: 55.3, w: 30.1, s: text },
    { t: "text", x: 50.4, y: 55.3, w: 12, s: text },
    { t: "text", x: 3, y: 12, w: 0, s: text },
    { t: "img", x: -4, y: 2.75, w: 16, h: 16, s: style({ color: "var(--accent)" }) },
  ];
  const w = new GeoWriter();
  const str = w.card(ops);
  assert.match(str, /^[A-Za-z0-9_-]+$/);
  assert.equal(w.looks.length, 3);
  const geo = decodeGeo(str, w.looks);
  assert.equal(geo.a.length, ops.length * STRIDE);
  const q = (v: number) => Math.round(v * 2) / 2;
  ops.forEach((o, i) => {
    const [li, x, y, ww, h] = geo.a.slice(i * STRIDE, i * STRIDE + STRIDE);
    assert.equal(w.looks[li].t, o.t);
    assert.deepEqual([x, y, ww, h], [q(o.x), q(o.y), q(o.w), o.t === "text" ? 0 : q(o.h)]);
  });
  // A writer started from that table gives the same strings.
  const again = new GeoWriter(w.looks);
  assert.equal(again.card(ops), str);
  assert.equal(again.looks.length, 3);
  // Straight from the layout, as decoded.
  assert.deepEqual([...geoOf(ops).a], [...geo.a]);
  assert.throws(() => decodeGeo("!", w.looks));
});

test("tiles: the level at or above the view's scale, capped; the tiles over a rect", () => {
  assert.equal(tileLevel(1, 4), 0);
  assert.equal(tileLevel(0.67, 4), 0);
  assert.equal(tileLevel(0.5, 4), -1);
  assert.equal(tileLevel(0.046, 4), -4);
  assert.equal(tileLevel(5, 1), 1);
  const r = tileRange({ x: -10, y: 0, w: TILE * 2, h: 10 }, 1);
  assert.deepEqual(r, { i0: -1, i1: 3, j0: 0, j1: 0, size: TILE / 2 });
});
