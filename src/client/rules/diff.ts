// Comparing two versions of an entry, for the history (a compact diff of
// each version against the one before) and for a conflict (field by field,
// with a three-way merge that re-applies my changes to the newer version).
import type { Effect, Entry } from "../../shared/rules/schema.ts";

const json = (v: unknown) => JSON.stringify(v ?? null);
export const same = (a: unknown, b: unknown) => json(a) === json(b);

export type Change =
  | { type: "value"; field: string; label?: string; before: unknown; after: unknown }
  | { type: "effects"; field: string; label?: string; removed: Effect[]; added: Effect[] }
  | { type: "stats"; field: string; label: string; stats: { stat: string; before: unknown; after: unknown }[] }
  | { type: "pos"; field: "pos" }
  | { type: "created" }
  | { type: "deleted" };

function effectsDiff(field: string, label: string | undefined, a: Effect[] = [], b: Effect[] = []): Change | null {
  const count = new Map<string, number>();
  for (const e of a) count.set(json(e), (count.get(json(e)) ?? 0) + 1);
  const added: Effect[] = [];
  for (const e of b) {
    const n = count.get(json(e)) ?? 0;
    if (n > 0) count.set(json(e), n - 1);
    else added.push(e);
  }
  const removed: Effect[] = [];
  const left = new Map(count);
  for (const e of a) {
    const n = left.get(json(e)) ?? 0;
    if (n > 0) {
      removed.push(e);
      left.set(json(e), n - 1);
    }
  }
  if (!added.length && !removed.length) {
    // Same effects, another order.
    return same(a, b) ? null : { type: "effects", field, label, removed: a, added: b };
  }
  return { type: "effects", field, label, removed, added };
}

const SKIP = new Set(["sections", "rows", "subtypes", "effects", "source", "pos", "kind", "id"]);

/** What changed from a to b (either may be null: created / deleted). */
export function diffEntries(a: Entry | null, b: Entry | null): Change[] {
  if (!a && b) return [{ type: "created" }];
  if (a && !b) return [{ type: "deleted" }];
  if (!a || !b) return [];
  const out: Change[] = [];
  const A = a as Record<string, unknown>, B = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (SKIP.has(k) || same(A[k], B[k])) continue;
    out.push({ type: "value", field: k, before: A[k], after: B[k] });
  }
  if (!same(a.source?.page, b.source?.page)) out.push({ type: "value", field: "source.page", before: a.source?.page, after: b.source?.page });
  if (!same(a.source?.text, b.source?.text)) out.push({ type: "value", field: "source.text", before: a.source?.text, after: b.source?.text });
  if (!same(a.pos, b.pos)) out.push({ type: "pos", field: "pos" });
  if ("effects" in A || "effects" in B) {
    const d = effectsDiff("effects", undefined, A.effects as Effect[] | undefined, B.effects as Effect[] | undefined);
    if (d) out.push(d);
  }
  if (a.kind === "archetype" && b.kind === "archetype") {
    const names = [...new Set([...a.sections.map((s) => s.name), ...b.sections.map((s) => s.name)])];
    for (const n of names) {
      const d = effectsDiff(`sections:${n}`, n, a.sections.find((s) => s.name === n)?.effects, b.sections.find((s) => s.name === n)?.effects);
      if (d) out.push(d);
    }
    const ids = [...new Set([...a.subtypes.map((s) => s.id), ...b.subtypes.map((s) => s.id)])];
    for (const id of ids) {
      const sa = a.subtypes.find((s) => s.id === id), sb = b.subtypes.find((s) => s.id === id);
      if (same(sa, sb)) continue;
      if (!sa || !sb || sa.name !== sb.name || !same(sa.range, sb.range)) {
        out.push({ type: "value", field: `subtypes:${id}`, label: (sb ?? sa)!.name, before: sa?.name, after: sb?.name });
        if (!sa || !sb) continue;
      }
      const stats = [...new Set([...Object.keys(sa.stats), ...Object.keys(sb.stats)])]
        .filter((s) => !same((sa.stats as Record<string, unknown>)[s], (sb.stats as Record<string, unknown>)[s]))
        .map((s) => ({ stat: s, before: (sa.stats as Record<string, unknown>)[s], after: (sb.stats as Record<string, unknown>)[s] }));
      if (stats.length) out.push({ type: "stats", field: `subtypes:${id}`, label: sb.name, stats });
    }
  }
  if (a.kind === "table" && b.kind === "table") {
    const n = Math.max(a.rows.length, b.rows.length);
    for (let i = 0; i < n; i++) {
      const ra = a.rows[i], rb = b.rows[i];
      if (same(ra, rb)) continue;
      const label = (rb ?? ra)!.label;
      if (!ra || !rb || !same({ ...ra, effects: 0 }, { ...rb, effects: 0 })) out.push({ type: "value", field: `rows:${i}`, label, before: ra && { ...ra, effects: undefined }, after: rb && { ...rb, effects: undefined } });
      const d = effectsDiff(`rows:${i}:effects`, label, ra?.effects, rb?.effects);
      if (d) out.push(d);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conflicts: field by field (the entry's top-level fields; source split in two)
// ---------------------------------------------------------------------------

export type Field = string; // a top-level key, or "source.page" / "source.text"

function get(e: Entry | null, f: Field): unknown {
  if (!e) return undefined;
  if (f === "source.page") return e.source?.page;
  if (f === "source.text") return e.source?.text;
  return (e as Record<string, unknown>)[f];
}

function put(e: Record<string, unknown>, f: Field, v: unknown): void {
  if (f === "source.page" || f === "source.text") {
    const src = { ...(e.source as object) } as Record<string, unknown>;
    const k = f.slice(7);
    if (v === undefined) delete src[k];
    else src[k] = v;
    e.source = src;
  } else if (v === undefined) delete e[f];
  else e[f] = v;
}

export function fieldsOf(...es: (Entry | null)[]): Field[] {
  const out = new Set<Field>();
  for (const e of es) {
    if (!e) continue;
    for (const k of Object.keys(e)) if (k !== "source") out.add(k);
    out.add("source.page");
    out.add("source.text");
  }
  return [...out];
}

export type Choice = "theirs" | "mine";

/** Fields where theirs and mine differ, with the re-apply choice: mine where I changed it since base, else theirs. */
export function conflictFields(base: Entry | null, theirs: Entry | null, mine: Entry): { field: Field; auto: Choice; both: boolean }[] {
  return fieldsOf(theirs, mine)
    .filter((f) => !same(get(theirs, f), get(mine, f)))
    .map((f) => {
      const iChanged = !same(get(base, f), get(mine, f));
      const theyChanged = !same(get(base, f), get(theirs, f));
      return { field: f, auto: iChanged ? "mine" : "theirs", both: iChanged && theyChanged };
    });
}

/** Theirs with my chosen fields. */
export function merge(theirs: Entry | null, mine: Entry, choices: Record<Field, Choice>): Entry {
  const out = structuredClone((theirs ?? mine) as Record<string, unknown>);
  for (const [f, c] of Object.entries(choices)) put(out, f, structuredClone(get(c === "mine" ? mine : theirs, f)));
  // An entry's identity is mine (the file I'm saving).
  out.kind = mine.kind;
  out.id = mine.id;
  return out as Entry;
}

export const fieldValue = get;

/** Two texts as their common start, what was removed, what was added, and their common end (by words), with short context. */
export function textDiff(a: string, b: string, context = 4): { before: string; removed: string; added: string; after: string } {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  let i = 0;
  while (i < A.length && i < B.length && A[i] === B[i]) i++;
  let j = 0;
  while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++;
  const pre = A.slice(0, i), post = A.slice(A.length - j);
  const words = (l: string[]) => l.filter((w) => w.trim()).length;
  const head = words(pre) > context ? `… ${pre.slice(-2 * context).join("")}` : pre.join("");
  const tail = words(post) > context ? `${post.slice(0, 2 * context).join("")} …` : post.join("");
  return { before: head, removed: A.slice(i, A.length - j).join(""), added: B.slice(i, B.length - j).join(""), after: tail };
}
