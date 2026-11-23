# Plan

Decided with the owner in November 2026. The GM switches from the 2023 site
(still live at inquisitor.pfaj.ca, built from `legacy/`) only once every
step below is done.

## Decisions

- **Audience**: the GM first; public and linkable for the group and anyone
  else.
- **Rebuild** on speci's stack: Node 22, `node:sqlite`, Preact + esbuild,
  one small Node service on asterix. The old app lives in `legacy/` until
  the switch.
- **Rules are data**, in the format of docs/RULES-FORMAT.md, one YAML file
  per entry, in rule packs. The book is the `loyalist` pack; the Traitor
  Edition, homebrew and the articles the PDF defers to (Dead Or Alive,
  Unbound Daemons, On Angel's Wings, … from the Skoll Archive) are later
  packs that add to or override it. A character lists its packs.
- **Git is the rules database**: `data/rules` is a git repo; every edit is
  a commit authored by the editor's passkey id. Backed up like speci
  (panoramix pulls nightly to OneDrive), never mirrored to GitHub (it holds
  GW's text and editors' activity). Code stays in the public repo.
- **Characters** live in SQLite: each a tree of versions (branching
  history; nothing is ever lost). A version is a character record: packs,
  archetype, subtype, the dice results and choices keyed by stable decision
  keys, and overrides. No seeds: dice are stored. When the rules change, a
  character pinned to the old rules version offers "update?", showing what
  differs; new decisions are rolled then. Characters and warbands can be
  duplicated and shared by read-only link.
- **Creation modes**: random (the book's method) and freeform (set stats,
  pick anything); any rule may be overridden, visibly. Warbands group
  characters; the book's warband rules are warnings, not blocks.
- **Balance**: every character shows "underpowered / balanced /
  overpowered", with an (i) for "This character is in the top 1.5% of
  randomly-rolled Inquisitor Fighters.": its power score
  against 1,000 simulated characters of the same archetype and subtype
  (worked out on the server once per rules version, warmed up after every
  rules change);
  the top and bottom 5% are over- and underpowered (owner, November 2026;
  ±1σ flagged about one in four). Power = stats plus points per talent, ability, item,
  mutation and power (points editable on the canvas).
- **Luna** (shelved by the owner, November 2026; not built for now) (`gpt-6-luna`, server-side, its own OpenAI key): a one-shot
  prompt box that makes a character, with follow-up prompts that edit it.
  Its output is a character record, validated by the engine; rule breaks
  are overrides and show in the balance label. Anyone may use it, limited
  per IP.
- **History**: every edit of a character (manual, re-roll, Luna) is a
  version; the history is a branching tree shown on the same canvas engine
  as the rules.
- **Rules canvas**: one big pannable canvas, regions in book order
  (Character Archetypes, Boons, Talents & Exotic Abilities, Equipment,
  Psychic Powers, Mutations), tab icons fly to regions. Cards show rules
  visually as chips (effects) with the book's prose for gameplay-only text;
  wires join archetypes to the tables they roll on. The book's original
  wording sits behind a quote icon with its page, marked stale once the
  card is edited. Anyone signed in edits; edits and card moves are live for
  everyone (SSE); a save against a stale version is refused and handed the
  newer one. Full history with the editor's passkey id; revert from history.
- **Accounts**: speci's model. An account is a random id with passkeys
  (`@passwordless-id/webauthn`), RP ID `inquisitor.pfaj.ca`; no name or
  email. Characters made before signing in live in the browser and move
  into the account on sign-in.
- **Output**: the GM's Word sheet (`BETTER_3_CHARACTERSPER_PAGE.doc`, three
  characters per page, as many pages as needed), filled with everything
  known: name line, stats and derived stats (Kbk, BIV, SS, Cnc, Spd, from
  the core rulebook's formulas) in the Starting column, the armour /
  location table, firearms, melee, other equipment, abilities; Progress and
  Current left blank. Plus a print-friendly HTML sheet in the same layout.
  The on-screen builder is that sheet, edited in place.
- **UI text**: only the book's wording (see AGENTS.md for the approved
  exceptions). Controls are icons with aria-labels and hover tooltips.
- **Devices**: everything works on desktop and phone.

## Steps

0. **The check**: encode all 98 pages (including the 12 tables that are
   scanned images) into the format; report which clauses fit, which are
   gameplay prose and which don't fit; a contact sheet of chips vs node
   graph for the owner to choose.
1. Engine, full transcription, tests, balance simulation, the rules repo.
2. The builder: sheet UI, random and freeform modes, warbands, `.docx` and
   print export.
3. Passkey accounts, saved and shared characters, the history canvas.
4. The rules canvas with live editing and git history.
5. ~~The Luna box.~~ Shelved.
