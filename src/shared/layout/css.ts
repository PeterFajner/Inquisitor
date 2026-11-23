// A small CSS engine for the card layout (./box.ts): parses the app's own
// stylesheets, matches their selectors against a DOM-like tree and works out
// the computed values that decide a box's size. Only what sizes boxes is
// kept (display, box model, flex, grid, fonts, white-space…); colours and
// the rest are dropped. Rules inside @media, and selectors with pseudo
// classes it can't know statically (:hover, :focus, :has…), never match:
// the cards' size must not depend on them.

/** What ./box.ts needs of a DOM node: real DOM nodes and ./dom.ts's both fit. */
export interface LNode {
  readonly nodeType: number;
  readonly localName?: string;
  readonly data?: string;
  readonly parentNode: LNode | null;
  readonly childNodes: ArrayLike<LNode>;
  getAttribute?(name: string): string | null;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

type Compound = {
  tag: string | null;
  classes: string[];
  attrs: { name: string; value: string | null }[];
  pseudos: string[];
};
type Complex = { parts: Compound[]; combinators: string[]; spec: number };

const PSEUDOS = new Set(["first-of-type", "last-of-type", "first-child", "last-child", "empty", "nth-child(odd)", "nth-child(even)"]);

function parseCompound(s: string): Compound | null {
  const c: Compound = { tag: null, classes: [], attrs: [], pseudos: [] };
  let i = 0;
  const ident = () => {
    const m = /^-?[_a-zA-Z0-9-]+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  if (s[0] === "*") i = 1;
  else if (/[a-zA-Z]/.test(s[0] ?? "")) c.tag = ident()!.toLowerCase();
  while (i < s.length) {
    const ch = s[i];
    if (ch === ".") {
      i++;
      const n = ident();
      if (!n) return null;
      c.classes.push(n);
    } else if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) return null;
      const m = /^\s*([\w-]+)\s*(?:=\s*["']?([^"'\]]*)["']?)?\s*$/.exec(s.slice(i + 1, end));
      if (!m) return null;
      c.attrs.push({ name: m[1], value: m[2] ?? null });
      i = end + 1;
    } else if (ch === ":") {
      if (s[i + 1] === ":") return null; // pseudo-elements: never in the box tree
      const m = /^:([\w-]+(?:\([^)]*\))?)/.exec(s.slice(i));
      if (!m || !PSEUDOS.has(m[1])) return null;
      c.pseudos.push(m[1]);
      i += m[0].length;
    } else return null;
  }
  return c;
}

function parseSelector(sel: string): Complex | null {
  const tokens = sel.trim().replace(/\s*([>+~])\s*/g, " $1 ").split(/\s+/);
  const parts: Compound[] = [];
  const combinators: string[] = [];
  let pending = " ";
  for (const t of tokens) {
    if (t === ">" || t === "+" || t === "~") {
      pending = t;
      continue;
    }
    const c = parseCompound(t);
    if (!c) return null;
    if (parts.length) combinators.push(pending);
    parts.push(c);
    pending = " ";
  }
  if (!parts.length) return null;
  let a = 0, b = 0;
  for (const p of parts) {
    a += p.classes.length + p.attrs.length + p.pseudos.length;
    if (p.tag) b++;
  }
  return { parts, combinators, spec: a * 1000 + b };
}

const isEl = (n: LNode | null): n is LNode => !!n && n.nodeType === 1;
const classesOf = (n: LNode): string[] => (n.getAttribute?.("class") ?? "").split(/\s+/).filter(Boolean);

function prevElement(n: LNode): LNode | null {
  const p = n.parentNode;
  if (!p) return null;
  const kids = p.childNodes;
  let prev: LNode | null = null;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k === n) return prev;
    if (k.nodeType === 1) prev = k;
  }
  return null;
}

function matchPseudo(n: LNode, p: string): boolean {
  const parent = n.parentNode;
  const sibs = parent ? Array.from(parent.childNodes).filter(isEl) : [n];
  switch (p) {
    case "first-child":
      return sibs[0] === n;
    case "last-child":
      return sibs.at(-1) === n;
    case "first-of-type":
      return sibs.find((s) => s.localName === n.localName) === n;
    case "last-of-type":
      return sibs.filter((s) => s.localName === n.localName).at(-1) === n;
    case "nth-child(odd)":
      return sibs.indexOf(n) % 2 === 0;
    case "nth-child(even)":
      return sibs.indexOf(n) % 2 === 1;
    case "empty":
      return Array.from(n.childNodes).every((k) => k.nodeType !== 1 && (k.nodeType !== 3 || !k.data));
  }
  return false;
}

function matchCompound(n: LNode, c: Compound): boolean {
  if (c.tag && n.localName !== c.tag) return false;
  if (c.classes.length) {
    const cl = classesOf(n);
    for (const x of c.classes) if (!cl.includes(x)) return false;
  }
  for (const a of c.attrs) {
    const v = n.getAttribute?.(a.name) ?? null;
    if (v === null || (a.value !== null && v !== a.value)) return false;
  }
  for (const p of c.pseudos) if (!matchPseudo(n, p)) return false;
  return true;
}

function matchFrom(n: LNode, sel: Complex, i: number): boolean {
  if (!matchCompound(n, sel.parts[i])) return false;
  if (i === 0) return true;
  const comb = sel.combinators[i - 1];
  if (comb === ">") {
    const p = n.parentNode;
    return isEl(p) && matchFrom(p, sel, i - 1);
  }
  if (comb === "+") {
    const p = prevElement(n);
    return !!p && matchFrom(p, sel, i - 1);
  }
  if (comb === "~") {
    for (let p = prevElement(n); p; p = prevElement(p)) if (matchFrom(p, sel, i - 1)) return true;
    return false;
  }
  for (let p = n.parentNode; isEl(p); p = p.parentNode) if (matchFrom(p, sel, i - 1)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Stylesheets
// ---------------------------------------------------------------------------

type Rule = { sel: Complex; decls: [string, string][]; order: number; layer: number };

export type Sheet = {
  /** Rules by the rightmost compound's first class, or its tag, or "*". */
  byKey: Map<string, Rule[]>;
  vars: Map<string, string>;
};

/** Parses CSS text into a sheet (a new one, or more rules for one); rules of a
 * higher `layer` win over lower ones whatever their specificity (the
 * browser's defaults are layer 0, the app's 1). */
export function parseCss(text: string, sheet: Sheet = { byKey: new Map(), vars: new Map() }, layer = 1): Sheet {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "");
  let order = [...sheet.byKey.values()].reduce((n, l) => n + l.length, 0);
  let i = 0;
  const skipBlock = (from: number): number => {
    let depth = 0;
    for (let j = from; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) return j + 1;
    }
    return src.length;
  };
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    // A lone "}" left from an at-rule block, or a ";" statement: skip it.
    const semi = prelude.lastIndexOf(";");
    const sel = (semi >= 0 ? prelude.slice(semi + 1) : prelude).replace(/^}+/, "").trim();
    if (sel.startsWith("@")) {
      i = skipBlock(open);
      continue;
    }
    const close = src.indexOf("}", open);
    const body = src.slice(open + 1, close);
    i = close + 1;
    const decls: [string, string][] = [];
    for (const d of body.split(";")) {
      const c = d.indexOf(":");
      if (c < 0) continue;
      const prop = d.slice(0, c).trim().toLowerCase();
      const value = d.slice(c + 1).replace(/!important/, "").trim();
      if (prop.startsWith("--")) {
        if (sel === ":root") sheet.vars.set(prop, value);
        continue;
      }
      decls.push([prop, value]);
    }
    if (!decls.length) continue;
    for (const s of splitTop(sel, ",")) {
      const cx = parseSelector(s);
      if (!cx) continue;
      const last = cx.parts.at(-1)!;
      const key = last.classes[0] ? `.${last.classes[0]}` : (last.tag ?? "*");
      let list = sheet.byKey.get(key);
      if (!list) sheet.byKey.set(key, (list = []));
      list.push({ sel: cx, decls, order: order++, layer });
    }
  }
  return sheet;
}

function splitTop(s: string, by: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === by && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

/** The declarations that apply to an element, in cascade order (later wins). */
function declarationsFor(sheet: Sheet, n: LNode): [string, string][] {
  const keys = ["*", n.localName ?? "", ...classesOf(n).map((c) => `.${c}`)];
  const hits: Rule[] = [];
  for (const k of keys) for (const r of sheet.byKey.get(k) ?? []) if (matchFrom(n, r.sel, r.sel.parts.length - 1)) hits.push(r);
  hits.sort((a, b) => a.layer - b.layer || a.sel.spec - b.sel.spec || a.order - b.order);
  const out: [string, string][] = [];
  const seen = new Set<Rule>();
  for (const r of hits) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(...r.decls);
  }
  // Inline style last.
  const inline = n.getAttribute?.("style");
  if (inline)
    for (const d of inline.split(";")) {
      const c = d.indexOf(":");
      if (c > 0) out.push([d.slice(0, c).trim().toLowerCase(), d.slice(c + 1).trim()]);
    }
  return out;
}

// ---------------------------------------------------------------------------
// Computed style
// ---------------------------------------------------------------------------

/** A length: px, a percentage (of the containing block's width), or auto/none/content keywords. */
export type Len = { px: number; pct: number } | "auto" | "none" | "max-content" | "min-content" | "fit-content";
export type Track = { kind: "px"; px: number } | { kind: "fr"; fr: number } | { kind: "max-content" } | { kind: "min-content" } | { kind: "auto" };

export type Style = {
  display: string;
  position: string;
  boxSizing: string;
  width: Len;
  minWidth: Len;
  maxWidth: Len;
  height: Len;
  minHeight: Len;
  maxHeight: Len;
  margin: [Len, Len, Len, Len];
  padding: [Len, Len, Len, Len];
  border: [number, number, number, number];
  flexDirection: string;
  flexWrap: string;
  flexGrow: number;
  flexShrink: number;
  flexBasis: Len | "content";
  alignItems: string;
  alignSelf: string;
  rowGap: number;
  columnGap: number;
  gridTemplateColumns: Track[];
  gridColumn: [number | "auto", number | "auto" | { span: number }];
  overflowX: string;
  overflowY: string;
  verticalAlign: string;
  borderCollapse: string;
  // inherited
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: string;
  /** px, or a multiple of the font size when `lineHeightN`. */
  lineHeight: number | "normal";
  lineHeightIsNumber: boolean;
  whiteSpace: string;
  textAlign: string;
};

const INHERITED = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "lineHeightIsNumber", "whiteSpace", "textAlign"] as const;

export const ROOT_STYLE: Style = {
  display: "block", position: "static", boxSizing: "content-box",
  width: "auto", minWidth: "auto", maxWidth: "none", height: "auto", minHeight: "auto", maxHeight: "none",
  margin: [px(0), px(0), px(0), px(0)], padding: [px(0), px(0), px(0), px(0)], border: [0, 0, 0, 0],
  flexDirection: "row", flexWrap: "nowrap", flexGrow: 0, flexShrink: 1, flexBasis: "auto",
  alignItems: "normal", alignSelf: "auto", rowGap: 0, columnGap: 0,
  gridTemplateColumns: [], gridColumn: ["auto", "auto"],
  overflowX: "visible", overflowY: "visible", verticalAlign: "baseline", borderCollapse: "separate",
  fontFamily: "serif", fontSize: 16, fontWeight: 400, fontStyle: "normal", lineHeight: "normal", lineHeightIsNumber: false,
  whiteSpace: "normal", textAlign: "start",
};

function px(n: number): Len {
  return { px: n, pct: 0 };
}

function resolveVars(v: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 8 || !v.includes("var(")) return v;
  return resolveVars(
    v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name: string, fb?: string) => vars.get(name) ?? fb ?? ""),
    vars,
    depth + 1,
  );
}

function length(v: string, fontSize: number): Len | null {
  v = v.trim();
  if (v === "auto" || v === "none" || v === "max-content" || v === "min-content" || v === "fit-content") return v;
  if (v === "0") return px(0);
  const m = /^(-?[\d.]+)(px|em|rem|%)$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (m[2] === "px") return px(n);
  if (m[2] === "em") return px(n * fontSize);
  if (m[2] === "rem") return px(n * 16);
  return { px: 0, pct: n / 100 };
}

const pxOf = (v: string, fontSize: number): number => {
  const l = length(v, fontSize);
  return l && typeof l === "object" ? l.px : 0;
};

function four<T>(vals: T[]): [T, T, T, T] {
  const [a, b = a, c = a, d = b] = vals;
  return [a, b, c, d];
}

function tracks(v: string): Track[] {
  const out: Track[] = [];
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of v.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    const rep = /^repeat\((\d+),\s*(.+)\)$/.exec(p);
    if (rep) {
      for (let i = 0; i < +rep[1]; i++) out.push(...tracks(rep[2]));
      continue;
    }
    const mm = /^minmax\(\s*([^,]+),\s*(.+)\)$/.exec(p);
    const t = mm ? mm[2].trim() : p;
    if (t.endsWith("fr")) out.push({ kind: "fr", fr: parseFloat(t) });
    else if (t === "max-content") out.push({ kind: "max-content" });
    else if (t === "min-content") out.push({ kind: "min-content" });
    else if (t === "auto") out.push({ kind: "auto" });
    else out.push({ kind: "px", px: pxOf(t, 16) });
  }
  return out;
}

const WEIGHTS: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 700 };
const SIZES: Record<string, number> = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32 };

/** The font shorthand: [style] [variant] [weight] size[/line-height] family. */
function applyFont(s: Style, v: string, parent: Style) {
  const m = /^((?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|\d{3})\s+)*)([\d.]+(?:px|em|rem|%)|[a-z-]+)(?:\s*\/\s*([\d.]+(?:px|em|%)?|normal))?\s+(.+)$/.exec(v.trim());
  if (!m) return;
  s.fontStyle = "normal";
  s.fontWeight = 400;
  for (const w of m[1].trim().split(/\s+/).filter(Boolean)) {
    if (w === "italic" || w === "oblique") s.fontStyle = "italic";
    else if (/^\d{3}$/.test(w)) s.fontWeight = +w;
    else if (w in WEIGHTS) s.fontWeight = WEIGHTS[w];
  }
  s.fontSize = fontSizeOf(m[2], parent.fontSize);
  applyLineHeight(s, m[3] ?? "normal");
  s.fontFamily = m[4].trim();
}

function fontSizeOf(v: string, parentSize: number): number {
  if (v in SIZES) return SIZES[v];
  const m = /^([\d.]+)(px|em|rem|%)$/.exec(v);
  if (!m) return parentSize;
  const n = parseFloat(m[1]);
  return m[2] === "px" ? n : m[2] === "em" ? n * parentSize : m[2] === "rem" ? n * 16 : (n / 100) * parentSize;
}

function applyLineHeight(s: Style, v: string) {
  if (v === "normal") {
    s.lineHeight = "normal";
    s.lineHeightIsNumber = false;
  } else if (/^[\d.]+$/.test(v)) {
    s.lineHeight = parseFloat(v);
    s.lineHeightIsNumber = true;
  } else {
    const m = /^([\d.]+)(px|em|%)$/.exec(v);
    if (!m) return;
    const n = parseFloat(m[1]);
    s.lineHeight = m[2] === "px" ? n : m[2] === "em" ? n * s.fontSize : (n / 100) * s.fontSize;
    s.lineHeightIsNumber = false;
  }
}

function borderWidth(v: string): number | null {
  const parts = v.trim().split(/\s+/);
  if (parts.includes("none") || parts.includes("hidden")) return 0;
  for (const p of parts) {
    if (p === "thin") return 1;
    if (p === "medium") return 3;
    if (p === "thick") return 5;
    const m = /^([\d.]+)px$/.exec(p);
    if (m) return parseFloat(m[1]);
    if (p === "0") return 0;
  }
  // A style without a width: medium.
  return parts.some((p) => /^(solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(p)) ? 3 : null;
}

function gridLine(v: string): number | "auto" | { span: number } {
  v = v.trim();
  if (v.startsWith("span")) return { span: parseInt(v.slice(4)) || 1 };
  const n = parseInt(v);
  return Number.isFinite(n) ? n : "auto";
}

/** The computed style of an element, given its parent's. */
export function computeStyle(sheet: Sheet, n: LNode, parent: Style): Style {
  const s: Style = { ...ROOT_STYLE };
  for (const k of INHERITED) (s as Record<string, unknown>)[k] = parent[k];
  s.margin = [...ROOT_STYLE.margin];
  s.padding = [...ROOT_STYLE.padding];
  s.border = [...ROOT_STYLE.border];
  const decls = declarationsFor(sheet, n);
  // Font size first: em lengths depend on it.
  for (const [p, raw] of decls) {
    const v = resolveVars(raw, sheet.vars);
    if (p === "font-size") s.fontSize = fontSizeOf(v, parent.fontSize);
    else if (p === "font") applyFont(s, v, parent);
  }
  const borderSides = ["top", "right", "bottom", "left"];
  for (const [p, raw] of decls) {
    const v = resolveVars(raw, sheet.vars).trim();
    const fs = s.fontSize;
    switch (p) {
      case "display":
        s.display = v;
        break;
      case "position":
        s.position = v;
        break;
      case "box-sizing":
        s.boxSizing = v;
        break;
      case "width":
      case "min-width":
      case "max-width":
      case "height":
      case "min-height":
      case "max-height": {
        const l = length(v, fs);
        if (l) s[p === "width" ? "width" : p === "min-width" ? "minWidth" : p === "max-width" ? "maxWidth" : p === "height" ? "height" : p === "min-height" ? "minHeight" : "maxHeight"] = l;
        break;
      }
      case "margin":
      case "padding": {
        const l = v.split(/\s+/).map((x) => length(x, fs) ?? px(0));
        s[p] = four(l);
        break;
      }
      case "margin-top": case "margin-right": case "margin-bottom": case "margin-left":
      case "padding-top": case "padding-right": case "padding-bottom": case "padding-left": {
        const [what, side] = p.split("-") as ["margin" | "padding", string];
        s[what][borderSides.indexOf(side)] = length(v, fs) ?? px(0);
        break;
      }
      case "margin-block":
      case "padding-block": {
        const what = p.startsWith("margin") ? "margin" : "padding";
        const [a, b = a] = v.split(/\s+/).map((x) => length(x, fs) ?? px(0));
        s[what][0] = a;
        s[what][2] = b;
        break;
      }
      case "margin-inline":
      case "padding-inline": {
        const what = p.startsWith("margin") ? "margin" : "padding";
        const [a, b = a] = v.split(/\s+/).map((x) => length(x, fs) ?? px(0));
        s[what][3] = a;
        s[what][1] = b;
        break;
      }
      case "border": {
        const w = borderWidth(v);
        if (w !== null) s.border = [w, w, w, w];
        break;
      }
      case "border-top": case "border-right": case "border-bottom": case "border-left": {
        const w = borderWidth(v);
        if (w !== null) s.border[borderSides.indexOf(p.slice(7))] = w;
        break;
      }
      case "border-width":
        s.border = four(v.split(/\s+/).map((x) => pxOf(x, fs)));
        break;
      case "border-style":
        if (v === "none" || v === "hidden") s.border = [0, 0, 0, 0];
        break;
      case "flex-direction":
        s.flexDirection = v;
        break;
      case "flex-wrap":
        s.flexWrap = v;
        break;
      case "flex-flow":
        for (const x of v.split(/\s+/)) {
          if (x.startsWith("row") || x.startsWith("column")) s.flexDirection = x;
          else s.flexWrap = x;
        }
        break;
      case "flex": {
        const parts = v.split(/\s+/);
        if (v === "none") Object.assign(s, { flexGrow: 0, flexShrink: 0, flexBasis: "auto" });
        else if (v === "auto") Object.assign(s, { flexGrow: 1, flexShrink: 1, flexBasis: "auto" });
        else {
          const nums = parts.filter((x) => /^[\d.]+$/.test(x));
          const basis = parts.find((x) => !/^[\d.]+$/.test(x));
          s.flexGrow = nums[0] !== undefined ? parseFloat(nums[0]) : 1;
          s.flexShrink = nums[1] !== undefined ? parseFloat(nums[1]) : 1;
          s.flexBasis = basis ? (length(basis, fs) ?? "auto") : { px: 0, pct: 0 };
        }
        break;
      }
      case "flex-grow":
        s.flexGrow = parseFloat(v);
        break;
      case "flex-shrink":
        s.flexShrink = parseFloat(v);
        break;
      case "flex-basis":
        s.flexBasis = v === "content" ? "content" : (length(v, fs) ?? "auto");
        break;
      case "align-items":
        s.alignItems = v;
        break;
      case "align-self":
        s.alignSelf = v;
        break;
      case "gap":
      case "grid-gap": {
        const [r, c = r] = v.split(/\s+/);
        s.rowGap = pxOf(r, fs);
        s.columnGap = pxOf(c, fs);
        break;
      }
      case "row-gap":
        s.rowGap = pxOf(v, fs);
        break;
      case "column-gap":
        s.columnGap = pxOf(v, fs);
        break;
      case "grid-template-columns":
        s.gridTemplateColumns = tracks(v);
        break;
      case "grid-column": {
        const [a, b] = v.split("/");
        s.gridColumn = [gridLine(a) as number | "auto", b === undefined ? "auto" : gridLine(b)];
        break;
      }
      case "overflow": {
        const [x, y = x] = v.split(/\s+/);
        s.overflowX = x;
        s.overflowY = y;
        break;
      }
      case "overflow-x":
        s.overflowX = v;
        break;
      case "overflow-y":
        s.overflowY = v;
        break;
      case "vertical-align":
        s.verticalAlign = v;
        break;
      case "border-collapse":
        s.borderCollapse = v;
        break;
      case "font-family":
        s.fontFamily = v;
        break;
      case "font-weight":
        s.fontWeight = /^\d+$/.test(v) ? +v : (WEIGHTS[v] ?? (v === "bolder" ? Math.min(900, parent.fontWeight + 300) : 400));
        break;
      case "font-style":
        s.fontStyle = v === "normal" ? "normal" : "italic";
        break;
      case "line-height":
        applyLineHeight(s, v);
        break;
      case "white-space":
        s.whiteSpace = v;
        break;
      case "text-align":
        s.textAlign = v;
        break;
    }
  }
  // One overflow direction scrolling makes the other one scroll too.
  if (s.overflowX !== "visible" && s.overflowY === "visible") s.overflowY = "auto";
  if (s.overflowY !== "visible" && s.overflowX === "visible") s.overflowX = "auto";
  return s;
}

/** The used line height in px. */
export function lineHeightPx(s: Style, normal: number): number {
  if (s.lineHeight === "normal") return normal;
  return s.lineHeightIsNumber ? s.lineHeight * s.fontSize : s.lineHeight;
}

// The browser's own defaults for the elements cards use.
export const UA_CSS = `
html, body, div, section, article, header, footer, main, nav, aside, blockquote, p, h1, h2, h3, h4, h5, h6, ul, ol, li, form, figure { display: block }
li { display: list-item }
span, a, em, strong, b, i, small, code, label, abbr, del, ins { display: inline }
h3 { font-size: 1.17em; font-weight: bold; margin: 1em 0 }
h4 { font-weight: bold; margin: 1.33em 0 }
p, blockquote { margin: 1em 0 }
blockquote { margin: 1em 40px }
ul, ol { margin: 1em 0; padding-left: 40px }
b, strong { font-weight: bold }
em, i { font-style: italic }
table { display: table; border-collapse: separate }
thead { display: table-header-group }
tbody { display: table-row-group }
tr { display: table-row }
td, th { display: table-cell; padding: 1px }
th { font-weight: bold }
img, svg { display: inline }
button { display: inline-block; padding: 1px 6px; border: 2px outset; }
script, style, template, head, title, meta, link { display: none }
`;
