// The version tree's layout: a tidy tree, root at the left, each generation
// one column to the right, children in the order given (oldest first). Cards
// have their own (measured) heights, so subtrees are packed by their
// contours: a sibling subtree goes as close below the one before as every
// column they share allows, and a parent sits centred on its first and last
// child (in line with an only child, so a straight history is a straight
// row). Several roots (a version whose parent is missing) stack as a forest.
// Pure and deterministic.

export type TreeNode = { id: string; parent: string | null; h: number };
export type TreeOptions = { w: number; gapX?: number; gapY?: number; origin?: { x: number; y: number } };
export type TreeLayout = { positions: Map<string, { x: number; y: number }>; depth: Map<string, number>; bounds: { x: number; y: number; w: number; h: number } };

type Sub = { ys: Map<string, number>; top: number[]; bottom: number[] };

export function tidyTree(nodes: readonly TreeNode[], opts: TreeOptions): TreeLayout {
  const gapX = opts.gapX ?? 64;
  const gapY = opts.gapY ?? 24;
  const ox = opts.origin?.x ?? 0;
  const oy = opts.origin?.y ?? 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of nodes) {
    if (n.parent !== null && byId.has(n.parent) && n.parent !== n.id) {
      const k = kids.get(n.parent);
      if (k) k.push(n.id);
      else kids.set(n.parent, [n.id]);
    } else roots.push(n.id);
  }

  // Post-order without recursion (long straight histories are deep).
  const order: string[] = [];
  const seen = new Set<string>();
  const walk = (r: string) => {
    const stack: [string, number][] = [[r, 0]];
    seen.add(r);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const ch = kids.get(top[0]) ?? [];
      if (top[1] < ch.length) {
        const c = ch[top[1]++];
        if (!seen.has(c)) {
          seen.add(c);
          stack.push([c, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  };
  for (const r of roots) walk(r);
  // A parent cycle (bad data) has no root: its first version becomes one.
  for (const n of nodes)
    if (!seen.has(n.id)) {
      roots.push(n.id);
      walk(n.id);
    }

  // Stack subtrees: b goes below a by the closest offset their shared columns allow.
  const place = (acc: Sub | null, b: Sub): { merged: Sub; offset: number } => {
    if (!acc) return { merged: b, offset: 0 };
    let offset = -Infinity;
    const n = Math.min(acc.bottom.length, b.top.length);
    for (let d = 0; d < n; d++) offset = Math.max(offset, acc.bottom[d] + gapY - b.top[d]);
    const ys = acc.ys;
    for (const [id, y] of b.ys) ys.set(id, y + offset);
    const top = acc.top;
    const bottom = acc.bottom;
    for (let d = 0; d < b.top.length; d++) {
      if (d < top.length) {
        top[d] = Math.min(top[d], b.top[d] + offset);
        bottom[d] = Math.max(bottom[d], b.bottom[d] + offset);
      } else {
        top.push(b.top[d] + offset);
        bottom.push(b.bottom[d] + offset);
      }
    }
    return { merged: acc, offset };
  };

  const subs = new Map<string, Sub>();
  for (const id of order) {
    const h = byId.get(id)!.h;
    const ch = (kids.get(id) ?? []).filter((c) => subs.has(c));
    if (!ch.length) {
      subs.set(id, { ys: new Map([[id, 0]]), top: [0], bottom: [h] });
      continue;
    }
    let acc: Sub | null = null;
    for (const c of ch) {
      acc = place(acc, subs.get(c)!).merged;
      subs.delete(c);
    }
    const a = acc!;
    const mid = (c: string) => a.ys.get(c)! + byId.get(c)!.h / 2;
    const y = (mid(ch[0]) + mid(ch[ch.length - 1])) / 2 - h / 2;
    a.ys.set(id, y);
    a.top.unshift(y);
    a.bottom.unshift(y + h);
    subs.set(id, a);
  }

  let forest: Sub | null = null;
  for (const r of roots) forest = place(forest, subs.get(r)!).merged;

  const depth = new Map<string, number>();
  for (const r of roots) {
    const stack: [string, number][] = [[r, 0]];
    while (stack.length) {
      const [id, d] = stack.pop()!;
      if (depth.has(id)) continue;
      depth.set(id, d);
      for (const c of kids.get(id) ?? []) stack.push([c, d + 1]);
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  let minY = Infinity;
  for (const y of forest?.ys.values() ?? []) minY = Math.min(minY, y);
  if (!Number.isFinite(minY)) minY = 0;
  let maxX = ox;
  let maxY = oy;
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const p = { x: ox + d * (opts.w + gapX), y: oy + (forest?.ys.get(n.id) ?? 0) - minY };
    positions.set(n.id, p);
    maxX = Math.max(maxX, p.x + opts.w);
    maxY = Math.max(maxY, p.y + n.h);
  }
  return { positions, depth, bounds: { x: ox, y: oy, w: maxX - ox, h: maxY - oy } };
}
