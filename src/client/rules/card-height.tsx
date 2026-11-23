// A card's height, worked out without a browser's layout: the card is
// rendered (Preact) into a tiny DOM of its own (src/shared/layout/dom.ts)
// and laid out by src/shared/layout from the app's own stylesheets and the
// fonts' advance widths. The same code runs in the browser and, bundled, on
// the server (src/lib/rules-heights.ts), so they agree to the pixel.
import { render, type ContainerNode } from "preact";
import type { CardHeight, EntryMeta } from "../../shared/api.ts";
import { createLayout, type Layout, type PaintOp } from "../../shared/layout/box.ts";
import { createRoot, type FElement } from "../../shared/layout/dom.ts";
import type { Entry } from "../../shared/rules/schema.ts";
import canvasCss from "../canvas/canvas.css?text";
import baseCss from "../styles/base.css?text";
import { Card, type CardActions } from "./Card.tsx";
import { ctxOf, type Names } from "./ctx.ts";
import rulesCss from "./rules.css?text";
import { contentKey, depsHash, recordingNames, widthsFor } from "./sizes.ts";

export const LAYOUT = LAYOUT_BUILD;

/**
 * Whether this browser lays text out as WebKit does (Safari; every iOS
 * browser): line heights in whole pixels, so its cards are a little shorter
 * than Chrome's (the server's) heights, which still hold as their slots;
 * their geometry is worked out here (cardGeometry), in WebKit's lines.
 */
export const WEBKIT =
  typeof navigator !== "undefined" && /AppleWebKit\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);
const noActions: CardActions = { edit() {}, history() {} };
const go = () => {};

let engine: { layout: Layout; body: FElement } | null = null;
let webkitEngine: { layout: Layout; body: FElement } | null = null;
const css = () => `${baseCss}\n${canvasCss}\n${rulesCss}`;
function engineFor(webkit: boolean): { layout: Layout; body: FElement } {
  const make = () => {
    const html = createRoot("html");
    const body = createRoot("body");
    html.appendChild(body);
    return { layout: createLayout(css(), { wholeLines: webkit }), body };
  };
  return webkit ? (webkitEngine ??= make()) : (engine ??= make());
}

/** A card's size as drawn on the canvas (not selected), with what it depends on: its
 * own width, or a wider one if a table in it would scroll sideways otherwise;
 * and where everything in it went (`ops`, src/shared/layout/paint.ts). */
export function cardHeight(key: string, entry: Entry, meta: EntryMeta | undefined, names: Names, webkit = false): CardHeight & { ops: PaintOp[] } {
  const engine = engineFor(webkit);
  const log = new Map<string, string>();
  const ctx = { ...ctxOf(entry, recordingNames(names, log)), go };
  const slot = createRoot("div");
  slot.setAttribute("class", "cv-card");
  engine.body.appendChild(slot);
  // (Preact needs no more of a DOM than ./dom.ts has.)
  const root = slot as unknown as ContainerNode;
  render(<Card cardKey={key} entry={entry} meta={meta} ctx={ctx} selected={false} signedIn={false} actions={noActions} />, root);
  const widths = widthsFor(entry);
  let w = widths[0];
  let h = 0;
  let ops: PaintOp[] = [];
  for (const x of widths) {
    const m = engine.layout.measure(slot.childNodes[0], x, true);
    [w, h, ops] = [x, m.h, m.ops ?? []];
    if (!m.overflow) break;
  }
  render(null, root);
  engine.body.removeChild(slot);
  const d = [...log.keys()].sort();
  return { c: contentKey(entry, !!meta?.edited), w, h, d, dh: depsHash(d.map((k) => log.get(k)!)), ops };
}
