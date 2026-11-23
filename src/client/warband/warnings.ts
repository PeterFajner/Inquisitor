// The book's warband rules as warnings (never blocks): what a warband of
// built characters breaks, each with the book's own sentence. Pure (no DOM).
//
// Where each check comes from (rules are data):
// - `warband` effects ({ warband: { max, archetype } }) in the rule entries:
//   more than `max` members of those archetypes. The sentence is the rule's
//   sentence that names the archetype (and, best, the number).
// - an archetype's `gmApproval`: the rules' sentence that names it and the
//   GM ("Consult your GM before including …"), else the one about GM
//   approval.
// - alignments: the rules' sentence naming two or more alignments in "the
//   same warband"; members of two of those alignments break it.
// - extra models: members with companion effects (the rules' sentence about
//   extra models), and members' own gameplay notes about the warrior band
//   ("… an Enforcer character join the Warrior Band …").
import type { Character } from "../../shared/engine/build.ts";
import { walkEffects, type Compendium } from "../../shared/rules/compendium.ts";
import { ALIGNMENTS, type Archetype, type Effect, type Rule } from "../../shared/rules/schema.ts";

export type WarningKind = "limit" | "gm" | "alignment" | "models";

export type WarbandWarning = {
  /** Stable per warning (for keys). */
  id: string;
  kind: WarningKind;
  /** The book's sentence. */
  text: string;
  /** The rule entry it comes from (id), and its page. */
  source: { entry: string; page?: number };
  /** The members it is about (their ids), in warband order. */
  members: string[];
};

export type WarbandMember = { id: string; character: Character };

/** A text's sentences, without list bullets or step numbers. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z•"“(])/)
    .map((s) => s.replace(/^\s*(?:[•\-–]\s*|\d+[.)]\s*)+/, "").trim())
    .filter((s) => s.length > 2);
}

const lower = (s: string) => s.toLowerCase();
/** A name as it may appear in prose: "Inquisitors" also as "Inquisitor". */
const stems = (name: string): string[] => {
  const n = lower(name.trim());
  return n.endsWith("s") ? [n, n.slice(0, -1)] : [n];
};
const mentions = (sentence: string, name: string): boolean => {
  const s = lower(sentence);
  return stems(name).some((st) => new RegExp(`(^|[^a-z])${st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(s));
};
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six"];

type Found = { text: string; entry: Rule };

/** The rule entries' sentences, warband rules first (by name), then the rest in id order. */
function ruleSentences(c: Compendium): Found[] {
  const rules = [...c.rules.values()].sort(
    (a, b) => Number(!/warrior band|warband/i.test(b.name)) - Number(!/warrior band|warband/i.test(a.name)) || a.id.localeCompare(b.id),
  );
  return rules.flatMap((r) => sentences(r.source?.text || r.text || "").map((text) => ({ text, entry: r })));
}

function best(found: Found[], score: (s: string) => number): Found | null {
  let top: Found | null = null;
  let topScore = 0;
  for (const f of found) {
    const n = score(f.text);
    if (n > topScore) {
      top = f;
      topScore = n;
    }
  }
  return top;
}

const sourceOf = (r: Rule | Archetype) => ({ entry: r.id, page: r.source?.page });

export function warbandWarnings(c: Compendium, members: WarbandMember[]): WarbandWarning[] {
  const out: WarbandWarning[] = [];
  if (!members.length) return out;
  const all = ruleSentences(c);
  const archName = (id: string) => c.archetypes.get(id)?.name ?? id;

  // 1. warband effects: at most `max` of these archetypes.
  // (in rule entries and archetypes, as src/shared/engine/warband.ts reads them)
  const holders: { entry: Rule | Archetype; effects: Effect[] }[] = [
    ...[...c.rules.values()].map((r) => ({ entry: r as Rule | Archetype, effects: r.effects ?? [] })),
    ...[...c.archetypes.values()].flatMap((a) => a.sections.map((s) => ({ entry: a as Rule | Archetype, effects: s.effects }))),
  ];
  for (const { entry: rule, effects } of holders) {
    walkEffects(effects, (e, path) => {
      if (!("warband" in e)) return;
      const { max, archetype } = e.warband;
      const these = members.filter((m) => archetype.includes(m.character.archetype.id));
      if (these.length <= max) return;
      const names = archetype.map(archName);
      const own = sentences(rule.source?.text || ("text" in rule ? rule.text : "") || "").map((text) => ({ text, entry: rule as Rule }));
      const num = (s: string) => new RegExp(`\\b(${max}|${NUMBER_WORDS[max] ?? max})\\b`, "i").test(s);
      const f = best(own, (s) => (names.some((n) => mentions(s, n)) ? 2 + Number(num(s)) : 0));
      out.push({
        id: `limit:${rule.kind}/${rule.id}${path}:${out.length}`,
        kind: "limit",
        text: f?.text ?? rule.name,
        source: sourceOf(rule),
        members: these.map((m) => m.id),
      });
    });
  }

  // 2. archetypes needing the GM's approval.
  const byText = new Map<string, WarbandWarning>();
  for (const m of members) {
    const a = c.archetypes.get(m.character.archetype.id);
    if (!a?.gmApproval) continue;
    const f =
      best(all, (s) => (mentions(s, a.name) && /\bGM\b/.test(s) ? 2 : 0)) ?? best(all, (s) => (/\bGM approval\b/i.test(s) ? 1 : 0));
    if (!f) continue;
    const have = byText.get(f.text);
    if (have) have.members.push(m.id);
    else {
      const w: WarbandWarning = { id: `gm:${f.entry.id}:${out.length}`, kind: "gm", text: f.text, source: sourceOf(f.entry), members: [m.id] };
      byText.set(f.text, w);
      out.push(w);
    }
  }

  // 3. alignments that don't mix.
  const alignFound = best(all, (s) => {
    const named = ALIGNMENTS.filter((al) => mentions(s, al));
    return named.length >= 2 && /same (warband|warrior band)/i.test(s) ? 1 : 0;
  });
  if (alignFound) {
    const named = new Set<string>(ALIGNMENTS.filter((al) => mentions(alignFound.text, al)));
    const these = members.filter((m) => m.character.alignment && named.has(m.character.alignment));
    if (new Set(these.map((m) => m.character.alignment)).size >= 2) {
      out.push({ id: `alignment:${alignFound.entry.id}`, kind: "alignment", text: alignFound.text, source: sourceOf(alignFound.entry), members: these.map((m) => m.id) });
    }
  }

  // 4. extra models: companions, and members' notes about the warrior band.
  const withCompanions = members.filter((m) => (m.character.companions ?? []).length > 0);
  if (withCompanions.length) {
    const f = best(all, (s) => (/extra models?/i.test(s) ? 1 : 0));
    if (f) out.push({ id: `models:${f.entry.id}`, kind: "models", text: f.text, source: sourceOf(f.entry), members: withCompanions.map((m) => m.id) });
  }
  const noteWarnings = new Map<string, WarbandWarning>();
  for (const m of members) {
    for (const n of m.character.notes) {
      if (n.kind !== "gameplay" || !/warrior band|warband/i.test(n.text)) continue;
      const text = n.text.trim();
      const have = noteWarnings.get(text);
      if (have) {
        if (!have.members.includes(m.id)) have.members.push(m.id);
        continue;
      }
      const w: WarbandWarning = { id: `note:${n.source}:${noteWarnings.size}`, kind: "models", text, source: { entry: n.source }, members: [m.id] };
      noteWarnings.set(text, w);
      out.push(w);
    }
  }
  return out;
}
