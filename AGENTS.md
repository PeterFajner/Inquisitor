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
  book's own wording (spelling fixed). Controls are icons with an
  `aria-label` (and the same text as a hover tooltip). Approved exceptions,
  and only these: "Sign in", "Sign out", "Create account"; the balance
  label ("overpowered (+2.5σ vs a median Inquisitor Psyker)", with
  "underpowered"/"balanced"); the GM sheet's own headings (Kbk, BIV, SS,
  Cnc, Spd, Game Notes, Starting, Progress, Current, Location, L. Leg, R.
  Leg, Groin, L. Arm, R. Arm, Abdomen, Chest, Head, Injury Total, Armour /
  Injury Lvl, Firearm, Type, Rng, Mode, Acc, Damage, Shots, Rld, Enc, #
  Rld, Special, Melee, Rch, Dam, PP, Other Equipment/Bionics/Etc,
  Abilities). Anything else needs the owner's approval first: don't add
  placeholder text, empty-state messages, headings or button captions.
- **Characters store dice, not seeds.** Every roll and choice is recorded
  under a stable key (`<entry id>/<effect id>[#n]`); replaying a record
  against the rules reproduces the character exactly. Seeds exist only in
  tests and the balance simulation.
- **Rules are data.** Never hard-code a rule in the engine or UI; express
  it in the format, or extend the format (schema + engine + docs together).
- Memory budget on asterix (1.2 GB shared): keep the server well under
  100 MB like speci. Measure before adding a server dependency.
- Node runs the TypeScript directly (type stripping): erasable syntax only,
  imports name the `.ts`/`.tsx` file.

## Commands

- `npm run dev` — server + client watch.
- `npm run typecheck`, `npm test`.
- `npm run rules:check [-- --summary]` — validate data/rules.
- `npm run simulate` — recompute the balance distributions.

Commits use the user's configured git identity; never add co-author lines.
