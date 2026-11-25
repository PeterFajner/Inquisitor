// The rules page's pure parts (./RulesBook.tsx): a tab per region
// (./regions.ts), each one page of its shelves (./shelves.ts groupShelves);
// within a shelf the cards A–Z, placed in columns (masonry: each card where
// it would sit highest, ties to the left, so the page reads across then
// down); the address (#<card key> or #<region>); which card a link goes to
// and on which tab; and which card the reader is at. No DOM.
import type { Pack } from "../../shared/rules/schema.ts";
import type { RefKind } from "./ctx.ts";
import type { Key } from "./model.ts";
import { COL, GAP } from "./sizes.ts";

export type Placed = { x: number; y: number; w: number };
export type Masonry = { pos: Map<string, Placed>; h: number; w: number; cols: number };

/** How many columns of `unit` (with `gap` between) fit in `width`; at least one. */
export const columnsIn = (width: number, unit = COL, gap = GAP): number => Math.max(1, Math.floor((width + gap) / (unit + gap)));

/**
 * Cards (in order) in `columnsIn(width)` columns: a card spans as many as its
 * width takes (a wide card two, a very wide one three; never more than
 * there are, and then no wider than `width`), and goes where its top is
 * highest, ties to the left. `h` the tallest column; `w` the width used.
 */
export function masonry(cards: readonly { id: string; w: number; h: number }[], width: number, unit = COL, gap = GAP): Masonry {
  const n = columnsIn(width, unit, gap);
  const tops = new Array<number>(n).fill(0);
  const pos = new Map<string, Placed>();
  let used = 0;
  for (const c of cards) {
    const span = Math.min(n, Math.max(1, Math.ceil((c.w + gap) / (unit + gap) - 1e-9)));
    const w = Math.min(c.w, Math.max(width, unit));
    let at = 0, y = Infinity;
    for (let i = 0; i + span <= n; i++) {
      let top = 0;
      for (let j = i; j < i + span; j++) top = Math.max(top, tops[j]);
      if (top < y - 1e-6) [at, y] = [i, top];
    }
    for (let j = at; j < at + span; j++) tops[j] = y + c.h + gap;
    const x = at * (unit + gap);
    pos.set(c.id, { x, y, w });
    used = Math.max(used, x + w);
  }
  return { pos, h: cards.length ? Math.max(...tops) - gap : 0, w: used, cols: n };
}

/** What the address names: a card (and its tab), a tab, or nothing known. */
export type Place = { tab: string; key: Key | null } | null;

/** The address for a card or a tab. */
export const hashOf = (p: { tab: string; key: Key | null }): string => `#${encodeURIComponent(p.key ?? p.tab)}`;

/** Reads the address: "#<pack>:<kind>/<id>" (a card's key; its tab from tabOf) or "#<region>". */
export function parseHash(hash: string, tabOf: (key: Key) => string | null, tabs: readonly string[]): Place {
  let h: string;
  try {
    h = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return null;
  }
  if (!h) return null;
  if (h.includes(":")) {
    const tab = tabOf(h);
    return tab ? { tab, key: h } : null;
  }
  return tabs.includes(h) ? { tab: h, key: null } : null;
}

/**
 * The cards the page shows: of the shown books' entries, each kind and id
 * once, the version the compendium uses (`origin`: the topmost shown book's,
 * as packOrder stacks them). Hiding that book shows the one underneath.
 */
export function winners<T extends { pack: string; entry: { kind: string; id: string } }>(items: readonly [Key, T][], origin: ReadonlyMap<string, string>): [Key, T][] {
  return items.filter(([, it]) => origin.get(`${it.entry.kind}/${it.entry.id}`) === it.pack);
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Names as the Table of Contents and search list them: a card's name, or,
 * where a card of the same tab from another book has the same name (case
 * and accents aside), the name with its book's in brackets (`book`: the
 * pack's short name, "Injuries (Crone World)", "Injuries (Loyalist Edition)"). Cards' own titles stay as they are.
 */
export function listNames(cards: readonly { key: Key; name: string; tab: string; pack: string; book: string }[]): Map<Key, string> {
  const packs = new Map<string, Set<string>>();
  const id = (c: { name: string; tab: string }) => `${c.tab}\u0000${fold(c.name.trim())}`;
  for (const c of cards) {
    const k = id(c);
    let s = packs.get(k);
    if (!s) packs.set(k, (s = new Set()));
    s.add(c.pack);
  }
  return new Map(cards.map((c) => [c.key, packs.get(id(c))!.size > 1 ? `${c.name} (${c.book})` : c.name]));
}

/** A book's name where room is short (listNames' brackets): its `short`, else its name. */
export const shortName = (p: Pack): string => p.short ?? p.name;

/** The card a link names (a chip's reference, a table's "Rolled on by"): the topmost shown book's entry, as the compendium has it. */
export function linkTarget(origin: ReadonlyMap<string, string>, kind: RefKind, id: string): Key | null {
  const pack = origin.get(`${kind}/${id}`);
  return pack ? `${pack}:${kind}/${id}` : null;
}

/**
 * The card the reader is at: of the cards whose tops are at or above
 * `line` (page coordinates), the last in reading order; the first card when
 * none is yet. `tops` in reading order.
 */
export function cardAt(tops: readonly { id: string; top: number }[], line: number): string | null {
  let at: string | null = tops[0]?.id ?? null;
  for (const t of tops) if (t.top <= line) at = t.id;
  return at;
}

/** The cards to mount first, nearest `[from, to]` (page coordinates) first; those within it, then the rest by distance. */
export function byDistance(cards: readonly { id: string; top: number; h: number }[], from: number, to: number): string[] {
  const d = (c: { top: number; h: number }) => (c.top + c.h < from ? from - (c.top + c.h) : c.top > to ? c.top - to : 0);
  return cards
    .map((c, i) => ({ id: c.id, d: d(c), i }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((c) => c.id);
}
