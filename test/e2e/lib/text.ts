// The no-UI-text rule (AGENTS.md): every visible word is the book's (the
// rules' own strings: names, labels, prose, the book's quotes) or one of the
// owner's approved exceptions. A text is checked word by word: a word found
// in neither is a finding (invented UI text: "Loading", "No results",
// "Save"…).

/** The owner's approved texts (AGENTS.md "No UI text except the book's"). */
export const APPROVED = [
  "Sign in", "Sign out", "Create account",
  "overpowered", "underpowered", "balanced",
  "This character is in the top 1.5% of randomly-rolled Inquisitor Fighters.", "bottom",
  "Kbk", "BIV", "SS", "Cnc", "Spd", "Game Notes", "Starting", "Progress", "Current", "Location", "L. Leg", "R. Leg", "Groin", "L. Arm", "R. Arm",
  "Abdomen", "Abdmn", "Chest", "Head", "Injury Total", "Armour / Injury Lvl", "Firearm", "Type", "Rng", "Mode", "Acc", "Damage", "Shots", "Rld", "Enc", "# Rld",
  "Special", "Melee", "Rch", "Dam", "PP", "Other Equipment/Bionics/Etc", "Abilities",
  "Inquisitor Character Generator", "Character name", "Occupation", "Archetype", "Subtype", "Role", "Stats", "Base", "Boon", "Total", "Talents",
  "Boons", "Reroll", "Download Docx", "lost", "Rolls", "Balance details", "* Should have GM approval before use.",
  "Tables", "Rules", "Rolled on by", "Search", "Table of Contents", "Characters",
];

/** Words Intl.RelativeTimeFormat("en") prints in the history ("5 minutes ago", "yesterday"). */
const RELATIVE_TIME = "now ago in yesterday tomorrow last next this second seconds sec minute minutes min hour hours hr day days week weeks wk month months mo quarter quarters qtr year years yr".split(" ");

export const wordsOf = (s: string): string[] => s.toLowerCase().match(/[\p{L}]+/gu) ?? [];

/** Every word in the rules (every string anywhere in the served packs) and the approved texts. */
export function bookWords(rules: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (x: unknown): void => {
    if (typeof x === "string") for (const w of wordsOf(x)) out.add(w);
    else if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) {
      // Ids, file meta and commits aren't shown as words.
      if (k === "meta" || k === "version" || k === "commit") continue;
      visit(v);
    }
  };
  visit(rules);
  for (const s of [...APPROVED, ...RELATIVE_TIME]) for (const w of wordsOf(s)) out.add(w);
  return out;
}

/** Texts with words that are neither the book's nor approved; `extra`: texts the test typed (names). */
export function uiTextProblems(texts: string[], words: Set<string>, extra: string[] = []): { text: string; words: string[] }[] {
  const typed = new Set(extra.flatMap(wordsOf));
  const out: { text: string; words: string[] }[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    // Names the tests give characters and warbands start "E2E".
    // Ids (an author's public id, a share token) are data, not words.
    const bad = wordsOf(t.replace(/\bE2E[\w-]*/g, "").replace(/(?<![\w-])(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{8,}(?![\w-])/g, "")).filter((w) => !words.has(w) && !typed.has(w));
    if (bad.length && !seen.has(t)) {
      seen.add(t);
      out.push({ text: t.slice(0, 200), words: [...new Set(bad)] });
    }
  }
  return out;
}
