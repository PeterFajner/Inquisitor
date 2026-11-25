# Inquisitor

A character builder for Inquisitor 54mm, built from *Inquisitor 54mm Warrior
Band & Character Creation Guide, Loyalist Edition 0.10* (arranged by The
Halibut). Primarily for the GM: build characters and warbands, export to his
Word sheet. See PLAN.md for the design and its decisions.

## Layout

- `src/shared/rules/` — the rules format (`schema.ts`, explained in
  docs/RULES-FORMAT.md) and the compendium (packs stacked into one index).
- `src/shared/engine/` — the engine: builds a character from the
  compendium plus a character record (dice results, choices, overrides).
  Pure TypeScript, runs in the browser and on the server.
- `src/server.ts`, `src/lib/` — the Node server (speci's pattern):
  accounts with passkeys, saved characters (SQLite), the rules store (a git
  repo), live updates (SSE), the Luna proxy.
- `src/client/` — the browser app (Preact, bundled by esbuild).
- `data/` (not in this repo): `rules/` (its own git repo: the rules
  database), the SQLite database, `source/` (the PDF, per-page text in
  `source/pages/pNN.txt`, 150 dpi renders of the pages whose tables are
  scanned images in `source/images/page-NN.png`, and the GM's Word sheet).
- `legacy/` — the 2023 React app and the original C# generator, kept until
  the new app replaces the live site.

## Hard rules

- **No UI text except the book's.** Every visible word in the app is the
  book's own wording (spelling, grammar and punctuation fixed). Controls are icons with an
  `aria-label` (and the same text as a hover tooltip). Approved exceptions,
  and only these: "Sign in", "Sign out", "Create account"; the balance
  label: the word alone ("overpowered", "underpowered", "balanced") with
  an (i) whose popover (hover, or tap) says "This character is in the
  top 1.5% of randomly-rolled Inquisitor Fighters." (or "bottom"); the GM sheet's own headings (Kbk, BIV, SS,
  Cnc, Spd, Game Notes, Starting, Progress, Current, Location, L. Leg, R.
  Leg, Groin, L. Arm, R. Arm, Abdomen, Chest, Head, Injury Total, Armour /
  Injury Lvl, Firearm, Type, Rng, Mode, Acc, Damage, Shots, Rld, Enc, #
  Rld, Special, Melee, Rch, Dam, PP, Other Equipment/Bionics/Etc,
  Abilities); "–" for an unnamed character or warband; "×N" quantities;
  brackets around chosen variants ("Bionic sense (Right eye, Average)");
  "/" in the sheet's # Rld and Injury Total cells; relative times in
  history ("5 minutes ago", "yesterday", via Intl.RelativeTimeFormat);
  the 2023 site's text, so the builder reads as the GM knows it (owner,
  November 2026; `T` in src/client/builder/labels.ts): "Inquisitor
  Character Generator", "Character name", "Occupation", "Archetype",
  "Subtype", "Role", "Stats", "Base", "Boon", "Total", "Talents", "Boons",
  "Reroll", "Download Docx", "Add character" ("Role" labels a pick the
  book names after the archetype itself, e.g. an Inquisitor's faction);
  "–" in the alignment when there is none; "lost" on gear lost to a
  downgrade; the labels "Rolls" (the rolls section's toggle) and "Balance
  details" (the balance chip's (i)); "* Should have GM approval before
  use." under an asterisked archetype's character (the book's p. 3);
  on the rules page, the tab titles "Tables" and "Rules" (the shelved
  rules canvas's region titles) and the label "Rolled on by" (a table's
  back-links; owner, November 2026); the label "Search" (the search icon,
  its field and results; owner, November 2026); the label "Table of
  Contents" (the rules page's sidebar and its icon; the book's p. 2 heading;
  owner, November 2026).
  The look is the 2023 site's (dark cards on a dark-red mosaic, red for
  what can be changed, the Inquisitor title face): keep it.
  Anything else needs the owner's approval first: don't add
  placeholder text, empty-state messages, headings or button captions.
- **Characters store dice, not seeds.** Every roll and choice is recorded
  under a stable key (`<entry id>/<effect id>[#n]`); replaying a record
  against the rules reproduces the character exactly. Seeds exist only in
  tests and the balance simulation.
- **Characters and warbands live only on the server**, in the session's
  account: a visitor's (an account with no passkeys, made on a browser's
  first save) or a passkey account's. localStorage holds only per-browser
  conveniences (selection, collapsed sections) and caches (rules,
  balance). "Signed in" means a passkey account; rule edits need one.
- **Rules are data.** Never hard-code a rule in the engine or UI; express
  it in the format, or extend the format (schema + engine + docs together).
- Memory budget on asterix (1.2 GB shared): keep the server well under
  100 MB like speci (the balance warm-up, ~130 MB, and the rules-heights
  bake, ~60 MB, run as short-lived children
  after rules changes). Measure before adding a server dependency.
- Node runs the TypeScript directly (type stripping): erasable syntax only,
  imports name the `.ts`/`.tsx` file.

## Commands

- `npm run dev` — server + client watch.
- `npm run typecheck`, `npm test`.
- `npm run rules:check [-- --summary]` — validate data/rules.
- `npm run simulate` — recompute the balance distributions.

Commits use the user's configured git identity; never add co-author lines.
