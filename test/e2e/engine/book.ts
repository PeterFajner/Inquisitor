// The book's own rules as assertions on a random character, read from the
// archetypes' source.text and data/source/pages/pNN.txt. `bookChecks[id]`
// returns the rules a character of that archetype breaks; every archetype
// also gets the general ones (Creating A Character, p. 22).
import type { BuildResult, Character } from "../../../src/shared/engine/build.ts";
import type { Compendium } from "../../../src/shared/rules/compendium.ts";

export type BookFailure = { check: string; message: string; signature?: string };
type Check = (b: BuildResult, c: Compendium) => BookFailure[];

const has = (ch: Character, kind: "talents" | "exotics" | "mutations" | "powers" | "items", id: string) => ch[kind].some((t) => t.id === id);
const opt = (ch: Character, id: string) => ch.options.some((o) => o.id === id);
const fail = (check: string, message: string, signature?: string): BookFailure => ({ check, message, signature });

const GENERATOR_SUBTYPES = ["fighter", "marksman", "scout", "sage", "psyker"];

/**
 * p. 22, B: "IF the character has one of the five generator-specific
 * subtypes (Fighter, Marksman, Scout, Sage, Psyker), they generate D3+3
 * Boons … Reroll any duplicates of Talents or Exotic Abilities."
 */
const general: Check = (b) => {
  const out: BookFailure[] = [];
  const ch = b.character;
  const slots = new Set(b.log.map((e) => /^creating-a-character\/boons#(\d+)/.exec(e.key)?.[1]).filter(Boolean)).size;
  if (GENERATOR_SUBTYPES.includes(ch.subtype.id)) {
    if (slots < 4 || slots > 6) out.push(fail("D3+3 boons for Fighter, Marksman, Scout, Sage, Psyker (p. 22)", `${slots} boons`, "count"));
  } else if (slots) out.push(fail("no boons for other subtypes (p. 22)", `${ch.subtype.id} has ${slots} boons`, ch.subtype.id));
  // No talent or exotic ability twice (duplicates are re-rolled).
  for (const kind of ["talents", "exotics"] as const) {
    const seen = new Set<string>();
    for (const t of ch[kind]) {
      if (seen.has(t.id)) out.push(fail("no duplicate talents or exotic abilities (p. 22)", `${t.name} twice`, `${kind}/${t.id}`));
      seen.add(t.id);
    }
  }
  return out;
};

/** p. 19, Schola Progenium. */
const schola: Check = (b) => {
  const out: BookFailure[] = [];
  const ch = b.character;
  const truant = opt(ch, "truant");
  // "Knife."
  if (!has(ch, "items", "knife")) out.push(fail("Schola Progenium: a Knife", "no Knife"));
  // "Truants may be of any ideology. Non-Truants must be either Puritan or Neutral."
  if (!truant && ch.alignment === "Radical") out.push(fail("Schola Progenium: non-Truants are Puritan or Neutral", ch.alignment));
  // "up to two Rare weapons of your choice" (a random one takes 0–2); "any number of Common weapons" (a random one, none).
  const rare = b.record.choices["schola-progenium/rare-weapons"] ?? [];
  if (rare.length > 2) out.push(fail("Schola Progenium: up to two Rare weapons", `${rare.length}`));
  const common = b.record.choices["schola-progenium/common-weapons"] ?? [];
  if (common.length) out.push(fail("Schola Progenium: a random Truant takes no Common weapons", `${common.length}`));
  if (!truant && (rare.length || common.length)) out.push(fail("Schola Progenium: only Truants choose weapons", `${rare.length + common.length}`));
  // "They have two extra clips of ammunition for any weapons carried."
  if (truant && ch.reloads.add < 2) out.push(fail("Schola Progenium: Truants have two extra clips", `reloads +${ch.reloads.add}`));
  // "Non-Truant Seniors start with a pistol or basic weapon of their choice."
  if (!truant && ch.subtype.id === "senior-progenii" && !b.record.choices["schola-progenium/weapon"]?.length) out.push(fail("Schola Progenium: a non-Truant Senior has a pistol or basic weapon", "none"));
  // Seniors "choose a career and get a corresponding Talent".
  if (ch.subtype.id === "senior-progenii") {
    const careers: Record<string, [string, string]> = {
      ministorum: ["exotics", "word-of-the-emperor"],
      commissariat: ["talents", "nerves-of-steel"],
      "adepta-sororitas": ["exotics", "acts-in-faith"],
      "officio-medicae": ["talents", "medic"],
      "adeptus-arbites": ["talents", "true-grit"],
      "imperial-guard-navy": ["talents", "heroic"],
    };
    const career = ch.options.find((o) => o.id in careers);
    if (!career) out.push(fail("Schola Progenium: a Senior chooses a career", "no career"));
    else if (!has(ch, careers[career.id][0] as "talents", careers[career.id][1])) out.push(fail("Schola Progenium: the career's talent", `${career.name} without ${careers[career.id][1]}`, career.id));
  } else if (ch.options.some((o) => o.key === "schola-progenium/career")) out.push(fail("Schola Progenium: only Seniors choose a career", ch.subtype.id));
  return out;
};

/** p. 4, Inquisitors: "Only radical Inquisitors can wield heretical crafts" (Chaos, Radical and Xenos products, alien gear); "Radicals may generate alien gear". */
const inquisitor: Check = (b, c) => {
  const out: BookFailure[] = [];
  const ch = b.character;
  if (ch.alignment !== "Radical") {
    for (const it of ch.items) {
      const e = c.items.get(it.id);
      if (e && (e.alien || (e.product && ["Chaos", "Radical", "Xenos"].includes(e.product)))) out.push(fail("Inquisitors: only Radicals wield heretical crafts", `${ch.alignment} Inquisitor has ${it.name}`, it.id));
    }
  }
  if (!ch.alignment || !["Puritan", "Radical"].includes(ch.alignment)) out.push(fail("Inquisitors are Puritan or Radical", String(ch.alignment)));
  if (!has(ch, "talents", "leadership")) out.push(fail("Inquisitors have Leadership", "no Leadership"));
  return out;
};

const specific: Record<string, Check> = { "schola-progenium": schola, inquisitor };

export const bookChecks: Record<string, Check> = new Proxy({} as Record<string, Check>, {
  get: (_t, id: string) => (b: BuildResult, c: Compendium) => [...general(b, c), ...(specific[id]?.(b, c) ?? [])],
});
