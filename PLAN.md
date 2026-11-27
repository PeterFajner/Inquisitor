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
  differs; new decisions are rolled then. Characters can be duplicated and
  shared by read-only link.
- **Creation modes**: random (the book's method) and freeform (set stats,
  pick anything); any rule may be overridden, visibly.
- **Downloads** (owner, November 2026): a character's Download button
  saves the GM's sheet as Docx or PDF; its arrow's dropdown picks the
  format and "Include other characters" (searched, any number), which
  makes it the "Warband" download. Both are kept with the account. Saved
  warbands went with this; the book's warband rules are recorded, not
  checked. The character shows as its card (Edit) or its sheet (Preview).
- **Balance**: every character shows "underpowered / balanced /
  overpowered", with an (i) for "This character is in the top 1.5% of
  randomly-rolled Inquisitor Fighters.": its power score
  against 1,000 simulated characters of the same archetype and subtype
  (worked out on the server once per rules version, warmed up after every
  rules change);
  the top and bottom 5% are over- and underpowered (owner, November 2026;
  ±1σ flagged about one in four). Power = stats plus points per talent, ability, item,
  mutation and power (points editable on the rules page).
- **Luna** (shelved by the owner, November 2026; not built for now) (`gpt-6-luna`, server-side, its own OpenAI key): a one-shot
  prompt box that makes a character, with follow-up prompts that edit it.
  Its output is a character record, validated by the engine; rule breaks
  are overrides and show in the balance label. Anyone may use it, limited
  per IP.
- **History**: every edit of a character (manual, re-roll, Luna) is a
  version; the history is a branching tree shown on the same canvas engine
  as the rules.
- **Rules page** (owner, November 2026; src/client/rules/RulesBook.tsx): a
  tab per kind across every book (Character Archetypes, Talents & Exotic
  Abilities, Equipment, Psychic Powers, Mutations, Tables, Rules), each one
  ordinary scrolling page: the book's groups as headed shelves in book
  order, cards A–Z in columns (one on a phone). A sidebar holds the tab's
  Table of Contents (the shelves and their cards' names; a name scrolls to
  its card, the reader's place is picked out), opened and closed with an
  icon (remembered per browser; open on wide screens, over the page on a
  phone). The packs menu filters the books (no per-book marks on the
  cards: owner, November 2026), a search icon finds a card by name; a link between cards (a chip's
  reference, a table's "Rolled on by") switches tab, scrolls to the card and
  flashes it; every card has its own address (#<pack>:<kind>/<id>), so back,
  forward and shared links work. Cards show rules visually as chips
  (effects) with the book's prose for gameplay-only text. The book's
  original wording sits behind a quote icon with its page, marked stale once
  the card is edited. Anyone signed in edits; edits are live for everyone
  (SSE); a save against a stale version is refused and handed the newer
  one. Full history with the editor's passkey id; revert from history.
- **Rules canvas: shelved** (owner, November 2026). The rules were first one
  big pannable, zoomable canvas laid out as shelves (docs/CANVAS.md: regions
  by kind, A–Z indexes far out, drawn cards, wires between a card and the
  tables it rolls on). The owner liked it, but judged the GM would find it
  hard to use (panning and zooming to read a rule), so the rules page above
  replaced it. Its code stays (src/client/canvas, src/client/rules/
  RulesCanvas.tsx) so it can come back; the server no longer bakes or serves
  the cards' geometry it drew small cards from.
- **Accounts**: speci's model. An account is a random id with passkeys
  (`@passwordless-id/webauthn`), RP ID `inquisitor.pfaj.ca`; no name or
  email.
- **Visitors** (owner, November 2026): nothing is stored in the browser;
  every character lives on the server. A browser's first save
  makes it a visitor: an account with no passkeys, with the usual session
  cookie (`POST /api/v1/account/visitor`, per-IP limited in nginx; page
  views make none). "Create account" puts the passkey on the visitor's own
  account, so everything stays; "Sign in" moves the visitor's characters and
  settings into the account signed into and drops the visitor; "Sign out"
  ends the session, and the next save makes a new visitor. "Signed in" in
  the UI means a passkey account, and only those edit the rules. The same
  per-account limits apply to visitors. Characters browsers kept in
  localStorage before this go to the server once, on load (as an import),
  and are removed there once the server has them. Old visitors are not
  cleaned up for now (`accounts.last_seen_at` records use; revisit at 1 GB
  of storage).
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
4. The rules canvas with live editing and git history (since replaced by
   the rules page: a tab per kind, a Table of Contents; the canvas shelved).
5. ~~The Luna box.~~ Shelved.
