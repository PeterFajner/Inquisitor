// scripts/heights-check.ts runs this in a browser on /rules: every card
// rendered for real (as the canvas mounts it) and measured, next to the
// height card-height.tsx works out for it; and where its text went (each
// text node's line boxes) next to the geometry worked out (its words: the
// first one's left edge, the last one's right edge, the baseline). Not part
// of the app.
import { render } from "preact";
import type { RulesPayload } from "../../shared/api.ts";
import { buildCompendium } from "../../shared/rules/compendium.ts";
import type { PaintOp } from "../../shared/layout/box.ts";
import { faceFor } from "../../shared/layout/text.ts";
import { cardHeight, WEBKIT } from "./card-height.tsx";
import { Card } from "./Card.tsx";
import { ctxOf, namesOf } from "./ctx.ts";

/** geo: the largest differences (px) between real and worked-out text: left edges, right edges, baselines; text nodes that didn't pair up;
 * `approx` when the card has characters its fonts lack (drawn by a system font, of a width only guessed). */
export type ProbeRow = { key: string; w: number; real: number; calc: number; geo: { x: number; r: number; y: number; unpaired: number; approx: boolean } };

type Frag = { l: number; r: number; base: number };

/** The worked-out text, per text node (in order), as words (pieces of a word broken at a hyphen joined while on one line). */
function calcText(ops: PaintOp[]): Frag[][] {
  const by = new Map<unknown, Frag[]>();
  for (const o of ops) {
    if (o.t !== "text" || !o.n) continue;
    let fs = by.get(o.n);
    if (!fs) by.set(o.n, (fs = []));
    const last = fs.at(-1);
    if (last && Math.abs(last.base - o.y) < 0.01 && Math.abs(o.x - last.r) < 0.01) last.r = o.x + o.w;
    else fs.push({ l: o.x, r: o.x + o.w, base: o.y });
  }
  return [...by.values()];
}

/** The real text, per text node with any (in order), as words: each one's box on each line it's on, and its baseline (from the font's ascent). */
function realText(el: Element, origin: DOMRect): Frag[][] & { approx?: boolean } {
  const out: Frag[][] & { approx?: boolean } = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent ?? "";
    if (!text.trim()) continue;
    const cs = getComputedStyle(n.parentElement!);
    const face = faceFor(cs.fontFamily, parseInt(cs.fontWeight), cs.fontStyle === "normal" ? "normal" : "italic");
    for (const ch of text) if (!/\s/.test(ch) && !face.adv.has(ch.codePointAt(0)!)) out.approx = true;
    // (The font shorthand reads "" when the font has a variant it can't express.)
    const below = baselineBelow(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`);
    const words: Frag[] = [];
    for (const m of text.matchAll(/\S+/g)) {
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      for (const r of range.getClientRects())
        if (r.width > 0.01) words.push({ l: r.left - origin.left, r: r.right - origin.left, base: r.top - origin.top + below });
    }
    if (words.length) out.push(words);
  }
  return out;
}

/** How far a word's box's top is above its baseline, in a font: an empty inline-block's bottom sits on the baseline. */
const belows = new Map<string, number>();
function baselineBelow(font: string): number {
  let v = belows.get(font);
  if (v === undefined) {
    const p = document.createElement("div");
    p.style.cssText = `position:absolute;left:0;top:0;font:${font};white-space:nowrap;font-kerning:none`;
    p.innerHTML = 'Word<span style="display:inline-block;width:0;height:0"></span>';
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p.firstChild!);
    v = p.lastElementChild!.getBoundingClientRect().bottom - range.getBoundingClientRect().top;
    p.remove();
    belows.set(font, v);
  }
  return v;
}

function compare(calc: Frag[][], real: Frag[][] & { approx?: boolean }): ProbeRow["geo"] {
  const g = { x: 0, r: 0, y: 0, unpaired: Math.abs(calc.length - real.length), approx: !!real.approx };
  for (let i = 0; i < Math.min(calc.length, real.length); i++) {
    const a = calc[i], b = real[i];
    if (a.length !== b.length) {
      g.unpaired++;
      continue;
    }
    a.forEach((f, j) => {
      g.x = Math.max(g.x, Math.abs(f.l - b[j].l));
      g.r = Math.max(g.r, Math.abs(f.r - b[j].r));
      g.y = Math.max(g.y, Math.abs(f.base - b[j].base));
    });
  }
  return g;
}

const FACES = ["400 16px Ubuntu", "500 16px Ubuntu", "700 16px Ubuntu", "italic 400 16px Ubuntu", "italic 700 16px Ubuntu", "italic 500 16px Ubuntu"];

export async function probe(): Promise<{ rows: ProbeRow[]; calcMs: number }> {
  await Promise.all(FACES.map((f) => document.fonts.load(f, "a≤")));
  await document.fonts.ready;
  const payload = (await (await fetch("/api/v1/rules")).json()) as RulesPayload;
  const names = namesOf(buildCompendium(payload.packs));
  const box = document.createElement("div");
  box.className = "cv-measure";
  document.body.appendChild(box);
  const actions = { edit() {}, history() {} };
  const go = () => {};
  const rows: ProbeRow[] = [];
  let calcMs = 0;
  for (const { pack, entries } of payload.packs)
    for (const entry of entries) {
      const key = `${pack.id}:${entry.kind}/${entry.id}`;
      const meta = payload.meta?.[pack.id]?.[`${entry.kind}/${entry.id}`];
      const t0 = performance.now();
      const calc = cardHeight(key, entry, meta, names, WEBKIT);
      calcMs += performance.now() - t0;
      const w = calc.w;
      const slot = document.createElement("div");
      slot.className = "cv-card";
      slot.style.width = `${w}px`;
      box.appendChild(slot);
      render(<Card cardKey={key} entry={entry} meta={meta} ctx={{ ...ctxOf(entry, names), go }} selected={false} signedIn={false} actions={actions} />, slot);
      const box0 = slot.getBoundingClientRect();
      const real = box0.height;
      const ct = calcText(calc.ops), rt = realText(slot, box0);
      const geo = compare(ct, rt);
      render(null, slot);
      slot.remove();
      rows.push({ key, w, real, calc: calc.h, geo });
    }
  box.remove();
  return { rows, calcMs };
}

(globalThis as { heightsProbe?: typeof probe }).heightsProbe = probe;
