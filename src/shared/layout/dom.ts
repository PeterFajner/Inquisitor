// A tiny DOM, enough for Preact to render into and for ./box.ts to read:
// elements with attributes and children, text nodes. Cards are rendered into
// it (in the browser and on the server alike) to work out their heights
// without a browser's layout.

export class FNode {
  nodeType: number;
  parentNode: FElement | null = null;
  childNodes: FNode[] = [];
  constructor(type: number) {
    this.nodeType = type;
  }
  get ownerDocument(): FDocument {
    return DOC;
  }
  get firstChild(): FNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): FNode | null {
    const s = this.parentNode?.childNodes;
    if (!s) return null;
    return s[s.indexOf(this) + 1] ?? null;
  }
  get previousSibling(): FNode | null {
    const s = this.parentNode?.childNodes;
    if (!s) return null;
    return s[s.indexOf(this) - 1] ?? null;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

export class FText extends FNode {
  data: string;
  constructor(data: string) {
    super(3);
    this.data = data;
  }
  get nodeValue(): string {
    return this.data;
  }
  get textContent(): string {
    return this.data;
  }
}

export class FElement extends FNode {
  localName: string;
  namespaceURI: string | null;
  attrs = new Map<string, string>();
  style: Record<string, string> & { cssText: string; setProperty(k: string, v: string): void };
  constructor(tag: string, ns: string | null = null) {
    super(1);
    this.localName = tag;
    this.namespaceURI = ns;
    const el = this;
    const style: Record<string, unknown> = {
      setProperty(k: string, v: string) {
        style[k] = v;
      },
    };
    Object.defineProperty(style, "cssText", {
      get: () =>
        Object.entries(style)
          .filter(([k, v]) => typeof v === "string" && v !== "" && k !== "cssText")
          .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${v}`)
          .join("; "),
      set: (v: string) => {
        for (const k of Object.keys(style)) if (typeof style[k] === "string") delete style[k];
        for (const d of v.split(";")) {
          const c = d.indexOf(":");
          if (c > 0) style[d.slice(0, c).trim()] = d.slice(c + 1).trim();
        }
      },
    });
    this.style = style as FElement["style"];
    void el;
  }
  get tagName(): string {
    return this.localName.toUpperCase();
  }
  get nodeName(): string {
    return this.tagName;
  }
  getAttribute(name: string): string | null {
    if (name === "style") {
      const s = this.style.cssText;
      return s || null;
    }
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: unknown): void {
    if (name === "style") this.style.cssText = String(value);
    else this.attrs.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  insertBefore(node: FNode, ref: FNode | null): FNode {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    return node;
  }
  appendChild(node: FNode): FNode {
    return this.insertBefore(node, null);
  }
  removeChild(node: FNode): FNode {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  get textContent(): string {
    return this.childNodes.map((c) => (c as FText | FElement).textContent).join("");
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = v ? [new FText(v)] : [];
    for (const c of this.childNodes) c.parentNode = this;
  }
}

export class FDocument {
  nodeType = 9;
  createElement(tag: string): FElement {
    return new FElement(tag.toLowerCase());
  }
  createElementNS(ns: string | null, tag: string): FElement {
    return new FElement(tag, ns);
  }
  createTextNode(data: string): FText {
    return new FText(data);
  }
}

const DOC = new FDocument();

/** A detached element to render into (e.g. Preact's render(vnode, el)). */
export const createRoot = (tag = "div"): FElement => DOC.createElement(tag);
