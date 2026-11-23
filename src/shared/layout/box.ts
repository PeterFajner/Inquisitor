// The card layout engine: works out the height a browser gives a DOM tree
// (a card rendered into ./dom.ts) at a width, from the app's own CSS
// (./css.ts) and the self-hosted fonts' advance widths (./text.ts). It knows
// the CSS the cards use and no more: block flow, inline text with line
// breaking, flexbox (rows that wrap, columns), grid (fixed, max-content and
// fr tracks), tables (auto layout), images. Everything is in CSS pixels;
// line heights are floored to 1/64 px as Chrome does (LayoutUnit).
//
// Asked to (measure(…, true)), it also says where everything went: boxes
// with a background, border or shadow, each word of text (its left edge,
// width and baseline), images (PaintOp; ./paint.ts encodes them), which the
// rules canvas draws for cards too small to read.
//
// scripts/heights-check.ts compares it with Chrome for every card.
import { computeStyle, lineHeightPx, parseCss, ROOT_STYLE, UA_CSS, type Len, type LNode, type Sheet, type Style, type Track } from "./css.ts";
import { breakBetween, faceFor, textWidth, type Face } from "./text.ts";

const LU = 64;
const floorLU = (x: number) => Math.floor(x * LU + 1e-7) / LU;
const roundLU = (x: number) => Math.round(x * LU) / LU;
/** Slack when fitting text on a line: what's this much wider than the line still fits. */
const FIT = 1 / LU;

// ---------------------------------------------------------------------------
// The box tree
// ---------------------------------------------------------------------------

type Metrics = { asc: number; desc: number };

/** Where a laid-out element's pieces are, in CSS px from its border box's
 * top-left: boxes with a background, border or shadow; each word of text
 * (x, width, and y = its baseline; `n` its text node); images. */
export type PaintOp =
  | { t: "box"; x: number; y: number; w: number; h: number; s: Style }
  | { t: "text"; x: number; y: number; w: number; s: Style; n?: LNode }
  | { t: "img"; x: number; y: number; w: number; h: number; s: Style };

/** Inline content, flattened: text, atomic inlines, forced breaks. */
type Item =
  | { k: "text"; s: Style; text: string; boxes: Style[]; edgeL: number; edgeR: number; n?: LNode }
  | { k: "atomic"; box: Box; s: Style; boxes: Style[] }
  | { k: "br"; s: Style; boxes: Style[] };

type Base = { s: Style; n?: LNode; minC?: number; maxC?: number; units?: Unit[] };
type Box =
  | (Base & { t: "block"; kids: Box[] })
  | (Base & { t: "inline"; items: Item[] })
  | (Base & { t: "flex"; kids: Box[] })
  | (Base & { t: "grid"; kids: Box[] })
  | (Base & { t: "table"; rows: Box[][] })
  | (Base & { t: "img"; w: number; h: number });

/** An anonymous box's style: what it inherits, defaults otherwise. */
const anonCache = new WeakMap<Style, Style>();
function anon(parent: Style): Style {
  let a = anonCache.get(parent);
  if (!a) {
    a = { ...ROOT_STYLE, margin: [...ROOT_STYLE.margin], padding: [...ROOT_STYLE.padding], border: [0, 0, 0, 0] };
    for (const k of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "lineHeightIsNumber", "whiteSpace", "textAlign", "color", "vars"] as const)
      (a as Record<string, unknown>)[k] = parent[k];
    anonCache.set(parent, a);
  }
  return a;
}

const isInlineLevel = (d: string) => d.startsWith("inline") || d === "inline";

function innerType(display: string): "block" | "flex" | "grid" | "table" {
  if (display.includes("flex")) return "flex";
  if (display.includes("grid")) return "grid";
  if (display === "table" || display === "inline-table") return "table";
  return "block";
}

class Builder {
  private sheet: Sheet;
  constructor(sheet: Sheet) {
    this.sheet = sheet;
  }

  styleOf(n: LNode, parent: Style): Style {
    return computeStyle(this.sheet, n, parent);
  }

  /** The box an element generates (null for display: none or out of flow). */
  element(n: LNode, parent: Style, blockify = false): Box | null {
    const s = this.styleOf(n, parent);
    if (s.display === "none" || s.position === "absolute" || s.position === "fixed") return null;
    if (blockify) s.display = blockified(s.display);
    const b = n.localName === "img" ? this.img(n, s) : this.container(n, s);
    b.n = n;
    return b;
  }

  img(n: LNode, s: Style): Box {
    const attr = (a: string) => parseFloat(n.getAttribute?.(a) ?? "") || 0;
    const w = s.width !== "auto" && typeof s.width === "object" && !s.width.pct ? s.width.px : attr("width");
    const h = s.height !== "auto" && typeof s.height === "object" && !s.height.pct ? s.height.px : attr("height");
    return { t: "img", s, w, h };
  }

  /** A box with its own inner layout, for an element. */
  container(n: LNode, s: Style): Box {
    const t = innerType(s.display);
    if (t === "flex" || t === "grid") return { t, s, kids: this.items(n, s) };
    if (t === "table") return { t: "table", s, rows: this.rows(n, s) };
    return this.flow(n, s);
  }

  /** A block container: block children (inline runs wrapped in anonymous blocks), or inline content. */
  flow(n: LNode, s: Style): Box {
    const kids = Array.from(n.childNodes);
    const blockLevel = (k: LNode) => {
      if (k.nodeType !== 1) return false;
      const ks = this.styleOf(k, s);
      return ks.display !== "none" && ks.position !== "absolute" && ks.position !== "fixed" && !isInlineLevel(ks.display) && k.localName !== "img";
    };
    if (!kids.some(blockLevel)) return { t: "inline", s, items: this.inline(kids, s) };
    const out: Box[] = [];
    let run: LNode[] = [];
    const flush = () => {
      if (run.length) {
        const a = anon(s);
        const items = this.inline(run, a);
        if (items.some((i) => i.k !== "text" || i.text.trim())) out.push({ t: "inline", s: a, items });
      }
      run = [];
    };
    for (const k of kids) {
      if (blockLevel(k)) {
        flush();
        const b = this.element(k, s);
        if (b) out.push(b);
      } else run.push(k);
    }
    flush();
    return { t: "block", s, kids: out };
  }

  /** Flex or grid items: each element blockified, each run of text an anonymous item. */
  items(n: LNode, s: Style): Box[] {
    const out: Box[] = [];
    let run: LNode[] = [];
    const flush = () => {
      if (run.length) {
        const a = anon(s);
        const items = this.inline(run, a);
        if (items.some((i) => i.k !== "text" || i.text.replace(/[ \t\n\r]/g, ""))) out.push({ t: "inline", s: a, items });
      }
      run = [];
    };
    for (const k of Array.from(n.childNodes)) {
      if (k.nodeType === 3) {
        run.push(k);
        continue;
      }
      if (k.nodeType !== 1) continue;
      flush();
      const b = this.element(k, s, true);
      if (b) out.push(b);
    }
    flush();
    return out;
  }

  rows(n: LNode, s: Style): Box[][] {
    const rows: Box[][] = [];
    const walk = (p: LNode, ps: Style) => {
      for (const k of Array.from(p.childNodes)) {
        if (k.nodeType !== 1) continue;
        const ks = this.styleOf(k, ps);
        if (ks.display === "none") continue;
        if (ks.display === "table-row") {
          const cells: Box[] = [];
          for (const c of Array.from(k.childNodes)) {
            if (c.nodeType !== 1) continue;
            const cs = this.styleOf(c, ks);
            if (cs.display === "none") continue;
            cells.push(this.flow(c, cs));
          }
          rows.push(cells);
        } else walk(k, ks);
      }
    };
    walk(n, s);
    return rows;
  }

  /** Inline content of some nodes, flattened (whitespace processed per white-space). */
  inline(nodes: LNode[], s: Style): Item[] {
    const out: Item[] = [];
    const walk = (list: LNode[], ps: Style, boxes: Style[]) => {
      for (const k of list) {
        if (k.nodeType === 3) {
          if (k.data !== undefined && k.data !== "") out.push({ k: "text", s: ps, text: String(k.data), boxes, edgeL: 0, edgeR: 0, n: k });
          continue;
        }
        if (k.nodeType !== 1) continue;
        if (k.localName === "br") {
          out.push({ k: "br", s: ps, boxes });
          continue;
        }
        const ks = this.styleOf(k, ps);
        if (ks.display === "none" || ks.position === "absolute" || ks.position === "fixed") continue;
        if (ks.display === "inline" && k.localName !== "img") {
          const l = edge(ks, 3), r = edge(ks, 1);
          const start = out.length;
          walk(Array.from(k.childNodes), ks, [...boxes, ks]);
          // Its left and right edges (margin, border, padding) go on its first and last text.
          if (l || r) {
            const first = out.slice(start).find((i) => i.k === "text") as Extract<Item, { k: "text" }> | undefined;
            const last = out.slice(start).reverse().find((i) => i.k === "text") as Extract<Item, { k: "text" }> | undefined;
            if (first) first.edgeL += l;
            if (last) last.edgeR += r;
          }
          continue;
        }
        const b = k.localName === "img" ? this.img(k, ks) : this.container(k, ks);
        b.n = k;
        out.push({ k: "atomic", box: b, s: ks, boxes });
      }
    };
    walk(nodes, s, []);
    return collapse(out);
  }
}

const edge = (s: Style, side: number) => lenPx(s.margin[side], 0) + lenPx(s.padding[side], 0) + s.border[side];

function blockified(d: string): string {
  if (d === "inline" || d === "inline-block" || d === "contents") return "block";
  if (d === "inline-flex") return "flex";
  if (d === "inline-grid") return "grid";
  if (d === "inline-table") return "table";
  return d;
}

/** White-space processing across an inline formatting context's text. */
function collapse(items: Item[]): Item[] {
  let prevSpace = true; // at the start, collapsible spaces go
  for (const it of items) {
    if (it.k !== "text") {
      prevSpace = it.k === "br";
      continue;
    }
    const ws = it.s.whiteSpace;
    if (ws === "pre" || ws === "pre-wrap" || ws === "break-spaces") {
      prevSpace = false;
      continue;
    }
    let t = it.text.replace(/\r\n?/g, "\n");
    if (ws === "pre-line") t = t.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t]+/g, " ");
    else t = t.replace(/[ \t\n]+/g, " ");
    if (prevSpace && t.startsWith(" ")) t = t.slice(1);
    if (t) prevSpace = t.endsWith(" ") || t.endsWith("\n");
    it.text = t;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Lengths
// ---------------------------------------------------------------------------

function lenPx(l: Len | "content", cb: number): number {
  return typeof l === "object" ? l.px + l.pct * cb : 0;
}
const isFixed = (l: Len | "content"): l is { px: number; pct: number } => typeof l === "object";
const hPad = (s: Style, cb: number) => lenPx(s.padding[1], cb) + lenPx(s.padding[3], cb) + s.border[1] + s.border[3];
const vPad = (s: Style, cb: number) => lenPx(s.padding[0], cb) + lenPx(s.padding[2], cb) + s.border[0] + s.border[2];
const hMargin = (s: Style, cb: number) => lenPx(s.margin[1], cb) + lenPx(s.margin[3], cb);
const vMargin = (s: Style, cb: number) => lenPx(s.margin[0], cb) + lenPx(s.margin[2], cb);

/** A specified width or height as a border-box size (null when auto or indefinite). */
function specified(s: Style, l: Len, cb: number | null, horizontal: boolean): number | null {
  if (!isFixed(l)) return null;
  if (l.pct && cb === null) return null;
  const v = l.px + l.pct * (cb ?? 0);
  if (s.boxSizing === "border-box") return v;
  return v + (horizontal ? hPad(s, cb ?? 0) : vPad(s, cb ?? 0));
}

function clampW(s: Style, w: number, cb: number | null): number {
  const max = specified(s, s.maxWidth, cb, true);
  const min = specified(s, s.minWidth, cb, true);
  if (max !== null) w = Math.min(w, max);
  if (min !== null) w = Math.max(w, min);
  return Math.max(w, hPad(s, cb ?? 0));
}

function clampH(s: Style, h: number, cb: number): number {
  const set = specified(s, s.height, null, false);
  if (set !== null) h = set;
  const max = specified(s, s.maxHeight, null, false);
  const min = specified(s, s.minHeight, null, false);
  if (max !== null) h = Math.min(h, max);
  if (min !== null) h = Math.max(h, min);
  return Math.max(h, vPad(s, cb));
}

// ---------------------------------------------------------------------------
// Fonts and lines
// ---------------------------------------------------------------------------

const faceCache = new WeakMap<Style, Face>();
function faceOf(s: Style): Face {
  let f = faceCache.get(s);
  if (!f) faceCache.set(s, (f = faceFor(s.fontFamily, s.fontWeight, s.fontStyle)));
  return f;
}

/** A style's line-height contribution: ascent and descent around the baseline, with half the leading each. */
/** WebKit's line heights: whole pixels (Chrome's: 1/64 px). Set by the Layout measuring. */
let wholeLines = false;

function strut(s: Style): Metrics {
  const f = faceOf(s);
  const a = Math.round(f.ascent * s.fontSize);
  const d = Math.round(f.descent * s.fontSize);
  const px = lineHeightPx(s, (f.ascent + f.descent + f.lineGap) * s.fontSize);
  const lh = wholeLines ? Math.floor(px + 1e-7) : floorLU(px);
  // Half the leading, in whole pixels (Chrome: the baseline sits on a pixel).
  const half = Math.floor((lh - (a + d)) / 2);
  return { asc: a + half, desc: lh - (a + half) };
}

/** An unbreakable piece of inline content (between two break opportunities). */
type Unit = {
  /** Width without trailing spaces. */
  w: number;
  /** Trailing (hanging) space width. */
  sw: number;
  /** A forced break after it. */
  br: boolean;
  /** Its contributions to the line's height. */
  m: Metrics[];
  /** When painting: its words (x from the unit's start) and atomic inline (top = its border box's height above the baseline). */
  parts?: ({ x: number; w: number; it: Extract<Item, { k: "text" }> } | { x: number; top: number; ops: PaintOp[] })[];
};

type Atomic = { w: number; h: number; base: number; ops?: PaintOp[] };

function unitsOf(box: Extract<Box, { t: "inline" }>, layoutAtomic: (b: Box) => Atomic, paint = false): Unit[] {
  if (box.units) return box.units;
  const units: Unit[] = [];
  const fresh = (): Unit => (paint ? { w: 0, sw: 0, br: false, m: [], parts: [] } : { w: 0, sw: 0, br: false, m: [] });
  let cur: Unit = fresh();
  let last = "";
  // The character before `last` ("" or " " at a word's start).
  let prev = "";
  const metricsOf = (boxes: Style[], s: Style): Metrics[] => [...boxes, s].map(strut);
  const close = () => {
    units.push(cur);
    cur = fresh();
  };
  for (const it of box.items) {
    if (it.k === "br") {
      cur.br = true;
      close();
      last = "";
      continue;
    }
    if (it.k === "atomic") {
      // A break opportunity before and after an atomic inline.
      if (cur.w || cur.sw || cur.m.length) close();
      const a = layoutAtomic(it.box);
      const m = vMargin(it.s, 0);
      const va = it.s.verticalAlign;
      const ma = { asc: a.base + lenPx(it.s.margin[0], 0), desc: a.h - a.base + lenPx(it.s.margin[2], 0) };
      if (va === "top" || va === "bottom" || va === "middle" || va === "text-top" || va === "text-bottom") {
        const st = strut(it.s);
        if (va === "middle") {
          const x = faceOf(it.s).ascent * it.s.fontSize * 0.5 * 0.53;
          ma.asc = (a.h + m) / 2 + x;
          ma.desc = a.h + m - ma.asc;
        } else {
          ma.asc = st.asc;
          ma.desc = Math.max(0, a.h + m - st.asc);
        }
      }
      cur.w = a.w + hMargin(it.s, 0);
      if (paint && a.ops) cur.parts!.push({ x: lenPx(it.s.margin[3], 0), top: ma.asc - lenPx(it.s.margin[0], 0), ops: a.ops });
      cur.m = [...metricsOf(it.boxes, it.s).slice(0, -1), ma];
      close();
      last = "";
      continue;
    }
    const s = it.s;
    const f = faceOf(s);
    const wrap = s.whiteSpace !== "nowrap" && s.whiteSpace !== "pre";
    const m = metricsOf(it.boxes, s);
    const text = it.text;
    if (it.edgeL) cur.w += it.edgeL;
    if (text) for (const x of m) if (!cur.m.includes(x)) cur.m.push(x);
    let seg = "";
    const flushSeg = () => {
      if (seg) {
        const sw = textWidth(f, s.fontSize, seg);
        if (paint) cur.parts!.push({ x: cur.w, w: sw, it });
        cur.w += sw;
      }
      seg = "";
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\n") {
        flushSeg();
        cur.br = true;
        close();
        cur.m = [...m];
        last = "";
        continue;
      }
      if (ch === " " || ch === "\t") {
        flushSeg();
        if (cur.w === 0 && cur.sw === 0 && !units.length && !wrap) {
          // leading space in nowrap text still takes room
        }
        const w = textWidth(f, s.fontSize, " ");
        if (!wrap) {
          cur.w += cur.sw + w;
          cur.sw = 0;
        } else cur.sw += w;
        last = " ";
        continue;
      }
      if (last === " " && wrap && (cur.w || cur.sw)) {
        flushSeg();
        close();
        cur.m = [...m];
      } else if (last === " " && !wrap && cur.sw) {
        cur.w += cur.sw;
        cur.sw = 0;
      } else if (wrap && last && breakBetween(last, ch, prev)) {
        flushSeg();
        close();
        cur.m = [...m];
      }
      if (cur.sw) {
        // spaces inside nowrap text count fully
        cur.w += cur.sw;
        cur.sw = 0;
      }
      seg += ch;
      prev = last;
      last = ch;
    }
    flushSeg();
    if (it.edgeR) cur.w += it.edgeR;
  }
  if (cur.w || cur.sw || cur.br) units.push(cur);
  // A unit of nothing but spaces at the very start goes.
  while (units.length && units[0].w === 0 && !units[0].br) units.shift();
  box.units = units;
  return units;
}

/** A line box; when painting, its units and where each starts. */
type Line = { w: number; asc: number; desc: number; placed?: { u: Unit; x: number }[] };

function lineBreak(units: Unit[], width: number, s: Style, paint = false): Line[] {
  const base = strut(s);
  const lines: Line[] = [];
  let cur: Line | null = null;
  let trailing = 0;
  const add = (u: Unit) => {
    if (!cur) cur = paint ? { w: 0, asc: base.asc, desc: base.desc, placed: [] } : { w: 0, asc: base.asc, desc: base.desc };
    cur.placed?.push({ u, x: cur.w + trailing });
    cur.w += trailing + u.w;
    trailing = u.sw;
    for (const m of u.m) {
      if (m.asc > cur.asc) cur.asc = m.asc;
      if (m.desc > cur.desc) cur.desc = m.desc;
    }
  };
  for (const u of units) {
    if (cur && (cur as Line).w + trailing + u.w > width + FIT) {
      lines.push(cur);
      cur = null;
      trailing = 0;
      // Spaces at the start of a line go.
      if (u.w === 0 && !u.br) continue;
    }
    add(u);
    if (u.br) {
      lines.push(cur!);
      cur = null;
      trailing = 0;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** A box laid out: its border-box height, first baseline, and when painting what's in it (`deco` its own box, also ops[0]). */
type Result = { h: number; base: number | null; ops?: PaintOp[]; deco?: Extract<PaintOp, { t: "box" }> };

/** Moves a child's paint into its parent's, `dy` down (its own box `decoDy`). */
function place(out: PaintOp[], r: Result, dx: number, dy: number, decoDy = dy): void {
  if (!r.ops) return;
  for (const o of r.ops) {
    o.x += dx;
    o.y += o === r.deco ? decoDy : dy;
    out.push(o);
  }
}

/** A box's own paint, if it has any: a background, a visible border, a shadow. */
function decoOf(s: Style, w: number, h: number): Extract<PaintOp, { t: "box" }> | undefined {
  const border = s.border.some((b, i) => b > 0 && s.borderStyle[i] !== "none" && s.borderStyle[i] !== "hidden");
  if (!s.background && !border && !s.shadow) return undefined;
  return { t: "box", x: 0, y: 0, w, h, s };
}

/** Where a line starts, for its text-align (an overflowing line starts at the start). */
function alignOffset(s: Style, room: number): number {
  if (room <= 0) return 0;
  if (s.textAlign === "right" || s.textAlign === "end") return room;
  if (s.textAlign === "center") return room / 2;
  return 0;
}

/** A flex or grid item's place in its line or row: what's above it, whether it stretches. */
function crossOffset(align: string, room: number): number {
  if (align === "center") return room / 2;
  if (align === "flex-end" || align === "end") return room;
  return 0;
}
const stretches = (k: Box, align: string) => (align === "normal" || align === "stretch") && k.s.height === "auto";

export class Layout {
  private builder: Builder;
  private wholeLines: boolean;
  constructor(sheet: Sheet, opts: LayoutOptions = {}) {
    this.builder = new Builder(sheet);
    this.wholeLines = !!opts.wholeLines;
  }

  /** The border-box height of `el` laid out at border-box width `width` (its ancestors give it their inherited styles). */
  height(el: LNode, width: number): number {
    return this.measure(el, width).h;
  }

  /** The border-box height of `el` at a width, and whether anything in it scrolls sideways (content wider than a scroll container); with `paint`, where everything in it went. */
  measure(el: LNode, width: number, paint = false): { h: number; overflow: boolean; ops?: PaintOp[] } {
    const box = this.builder.element(el, this.parentStyle(el));
    if (!box) return { h: 0, overflow: false, ops: paint ? [] : undefined };
    this.overflow = false;
    this.painting = paint;
    wholeLines = this.wholeLines;
    try {
      const r = this.layout(box, width, width);
      return { h: roundLU(r.h), overflow: this.overflow, ops: r.ops };
    } finally {
      this.painting = false;
    }
  }

  private overflow = false;
  private painting = false;

  private parentStyle(el: LNode): Style {
    const chain: LNode[] = [];
    for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) chain.unshift(p);
    let s = ROOT_STYLE;
    for (const p of chain) s = this.builder.styleOf(p, s);
    return s;
  }

  /** Box tree of an element (exposed for tests). */
  box(el: LNode): Box | null {
    return this.builder.element(el, this.parentStyle(el));
  }

  // --- intrinsic widths (border box) ---------------------------------------

  minContent(b: Box): number {
    return (b.minC ??= this.intrinsic(b, "min"));
  }
  maxContent(b: Box): number {
    return (b.maxC ??= this.intrinsic(b, "max"));
  }

  private intrinsic(b: Box, which: "min" | "max"): number {
    const s = b.s;
    const fixed = specified(s, s.width, null, true);
    if (fixed !== null) return clampW(s, fixed, null);
    let w = 0;
    const contrib = (k: Box) => this.contribution(k, which);
    switch (b.t) {
      case "img":
        w = b.w;
        break;
      case "inline": {
        const units = unitsOf(b, (a) => this.atomic(a), this.painting);
        if (which === "min") for (const u of units) w = Math.max(w, u.w);
        else {
          let line = 0, trailing = 0;
          for (const u of units) {
            line += trailing + u.w;
            trailing = u.sw;
            if (u.br) {
              w = Math.max(w, line);
              line = trailing = 0;
            }
          }
          w = Math.max(w, line);
        }
        break;
      }
      case "block":
        for (const k of b.kids) w = Math.max(w, contrib(k));
        break;
      case "flex": {
        const row = !s.flexDirection.startsWith("column");
        if (!row) for (const k of b.kids) w = Math.max(w, contrib(k));
        else if (which === "min" && s.flexWrap !== "nowrap") for (const k of b.kids) w = Math.max(w, contrib(k));
        else {
          for (const k of b.kids) w += contrib(k);
          w += Math.max(0, b.kids.length - 1) * s.columnGap;
        }
        break;
      }
      case "grid": {
        const cols = this.gridColumns(b, null, which);
        w = cols.reduce((a, c) => a + c, 0) + Math.max(0, cols.length - 1) * s.columnGap;
        break;
      }
      case "table": {
        const cols = this.tableColumns(b);
        w = cols.reduce((a, c) => a + (which === "min" ? c.min : c.max), 0);
        break;
      }
    }
    return clampW(s, w + (b.t === "img" ? 0 : hPad(s, 0)), null);
  }

  /** A child's outer intrinsic width contribution (with margins). */
  private contribution(k: Box, which: "min" | "max"): number {
    const own = which === "min" ? this.minContent(k) : this.maxContent(k);
    return own + hMargin(k.s, 0);
  }

  // --- layout -----------------------------------------------------------------

  /** Each element's laid-out border box, when set (for debugging). */
  trace: Map<LNode, { w: number; h: number }> | null = null;

  /** Lays out a box at border-box width w (its containing block cb wide): its border-box height and first baseline. */
  layout(b: Box, w: number, cb: number): Result {
    const r = this.layoutBox(b, w, cb);
    if (this.trace && b.n) this.trace.set(b.n, { w, h: r.h });
    if (this.painting) {
      r.ops ??= [];
      const deco = decoOf(b.s, w, r.h);
      if (deco) {
        r.deco = deco;
        r.ops.unshift(deco);
      }
    }
    return r;
  }

  private layoutBox(b: Box, w: number, cb: number): Result {
    const s = b.s;
    const paint = this.painting;
    // Where the content box starts.
    const top = lenPx(s.padding[0], cb) + s.border[0];
    const left = lenPx(s.padding[3], cb) + s.border[3];
    switch (b.t) {
      case "img":
        return { h: b.h, base: b.h, ops: paint ? [{ t: "img", x: 0, y: 0, w: b.w, h: b.h, s }] : undefined };
      case "inline": {
        const inner = w - hPad(s, cb);
        const lines = lineBreak(unitsOf(b, (a) => this.atomic(a), paint), inner, s, paint);
        let h = 0;
        const ops: PaintOp[] | undefined = paint ? [] : undefined;
        for (const l of lines) {
          if (ops) {
            const x0 = left + alignOffset(s, inner - l.w);
            const baseline = top + h + l.asc;
            for (const { u, x } of l.placed!)
              for (const p of u.parts!) {
                if ("it" in p) ops.push({ t: "text", x: x0 + x + p.x, y: baseline, w: p.w, s: p.it.s, n: p.it.n });
                else for (const o of p.ops) ops.push({ ...o, x: o.x + x0 + x + p.x, y: o.y + baseline - p.top });
              }
          }
          h += l.asc + l.desc;
        }
        return { h: clampH(s, h + vPad(s, cb), cb), base: lines.length ? top + lines[0].asc : null, ops };
      }
      case "block": {
        const inner = w - hPad(s, cb);
        let h = 0;
        let base: number | null = null;
        const ops: PaintOp[] | undefined = paint ? [] : undefined;
        for (const k of b.kids) {
          const kw = this.fillWidth(k, inner);
          if (s.overflowX !== "visible" && kw + hMargin(k.s, inner) > inner + 0.01) this.overflow = true;
          const r = this.layout(k, kw, inner);
          const mt = lenPx(k.s.margin[0], inner);
          if (base === null && r.base !== null) base = top + h + mt + r.base;
          if (ops) place(ops, r, left + lenPx(k.s.margin[3], inner), top + h + mt);
          h += r.h + vMargin(k.s, inner);
        }
        return { h: clampH(s, h + vPad(s, cb), cb), base, ops };
      }
      case "flex":
        return s.flexDirection.startsWith("column") ? this.flexColumn(b, w, cb) : this.flexRow(b, w, cb);
      case "grid":
        return this.grid(b, w, cb);
      case "table":
        return this.table(b, w, cb);
    }
  }

  /** An atomic inline's size and baseline (shrink-to-fit width). */
  private atomic(b: Box): Atomic {
    const w = b.t === "img" ? b.w : this.shrinkToFit(b, Infinity);
    const r = this.layout(b, w, w);
    return { w, h: r.h, base: r.base ?? r.h, ops: r.ops };
  }

  private shrinkToFit(b: Box, avail: number): number {
    const fixed = specified(b.s, b.s.width, Number.isFinite(avail) ? avail : null, true);
    if (fixed !== null) return clampW(b.s, fixed, avail);
    return clampW(b.s, Math.min(this.maxContent(b), Math.max(this.minContent(b), avail)), Number.isFinite(avail) ? avail : null);
  }

  /** The border-box width of a block-level box in a block container `inner` wide. */
  private fillWidth(k: Box, inner: number): number {
    const fixed = specified(k.s, k.s.width, inner, true);
    if (fixed !== null) return clampW(k.s, fixed, inner);
    if (k.t === "table" || k.t === "img") return this.shrinkToFit(k, inner - hMargin(k.s, inner));
    return clampW(k.s, inner - hMargin(k.s, inner), inner);
  }

  // --- flexbox ------------------------------------------------------------------

  private flexRow(b: Extract<Box, { t: "flex" }>, w: number, cb: number): Result {
    const s = b.s;
    const inner = w - hPad(s, cb);
    const gap = s.columnGap;
    type FI = { k: Box; base: number; hyp: number; min: number; max: number; outer: number; size: number; frozen: boolean };
    const items: FI[] = b.kids.map((k) => {
      const ks = k.s;
      const mx = hMargin(ks, inner);
      let base: number;
      const fb = ks.flexBasis;
      if (fb !== "auto" && fb !== "content" && isFixed(fb)) {
        base = fb.px + fb.pct * inner;
        if (ks.boxSizing !== "border-box") base += hPad(ks, inner);
      } else {
        const fixed = specified(ks, ks.width, inner, true);
        base = fixed ?? this.maxContent(k);
      }
      const scroll = ks.overflowX !== "visible";
      const minSpec = specified(ks, ks.minWidth, inner, true);
      let min = minSpec ?? (ks.minWidth === "auto" && !scroll ? Math.min(this.minContent(k), specified(ks, ks.width, inner, true) ?? Infinity) : 0);
      min = Math.max(min, hPad(ks, inner));
      const max = specified(ks, ks.maxWidth, inner, true) ?? Infinity;
      const hyp = Math.max(min, Math.min(max, base));
      return { k, base, hyp, min, max, outer: mx, size: hyp, frozen: false };
    });
    // Lines.
    const lines: FI[][] = [];
    let line: FI[] = [];
    let used = 0;
    for (const it of items) {
      const need = it.hyp + it.outer;
      if (s.flexWrap !== "nowrap" && line.length && used + gap + need > inner + 1e-6) {
        lines.push(line);
        line = [];
        used = 0;
      }
      used += (line.length ? gap : 0) + need;
      line.push(it);
    }
    if (line.length) lines.push(line);
    // Flexible lengths, per line.
    for (const l of lines) this.resolveFlex(l, inner - gap * (l.length - 1));
    // Heights.
    let h = 0;
    let base: number | null = null;
    const top = lenPx(s.padding[0], cb) + s.border[0];
    const left = lenPx(s.padding[3], cb) + s.border[3];
    const ops: PaintOp[] | undefined = this.painting ? [] : undefined;
    const placedLines: { rs: { it: (typeof items)[number]; r: Result }[]; lh: number; lineTop: number }[] = [];
    lines.forEach((l, li) => {
      const rs = l.map((it) => ({ it, r: this.layout(it.k, it.size, inner) }));
      let lh = 0;
      for (const { it, r } of rs) lh = Math.max(lh, r.h + vMargin(it.k.s, inner));
      const lineTop = top + h + (li ? s.rowGap : 0);
      if (li === 0 && rs.length) {
        const { it, r } = rs[0];
        const align = it.k.s.alignSelf !== "auto" ? it.k.s.alignSelf : s.alignItems;
        const outerH = r.h + vMargin(it.k.s, inner);
        const off = align === "center" ? (lh - outerH) / 2 : align === "flex-end" || align === "end" ? lh - outerH : 0;
        base = top + off + lenPx(it.k.s.margin[0], inner) + (r.base ?? r.h);
      }
      if (ops) placedLines.push({ rs, lh, lineTop });
      h += lh + (li ? s.rowGap : 0);
    });
    const outer = clampH(s, h + vPad(s, cb), cb);
    if (ops) {
      // Room the content box has beyond its lines (a min-height) goes to the lines alike (align-content: normal).
      const extra = placedLines.length ? Math.max(0, outer - vPad(s, cb) - h) / placedLines.length : 0;
      placedLines.forEach(({ rs, lh, lineTop }, li) => {
        const cross = lh + extra;
        let x = left;
        for (const { it, r } of rs) {
          const ks = it.k.s;
          const align = ks.alignSelf !== "auto" ? ks.alignSelf : s.alignItems;
          const outerH = r.h + vMargin(ks, inner);
          if (r.deco && stretches(it.k, align)) r.deco.h = cross - vMargin(ks, inner);
          x += lenPx(ks.margin[3], inner);
          place(ops, r, x, lineTop + li * extra + crossOffset(align, cross - outerH) + lenPx(ks.margin[0], inner));
          x += it.size + lenPx(ks.margin[1], inner) + gap;
        }
      });
    }
    return { h: outer, base, ops };
  }

  private resolveFlex(line: { k: Box; base: number; hyp: number; min: number; max: number; outer: number; size: number; frozen: boolean }[], space: number) {
    const sumHyp = line.reduce((a, it) => a + it.hyp + it.outer, 0);
    const grow = sumHyp < space;
    for (const it of line) {
      it.frozen = false;
      it.size = it.hyp;
      const f = grow ? it.k.s.flexGrow : it.k.s.flexShrink;
      if (f === 0 || (grow && it.base > it.hyp) || (!grow && it.base < it.hyp)) it.frozen = true;
    }
    for (let iter = 0; iter < 20; iter++) {
      const open = line.filter((it) => !it.frozen);
      if (!open.length) break;
      const usedFrozen = line.reduce((a, it) => a + it.outer + (it.frozen ? it.size : it.base), 0);
      let free = space - usedFrozen;
      if (grow) {
        const sumG = open.reduce((a, it) => a + it.k.s.flexGrow, 0);
        if (sumG < 1) free = Math.min(free, free * sumG);
        for (const it of open) it.size = it.base + (sumG ? (free * it.k.s.flexGrow) / sumG : 0);
      } else {
        const sumS = open.reduce((a, it) => a + it.k.s.flexShrink * it.base, 0);
        const sumF = open.reduce((a, it) => a + it.k.s.flexShrink, 0);
        if (sumF < 1) free = Math.max(free, free * sumF);
        for (const it of open) it.size = it.base + (sumS ? (free * it.k.s.flexShrink * it.base) / sumS : 0);
      }
      let total = 0;
      const viol: { it: (typeof line)[number]; d: number }[] = [];
      for (const it of open) {
        const c = Math.max(it.min, Math.min(it.max, it.size));
        viol.push({ it, d: c - it.size });
        total += c - it.size;
        it.size = c;
      }
      if (Math.abs(total) < 1e-9) break;
      for (const { it, d } of viol) if ((total > 0 && d > 0) || (total < 0 && d < 0)) it.frozen = true;
    }
  }

  private flexColumn(b: Extract<Box, { t: "flex" }>, w: number, cb: number): Result {
    const s = b.s;
    const inner = w - hPad(s, cb);
    let h = 0;
    let base: number | null = null;
    const top = lenPx(s.padding[0], cb) + s.border[0];
    const left = lenPx(s.padding[3], cb) + s.border[3];
    const ops: PaintOp[] | undefined = this.painting ? [] : undefined;
    b.kids.forEach((k, i) => {
      const align = k.s.alignSelf !== "auto" ? k.s.alignSelf : s.alignItems;
      const avail = inner - hMargin(k.s, inner);
      const fixed = specified(k.s, k.s.width, inner, true);
      const kw = fixed !== null ? clampW(k.s, fixed, inner) : align === "normal" || align === "stretch" ? clampW(k.s, avail, inner) : this.shrinkToFit(k, avail);
      const r = this.layout(k, kw, inner);
      // A flex-basis in a column of indefinite height: only a definite one counts.
      let kh = r.h;
      const fb = k.s.flexBasis;
      if (isFixed(fb) && !fb.pct) kh = Math.max(kh, fb.px);
      if (i) h += s.rowGap;
      if (base === null && r.base !== null) base = top + h + lenPx(k.s.margin[0], inner) + r.base;
      if (ops) {
        if (r.deco) r.deco.h = kh;
        place(ops, r, left + lenPx(k.s.margin[3], inner) + crossOffset(align, avail - kw), top + h + lenPx(k.s.margin[0], inner));
      }
      h += kh + vMargin(k.s, inner);
    });
    return { h: clampH(s, h + vPad(s, cb), cb), base, ops };
  }

  // --- grid ---------------------------------------------------------------------

  private placement(b: Extract<Box, { t: "grid" }>, n: number): { k: Box; row: number; col: number; span: number }[] {
    const out: { k: Box; row: number; col: number; span: number }[] = [];
    let row = 0, col = 0;
    for (const k of b.kids) {
      const [a, e] = k.s.gridColumn;
      let start: number | null = null;
      let span = 1;
      if (typeof a === "number") {
        start = a > 0 ? a - 1 : n + a;
        if (typeof e === "number") span = Math.max(1, (e > 0 ? e - 1 : n + 1 + e) - start);
        else if (typeof e === "object") span = e.span;
      } else if (typeof e === "object") span = e.span;
      span = Math.min(span, n);
      if (start !== null) {
        if (start < col) row++;
        col = start;
      } else if (col + span > n) {
        row++;
        col = 0;
      }
      out.push({ k, row, col, span });
      col += span;
      if (col >= n) {
        row++;
        col = 0;
      }
    }
    return out;
  }

  /** Column widths: fixed tracks, max-content tracks from their items, fr tracks share what's left (of `inner`, when known). */
  private gridColumns(b: Extract<Box, { t: "grid" }>, inner: number | null, which: "min" | "max" = "max"): number[] {
    const tracks: Track[] = b.s.gridTemplateColumns.length ? b.s.gridTemplateColumns : [{ kind: "fr", fr: 1 }];
    const n = tracks.length;
    const cols = tracks.map((t) => (t.kind === "px" ? t.px : 0));
    const placed = this.placement(b, n);
    for (const p of placed) {
      if (p.span !== 1) continue;
      const t = tracks[p.col];
      if (t.kind === "max-content" || t.kind === "auto" || (t.kind === "fr" && inner === null && which === "max")) {
        cols[p.col] = Math.max(cols[p.col], this.contribution(p.k, t.kind === "fr" ? "max" : which));
      } else if (t.kind === "min-content") cols[p.col] = Math.max(cols[p.col], this.contribution(p.k, "min"));
    }
    if (inner !== null) {
      const gaps = b.s.columnGap * (n - 1);
      const fixed = cols.reduce((a, c, i) => a + (tracks[i].kind === "fr" ? 0 : c), 0);
      const frs = tracks.reduce((a, t) => a + (t.kind === "fr" ? t.fr : 0), 0);
      const left = Math.max(0, inner - gaps - fixed);
      tracks.forEach((t, i) => {
        if (t.kind === "fr") cols[i] = frs ? (left * t.fr) / Math.max(1, frs) : 0;
      });
    }
    return cols;
  }

  private grid(b: Extract<Box, { t: "grid" }>, w: number, cb: number): Result {
    const s = b.s;
    const inner = w - hPad(s, cb);
    const cols = this.gridColumns(b, inner);
    const n = cols.length;
    const placed = this.placement(b, n);
    const rowH: number[] = [];
    const rowBase: (number | null)[] = [];
    const done: { p: (typeof placed)[number]; r: Result; cw: number; align: string }[] = [];
    for (const p of placed) {
      let cw = 0;
      for (let i = p.col; i < p.col + p.span; i++) cw += cols[i];
      cw += s.columnGap * (p.span - 1);
      const fixed = specified(p.k.s, p.k.s.width, cw, true);
      const align = p.k.s.alignSelf !== "auto" ? p.k.s.alignSelf : s.alignItems;
      const kw = fixed ?? clampW(p.k.s, cw - hMargin(p.k.s, cw), cw);
      const r = this.layout(p.k, kw, cw);
      const oh = r.h + vMargin(p.k.s, cw);
      rowH[p.row] = Math.max(rowH[p.row] ?? 0, oh);
      if (rowBase[p.row] === undefined && r.base !== null) rowBase[p.row] = lenPx(p.k.s.margin[0], cw) + r.base;
      if (this.painting) done.push({ p, r, cw, align });
    }
    let h = 0;
    rowH.forEach((x, i) => (h += (x ?? 0) + (i ? s.rowGap : 0)));
    const top = lenPx(s.padding[0], cb) + s.border[0];
    let ops: PaintOp[] | undefined;
    if (this.painting) {
      ops = [];
      const left = lenPx(s.padding[3], cb) + s.border[3];
      const colX: number[] = [];
      cols.reduce((x, c, i) => ((colX[i] = x), x + c + s.columnGap), left);
      const rowY: number[] = [];
      for (let i = 0, y = top; i < rowH.length; i++) {
        rowY[i] = y;
        y += (rowH[i] ?? 0) + s.rowGap;
      }
      for (const { p, r, cw, align } of done) {
        const ks = p.k.s;
        const room = (rowH[p.row] ?? 0) - r.h - vMargin(ks, cw);
        if (r.deco && stretches(p.k, align)) r.deco.h = r.h + room;
        place(ops, r, colX[p.col] + lenPx(ks.margin[3], cw), rowY[p.row] + lenPx(ks.margin[0], cw) + crossOffset(align, room));
      }
    }
    return { h: clampH(s, h + vPad(s, cb), cb), base: rowBase[0] !== undefined && rowBase[0] !== null ? top + rowBase[0] : null, ops };
  }

  // --- tables -------------------------------------------------------------------

  private tableColumns(b: Extract<Box, { t: "table" }>): { min: number; max: number; pct: number }[] {
    const cols: { min: number; max: number; pct: number }[] = [];
    for (const row of b.rows)
      row.forEach((c, i) => {
        const col = (cols[i] ??= { min: 0, max: 0, pct: 0 });
        col.min = Math.max(col.min, this.minContent(c));
        col.max = Math.max(col.max, this.maxContent(c));
        const sw = c.s.width;
        if (isFixed(sw) && sw.pct) col.pct = Math.max(col.pct, sw.pct);
      });
    return cols;
  }

  private table(b: Extract<Box, { t: "table" }>, w: number, cb: number): Result {
    const s = b.s;
    const cols = this.tableColumns(b);
    const sumMin = cols.reduce((a, c) => a + c.min, 0);
    const sumMax = cols.reduce((a, c) => a + c.max, 0);
    const inner = Math.max(w - hPad(s, cb), sumMin);
    let widths: number[];
    const pctCols = cols.filter((c) => c.pct);
    if (pctCols.length) {
      // A column of width 100% (the effects column) leaves the others their minimum and takes the rest.
      const others = cols.reduce((a, c) => a + (c.pct ? 0 : c.min), 0);
      widths = cols.map((c) => (c.pct ? Math.max(c.min, (inner - others) / pctCols.length) : c.min));
    } else if (inner >= sumMax) {
      const extra = inner - sumMax;
      widths = cols.map((c) => c.max + (sumMax ? (extra * c.max) / sumMax : extra / cols.length));
    } else widths = this.share(cols, inner, sumMin, sumMax);
    let h = 0;
    let base: number | null = null;
    const ops: PaintOp[] | undefined = this.painting ? [] : undefined;
    const top = lenPx(s.padding[0], cb) + s.border[0];
    const left = lenPx(s.padding[3], cb) + s.border[3];
    for (const row of b.rows) {
      let rh = 0;
      const rs = row.map((c, i) => {
        const r = this.layout(c, widths[i] ?? 0, widths[i] ?? 0);
        rh = Math.max(rh, r.h);
        if (base === null && r.base !== null) base = r.base;
        return r;
      });
      if (ops) {
        // Cells are as tall as their row; their content sits in the middle unless told otherwise.
        let x = left;
        rs.forEach((r, i) => {
          const va = row[i].s.verticalAlign;
          const off = va === "top" ? 0 : va === "bottom" ? rh - r.h : (rh - r.h) / 2;
          if (r.deco) r.deco.h = rh;
          place(ops, r, x, top + h + off, top + h);
          x += widths[i] ?? 0;
        });
      }
      h += rh;
    }
    return { h: clampH(s, h + vPad(s, cb), cb), base: base === null ? null : base + top, ops };
  }

  private share(cols: { min: number; max: number }[], inner: number, sumMin: number, sumMax: number): number[] {
    const room = inner - sumMin;
    const spread = sumMax - sumMin;
    return cols.map((c) => c.min + (spread > 0 ? (room * (c.max - c.min)) / spread : 0));
  }
}

/** `wholeLines`: lay out as WebKit (Safari) does, line heights floored to whole pixels; else as Chrome does. */
export type LayoutOptions = { wholeLines?: boolean };

/** A layout engine for some CSS (the app's stylesheets, joined). */
export function createLayout(css: string, opts: LayoutOptions = {}): Layout {
  const sheet = parseCss(UA_CSS, undefined, 0);
  parseCss(css, sheet, 1);
  return new Layout(sheet, opts);
}

