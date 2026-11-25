// The book's own rules as assertions on a random character, read from the
// archetypes' source.text and data/source/pages/pNN.txt. `bookChecks[id]`
// returns the rules a character of that archetype breaks; every archetype
// also gets the general ones (Creating A Character, p. 22).
import { bestAV, type BuildResult, type Character } from "../../../src/shared/engine/build.ts";
import { isUnder } from "../../../src/shared/engine/reroll.ts";
import type { Compendium } from "../../../src/shared/rules/compendium.ts";
import type { Availability, Item } from "../../../src/shared/rules/schema.ts";

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
const general: Check = (b, c) => {
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
  out.push(...boonExpansion(b, c), ...equipmentRules(b, c), ...mounts(b, c), ...rulings(b, c));
  return out;
};

/**
 * p. 23: "If a character would get a Boon that would allow them to roll
 * again on the table of a different subtype, they can instead gain a Talent
 * from outside the corebook printed in any expansion material. Those being: …"
 */
const EXPANSION_TALENTS = "Academic, Athlete, Augury, Bodyguard, Boobytrap, Channel The Mind, Charisma, Combat Master, Crack Shot, Detection, Diplomat, Hunter, Plain Dumb Luck, Iron Will, Man of the People, Mentor, Opportunist, Ordeal by the Sun, Persuade, Quick Learner, Scale Terrain, Sign Language, Subdue, Study Thy Weapon, Tactical Delay, Takedown, Tutor, Witch-hound"
  .split(", ")
  .map((x) => x.toLowerCase());
const boonExpansion: Check = (b, c) => {
  const out: BookFailure[] = [];
  for (const [k, ids] of Object.entries(b.record.choices)) {
    if (!/expansion-talent-[a-z]+$/.test(k)) continue;
    for (const id of ids) {
      const [kind, x] = id.split(":");
      const e = kind === "talent" ? c.talents.get(x) : kind === "exotic" ? c.exotics.get(x) : undefined;
      if (!e || !EXPANSION_TALENTS.includes(e.name.toLowerCase())) out.push(fail("a boon's expansion talent is from the book's list (p. 23)", `${k}: ${e?.name ?? id}`, id));
    }
  }
  return out;
};

const STEPS: Availability[] = ["Common", "Rare", "Exotic", "Legendary"];
/**
 * p. 38: "At the end of this section there will be modifications. These
 * alter how a piece of equipment works and increase its availability by a
 * step." "Always keep in mind a character's Encumbrance Limit! (They can
 * carry stuff equal to their Strength + 50.)"
 */
const equipmentRules: Check = (b, c) => {
  const out: BookFailure[] = [];
  const ch = b.character;
  for (const it of ch.items) {
    if (!it.alterations?.length) continue;
    const e = c.items.get(it.id);
    if (!e?.availability || !it.availability) continue;
    const want = STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(e.availability) + it.alterations.length)];
    if (it.availability !== want) out.push(fail("an alteration raises availability a step (p. 38)", `${it.name} with ${it.alterations.join(", ")}: ${it.availability}, wanted ${want}`, it.id));
  }
  const enc = ch.attributes.find((a) => a.name === "Encumbrance Limit");
  if (!enc) out.push(fail("an Encumbrance Limit (p. 38)", "none", "none"));
  else if (enc.value !== ch.stats.S.final + 50) out.push(fail("Encumbrance Limit is Strength + 50 (p. 38)", `${enc.value} with S ${ch.stats.S.final}`, "value"));
  return out;
};

/**
 * The owner's ruling (November 2026): a mount-only weapon (Chainblade,
 * Bayonet, Exterminator, Auxiliary Grenade Launcher: "Must be mounted onto
 * …") with nothing to mount on gets re-rolled, so a character never has one
 * on nothing.
 */
const mountItems = (c: Compendium): Set<string> =>
  new Set([...c.items.values()].filter((i) => (i.effects ?? []).some((e) => "pick" in e && e.id === "mount" && e.into === "self")).map((i) => i.id));
const mounts: Check = (b, c) => {
  const out: BookFailure[] = [];
  const m = mountItems(c);
  for (const it of b.character.items) {
    if (!m.has(it.id) || it.overridden) continue;
    if (!(it.chosen ?? []).some((x) => x.key.includes("mount"))) out.push(fail("a mount-only weapon has something to mount on, else it is re-rolled (owner, November 2026)", `${it.name} mounted on nothing`, it.id));
  }
  return out;
};

/** Granted outright: no roll or gear result led to it, so it can't be rolled again (ENGINE.md). */
const outright = (b: BuildResult, t: { from: { key?: string; override?: boolean }[] }) => {
  const dice = b.log.filter((l) => l.type === "dice").map((l) => l.key);
  return t.from.some((f) => !f.override && (!f.key || !dice.some((k) => f.key === k || isUnder(f.key!, k))));
};
const WEAPONS = ["Close combat weapon", "Pistol", "Basic weapon", "Heavy weapon"];
const CURSE_STATS = { WS: 52, BS: 13, S: 62, T: 71, I: 36 } as const;
const CURSE_DERIVED = { Spd: 3, BIV: 7, SS: "No", Cnc: "No" } as const;

/** The owner's rulings of November 2026 on what the end-to-end runs left pending. */
const rulings: Check = (b, c) => {
  const out: BookFailure[] = [];
  const ch = b.character;
  // p. 27, Study Thy Weapon with no weapon at all: the roll that gave it is
  // rolled again; one granted outright (an Acolyte Lector's) keeps the empty pick.
  for (const t of ch.talents.filter((x) => x.id === "study-thy-weapon" && !x.overridden)) {
    const weapon = (t.chosen ?? []).some((x) => WEAPONS.includes(c.items.get(x.id)?.category ?? ""));
    if (!weapon && !outright(b, t)) out.push(fail("Study Thy Weapon with no weapon is rolled again (p. 27; owner, November 2026)", "a rolled Study Thy Weapon with no weapon", "study-thy-weapon"));
  }
  // An MIU with nothing to link is rolled again, like a mount-only weapon.
  const miu = ch.items.find((x) => x.id === "miu" && !x.overridden);
  if (miu && !(miu.chosen ?? []).length && !outright(b, miu)) out.push(fail("an MIU with nothing to link is rolled again (owner, November 2026)", "a rolled MIU linked to nothing", "miu"));
  // p. 34, "can only take powers from the … Discipline": powers chosen or
  // rolled are of it; one granted outright stays, unflagged.
  for (const [id, discipline] of [["puppetmaster", "Telepathy"], ["pyromancer", "Pyromancy"]]) {
    if (!has(ch, "talents", id)) continue;
    for (const p of ch.powers) {
      if (p.overridden) continue;
      const of = c.powers.get(p.id)?.group === discipline;
      if (!of && !outright(b, p)) out.push(fail(`${id}: only ${discipline} powers taken (p. 34)`, `${p.name} taken`, `${id} ${p.id}`));
      if (p.restricted && outright(b, p)) out.push(fail(`${id}: a power granted outright isn't flagged (owner, November 2026)`, `${p.name} flagged`, `${id} ${p.id}`));
    }
  }
  // p. 92, Curse of Thlezzloath: its line wins over adds whatever order they came in (BIV 7 with Scales).
  if (ch.mutations.some((x) => x.id === "curse-of-thlezzloath" && !x.overridden)) {
    for (const [s, v] of Object.entries(CURSE_STATS) as [keyof typeof CURSE_STATS, number][]) {
      const line = ch.stats[s];
      // (what comes after the set: formulas, caps, multiplies)
      if (line.caps.length || line.mods.some((m) => m.formula || m.multiply !== undefined)) continue;
      if (line.modified !== v) out.push(fail("Curse of Thlezzloath's stats win over adds (p. 92; owner, November 2026)", `${s} ${line.modified}, wanted ${v}`, s));
    }
    for (const [k, v] of Object.entries(CURSE_DERIVED) as [keyof typeof CURSE_DERIVED, number | "No"][]) {
      if (ch.derived[k].value !== v) out.push(fail("Curse of Thlezzloath's Spd, BIV, SS, Cnc win over adds (p. 92; owner, November 2026)", `${k} ${ch.derived[k].value}, wanted ${v}`, k));
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

/**
 * The owner's ruling (November 2026), p. 14 Imperial Guard: "May have either
 * D3 extra grenades or a Medi pack": extra grenades means more of a grenade
 * they already own, so the option is only taken with a grenade to add to.
 */
const imperialGuard: Check = (b, c) => {
  const out: BookFailure[] = [];
  const ch = b.character;
  if (!ch.options.some((o) => o.id === "grenades")) return out;
  const picked = b.record.choices["imperial-guard/grenades-pick"] ?? [];
  const grenade = picked.length ? ch.items.find((i) => i.id === picked[0]) : undefined;
  if (!picked.length) out.push(fail("Imperial Guard: D3 extra grenades are more of a grenade they own (owner, November 2026)", "the option taken with no grenade to add to", "none"));
  else if (!grenade || c.items.get(grenade.id)?.category !== "Grenade") out.push(fail("Imperial Guard: D3 extra grenades are more of a grenade they own (owner, November 2026)", `${picked[0]} isn't an owned grenade`, "not owned"));
  else {
    const extra = b.log.find((e) => e.key === "imperial-guard/grenades-pick:qty" && e.type === "dice")?.total;
    if (extra !== undefined && grenade.qty < extra + 1) out.push(fail("Imperial Guard: D3 extra grenades are more of a grenade they own (owner, November 2026)", `${grenade.name} ×${grenade.qty} after ${extra} extra`, "qty"));
  }
  return out;
};

// --- archetype profiles (each archetype's source.text) ------------------------------

const lc = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[-\s]+/g, " ").trim();
type Kind = "talents" | "exotics" | "mutations" | "powers" | "items";
/** Whether the character has something by its book name (spelling aside). */
const hasNamed = (ch: Character, kind: Kind, name: string) => ch[kind].some((t) => lc(t.name) === lc(name) || lc(t.name) === lc(name) + "s" || lc(t.name) + "s" === lc(name));
const isArmour = (c: Compendium, id: string) => c.items.get(id)?.category === "Armour";

type Profile = {
  page: number;
  talents?: string[];
  exotics?: string[];
  items?: string[];
  alignment?: string[];
  /** "Can only wear …" (item names). */
  armourOnly?: string[];
  /** "… except for Power Armour". */
  armourNot?: string[];
  /** "Flak Armour or lighter". */
  maxAV?: number;
  extra?: Check;
};
const profileCheck = (id: string, p: Profile): Check => (b, c) => {
  const out: BookFailure[] = [];
  const ch = b.character;
  const name = c.archetypes.get(id)?.name ?? id;
  const where = `${name} (p. ${p.page})`;
  for (const [kind, list] of [["talents", p.talents], ["exotics", p.exotics], ["items", p.items]] as const)
    for (const n of list ?? []) if (!hasNamed(ch, kind, n) && !ch.taken.some((t) => lc(t.name) === lc(n))) out.push(fail(`${where}: has ${n}`, `no ${n}`, n));
  if (p.alignment && !p.alignment.includes(ch.alignment ?? "")) out.push(fail(`${where}: alignment ${p.alignment.join(" or ")}`, String(ch.alignment), String(ch.alignment)));
  for (const it of ch.items.filter((i) => isArmour(c, i.id) && !i.overridden)) {
    if (p.armourOnly && !p.armourOnly.some((n) => lc(n) === lc(it.name))) out.push(fail(`${where}: can only wear ${p.armourOnly.join(", ")}`, it.name, it.id));
    if (p.armourNot?.some((n) => lc(n) === lc(it.name))) out.push(fail(`${where}: can't wear ${p.armourNot.join(", ")}`, it.name, it.id));
    const av = bestAV(c, c.items.get(it.id) as Item);
    if (p.maxAV !== undefined && av !== undefined && av > p.maxAV) out.push(fail(`${where}: Flak Armour or lighter`, `${it.name} AV ${av}`, it.id));
  }
  out.push(...(p.extra?.(b, c) ?? []));
  return out;
};

// "Can only wear Assassin Body Suit": the rules' Assassin Synskin (noted "Assassin Body Suit"), with the head gear each profile lists.
const ASSASSIN_ARMOUR = ["Assassin Synskin"];
const PROFILES: Record<string, Profile> = {
  "adepta-sororitas": {
    page: 6,
    exotics: ["Acts In Faith"],
    alignment: ["Puritan"],
    extra: (b) => {
      const ch = b.character;
      const repentia = ch.options.some((o) => /repentia/i.test(o.id));
      const out: BookFailure[] = [];
      if (!repentia) {
        // "Battle Sisters have Power Armour" … "Battle Sisters only wear Power Armour."
        if (!hasNamed(ch, "items", "Power Armour")) out.push(fail("Adepta Sororitas (p. 6): a Battle Sister has Power Armour", "none"));
        for (const it of ch.items) if (it.name !== "Power Armour" && /armou?r$/i.test(it.name) && !it.overridden) out.push(fail("Adepta Sororitas (p. 6): Battle Sisters only wear Power Armour", it.name, it.id));
      } else {
        if (!hasNamed(ch, "items", "Penitent Seals")) out.push(fail("Adepta Sororitas (p. 6): Sisters Repentia have Penitent Seals", "none"));
        if (!hasNamed(ch, "exotics", "Only In Death Does Duty End")) out.push(fail("Adepta Sororitas (p. 6): Sisters Repentia have Only In Death Does Duty End", "none"));
      }
      return out;
    },
  },
  kroot: {
    page: 17,
    talents: ["Acrobatic", "First Strike", "Furious Assault"],
    exotics: ["Cannibal Hunger"],
    alignment: ["Radical"],
    // "Kroot characters can never use combat drugs of any kind."
    extra: (b, c) => b.character.items.filter((i) => c.items.get(i.id)?.group === "Combat Stimms" && !i.overridden).map((i) => fail("Kroot (p. 17): never combat drugs", i.name, i.id)),
  },
  enforcers: {
    page: 15,
    alignment: ["Puritan", "Neutral"],
    armourNot: ["Power Armour"],
    // "Enforcers cannot use Power or Bolt weapons other than Power Maul."
    extra: (b, c) =>
      b.character.items
        .filter((i) => /weapons/i.test(c.items.get(i.id)?.group ?? "") && /^(power|bolt)\b|\bbolt/i.test(i.name) && !/maul/i.test(i.name) && !i.overridden)
        .map((i) => fail("Enforcers (p. 15): no Power or Bolt weapons other than Power Maul", i.name, i.id)),
  },
  "tau-water-caste": {
    page: 20,
    items: ["Robes of Office"],
    exotics: ["Blunt"],
    talents: ["Persuade"],
    alignment: ["Radical"],
    armourOnly: ["Robes of Office"],
    // "Persuade and two of the following: Tutor, Mentor, Leader, Force of Will"
    extra: (b) => {
      const n = ["Tutor", "Mentor", "Leadership", "Leader", "Force of Will"].filter((x) => hasNamed(b.character, "talents", x)).length;
      const out = n === 2 ? [] : [fail("Tau Water Caste (p. 20): two of Tutor, Mentor, Leader, Force of Will", `${n}`, String(n))];
      if (b.character.powers.length) out.push(fail("Tau Water Caste (p. 20): no psychic abilities", b.character.powers.map((p) => p.name).join(", "), "powers"));
      return out;
    },
  },
  antagonist: { page: 7, talents: ["Man Of The People"], maxAV: 3 },
  mutants: {
    page: 17,
    maxAV: 3,
    // "Has D6+1 mutations."
    extra: (b) => (b.character.mutations.length < 2 ? [fail("Mutants (p. 17): D6+1 mutations", `${b.character.mutations.length}`, "count")] : []),
  },
  navigator: {
    page: 17,
    items: ["Knife", "Staff"],
    exotics: ["The Third Eye"],
    // "All Navigator Characters are psykers"
    extra: (b) => (b.character.psyker ? [] : [fail("Navigator (p. 17): all Navigators are psykers", "not a psyker")]),
  },
  skitarii: {
    page: 20,
    armourNot: ["Power Armour"],
    // "Skitarii receive double the starting ammunition"; "A random body part is replaced with an average quality bionic."
    extra: (b, c) => {
      const out: BookFailure[] = [];
      if (b.character.reloads.multiply !== 2) out.push(fail("Skitarii (p. 20): double the starting ammunition", `×${b.character.reloads.multiply}`));
      if (!b.character.items.some((i) => c.items.get(i.id)?.category === "Bionic")) out.push(fail("Skitarii (p. 20): a body part replaced with a bionic", "no bionic"));
      return out;
    },
  },
  daemonhosts: {
    page: 12,
    exotics: ["Daemonic", "Fearsome", "Possessed"],
    alignment: ["Radical"],
    // Warp Strength -50 (Daemonic Beast), -30 (Lesser), -20 (Greater, Prince).
    extra: (b) => {
      const ws = b.character.attributes.find((a) => a.name === "Warp Strength")?.value;
      const want = [-50, -30, -20];
      return ws !== undefined && want.includes(ws) ? [] : [fail("Daemonhosts (p. 12): Warp Strength -50, -30 or -20", String(ws))];
    },
  },
  "callidus-assassin": {
    page: 9,
    items: ["C'tan Phase Sword", "Poisoned Blades", "Medi-pack"],
    talents: ["Acrobatic", "Ambidextrous", "Blademaster", "Catfall", "Dodge", "Fast Draw", "Feint", "First Strike", "Hipshooting", "Force of Will", "Nerves of Steel", "Quickload", "Lightning Reflexes", "Subdue", "Combat Master", "Jump Back"],
    alignment: ["Neutral"],
    // ("May have either Polymorphine or Callidus Combat Armour")
    armourOnly: [...ASSASSIN_ARMOUR, "Callidus Combat Armour"],
  },
  "vindicare-assassin": {
    page: 21,
    items: ["Exitus Long Rifle", "Exitus Pistol", "Vindicare Spy Mask", "Short Sword"],
    talents: ["Acrobatic", "Ambidextrous", "Catfall", "Deadeye Shot", "Dodge", "Fast Draw", "Force of Will", "Hipshooting", "Crack Shot", "Nerves of Steel", "Quickload", "Lightning Reflexes", "Marksman"],
    alignment: ["Neutral"],
    armourOnly: [...ASSASSIN_ARMOUR, "Vindicare Spy Mask"],
  },
  "culexus-assassin": { page: 11, items: ["Animus Speculum"], talents: ["Acrobatic", "Ambidextrous", "Dodge", "Force of Will", "Nerves of Steel"], alignment: ["Neutral"], armourOnly: ASSASSIN_ARMOUR },
  "eversor-assassin": {
    page: 16,
    items: ["Neuro-Gauntlet", "Executor Pistol", "Sentinel Array", "Skull Mask", "Power Sword"],
    exotics: ["Terrifying", "Bio-Meltdown", "Sociopathic", "Terminus"],
    talents: ["Acrobatic", "Ambidextrous", "Catfall", "Dodge", "Fast Draw", "Feint", "First Strike", "Hipshooting", "Force of Will", "Furious Assault", "Nerves of Steel", "Quickload", "Lightning Reflexes", "True Grit", "Combat Master"],
    alignment: ["Neutral"],
    armourOnly: [...ASSASSIN_ARMOUR, "Skull Mask"],
  },
  // ("Servitor Command" and an Arco-flagellant's "Trigger Word" are prose in the rules: the book defines neither)
  servitors: { page: 19, talents: ["Force of Will", "Nerves of Steel", "True Grit"], alignment: ["Neutral"] },
  "arco-flagellant": {
    page: 7,
    exotics: ["Fearsome"],
    talents: ["Ambidextrous", "Furious Assault", "Force Of Will"],
    alignment: ["Neutral"],
    // "Arco-flagellants may take any weapons or combat stimms, all of which must be implanted in them."
    extra: (b, c) =>
      b.character.items
        .filter((i) => /weapon/i.test(c.items.get(i.id)?.category ?? "") && !i.implanted && !i.overridden)
        .map((i) => fail("Arco-flagellant (p. 7): weapons are implanted", i.name, i.id)),
  },
  "storm-troopers": { page: 20, items: ["Sealed Suit"], talents: ["Nerves of Steel"], armourOnly: ["Sealed Suit"] },
};

const specific: Record<string, Check> = {
  "schola-progenium": schola,
  inquisitor,
  "imperial-guard": imperialGuard,
  ...Object.fromEntries(Object.entries(PROFILES).map(([id, p]) => [id, profileCheck(id, p)])),
};

/** Book names a profile check uses that no entry of that kind has (a misspelling here, or a gap in the rules): notes. */
export function unknownProfileNames(c: Compendium): string[] {
  const names = (m: Map<string, { name: string }>) => new Set([...m.values()].map((x) => lc(x.name)));
  const sets = { talents: names(c.talents), exotics: names(c.exotics), items: names(c.items) };
  const out: string[] = [];
  for (const [id, p] of Object.entries(PROFILES))
    for (const kind of ["talents", "exotics", "items"] as const)
      for (const n of p[kind] ?? []) if (![lc(n), lc(n) + "s", lc(n).replace(/s$/, "")].some((x) => sets[kind].has(x))) out.push(`${id}: ${kind} "${n}"`);
  return out;
}

export const bookChecks: Record<string, Check> = new Proxy({} as Record<string, Check>, {
  get: (_t, id: string) => (b: BuildResult, c: Compendium) => [...general(b, c), ...(specific[id]?.(b, c) ?? [])],
});
