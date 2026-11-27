# The end-to-end suite

Finds the bugs a person would: the engine disagreeing with the book, a
re-roll, rules update or "choose at random" behaving differently from a
fresh random character, a choice or thing that shows only in the Rolls
panel (or not on the GM sheet), and UI flows that break. It is separate from
`npm test` (the unit suite) and fails on what it finds: app and rules bugs
are reported, never fixed here.

## Running it

```sh
npm run e2e -- --list-shards              # every shard id, one per line
npm run e2e -- --shard engine:inquisitor  # one shard (several --shard, or a glob: 'ui:*')
npm run e2e -- --all --jobs 3             # everything, 3 shards at a time (child processes)
node test/e2e/summary.ts [results dir] [--full]   # findings grouped by check
node test/e2e/coverage.ts [results dir] [--full]  # table rows, things, options no shard reached
```

Options: `--results <dir>` (default `.e2e/results`), `--seeds N` (random
characters per subtype in an engine shard, 300), `--reroll-seeds N` (those
re-rolled, filled or updated, 150), `--few N` (the slower checks: legal
choices, Occupation, overrides, 12), `--ui-seeds N` (seeded characters a UI
shard opens per subtype, 4). The exit code is 1 when any shard failed.

## Shards

- `engine:<archetype>` (one per archetype, ~1–150 s): every subtype, against
  the real rules in `data/rules` (read only). Random characters: no open
  choices, no engine warnings (except those the book or the owner explains:
  an `empty` result, a power restriction that leaves no powers; pending owner
  rulings are notes, `explainWarning`), the record replays exactly (built
  with `buildAll`, so a companion's dice are in it; freeform
  and random, through JSON), every choice legal (among its options, as many
  as it asks: every key of the first few seeds, then every seed with a key
  not seen yet), `:count` dice made as many results, open picks within the
  book's bounds ("any": none at random; "up to N": 0..N, χ² against
  uniform), base stats within the stat line, gear of the rolled
  availability, alien gear only where allowed, nothing a restriction
  refuses, what a thing chose gone with it, everything owned and every option on the GM sheet (names without
  case; a routing option by what it led to, a stat option by its stats), the
  effect kinds worked out again (`engine/kinds.ts`: derived values,
  attributes, wielded, remove, natural weapons, armour per location,
  exclusive, # Rld, powers within their effect's difficulty and disciplines
  plus the groups the character's own `access` opened, no duplicate rows), the
  book's own rules and the owner's rulings (`engine/book.ts`), optional
  effects, chances and alignments as often as the book says (χ²). Then
  every top-level decision re-rolled (and the Stats and Boons Rerolls),
  nested dice re-rolled by themselves (a gear count, `times`, covers' D6,
  quantities), freeform + "choose at random" (all, and one at a time), and
  rules updates that need a decision: each must give a whole character
  distributed as a fresh one (Welch z > 5 on items, talents, powers, stat
  total, power score, decisions, options chosen; χ² on every choice's ids
  and every table's rows). Every Occupation dropdown option (and a choice
  whose every option leaves the sheet the same), overrides (remove/add each
  thing, stats, alignment), the Word export.
- `engine:rules-update`: the rules changed under saved characters (dice, a
  new pick): `diff()` and `updateRules()`.
- `engine:rules-update-entries`: the entries a character uses changed: an
  option it chose removed, a table row it rolled moved (to a row it didn't roll), an item's
  availability or category, a talent's effects, an item deleted, a pick's
  id renamed, the archetype renamed, its subtype removed (a BuildError).
- `engine:trades`: every trade a few random characters are offered taken
  ("yes", then at random): as many given up as it asks (a give that can't
  be met isn't offered), what is given up is gone (an item got again
  counted by its origins under the trade), a downgrade a step
  lower (a Common lost), an upgrade a step higher; "any" trades twice.
- `engine:open-picks`: every open pick filled with one, two, the most and
  every option in turn.
- `engine:packs`: book-only (`loyalist`) records, then every pack added.
- `engine:subtype-roll`: the Alien Bounty Hunter's rolled Level of
  Experience: its distribution, a record holding the roll, a re-roll of it
  (a note: no app path records the roll yet).
- `engine:static`: the rules themselves and the places like the confirmed
  bugs: the GM-approval list (p. 3), the warband rule (recorded, warning
  no character), pool picks with
  nothing (or only one archetype's things, unless the pick is one option of
  several) to choose from, two units of an
  item that makes its own choices.
- `ui:<archetype>` (one per archetype, ~10–50 s): each subtype made with
  the New character form, then seeded characters chosen to cover the most
  options and results (saved through the API). Each: no open choices,
  everything owned and every choice shown outside the Rolls panel, a
  dropdown per archetype pick, the GM approval line, the no-UI-text rule.
  Then every section's Reroll, every Occupation dropdown option (and
  Choose at random on what it opens; each dropdown put back before the next,
  so a parent's own picks are there), Rolls-panel re-rolls (top rows, rows
  under a result or option, deeper ones), the subtype.
- `feature:<area>`: `new-character`, `edits` (name, stats, alignment,
  the Edit / Preview tabs, pickers, add/remove), `rolls`, `undo-redo`,
  `duplicate-delete` (both deletes), `export` (Download Docx from the top
  bar and under the card, Download PDF), `docx` (the .docx's cells:
  stats, derived values, armour, # Rld, quantities), `history`,
  `history-states` (across a rules update), `share` (with its Preview tab
  and Download), `download` (the Download dropdown: the Docx / PDF toggle,
  Include other characters, search, the captions, kept on the server per
  character, the Warband .docx and PDF, a picked character deleted
  elsewhere), `download-states` (a companion in a Warband download and in
  Preview, many characters, the dropdown at phone width),
  `rules-page` (tabs, Table of Contents, search, links, Rolled on by,
  addresses, back/forward), `navigation` (Characters ↔ Rules in place,
  back/forward), `passkey` (Chrome's virtual authenticator), `accounts` (a
  second browser signing in merges, two tabs, a deleted or forged session
  cookie), `rule-edit-live` (edit, history, revert, conflicts, SSE in
  another browser), `rules-editor` (the structured effect editor, New entry,
  Delete, a new pack, a move, Re-apply, a visitor refused, `rules:check` on
  what was saved), `rules-update`, `rules-update-states` (an option removed,
  overrides kept, Apply/Undo/Redo, an archetype deleted, Update after an
  edit made on another page), `legacy-import` (the 2023 browser's
  localStorage, a lost reply retried), `network` (slow, offline, a failed
  save, a server restart, the event stream reconnecting), `phone-light`,
  `phone-dark`, `desktop-light`, `desktop-dark` (a tour of every page at
  390×844 touch or 1366×900: nothing wider than the screen, 24 px tap
  targets, the text rule), `error-pages`, `balance` (the label, both ends,
  an archetype with no distribution yet).

Every UI step fails on console errors, uncaught exceptions and failed
requests (except the 401 the first save of a new browser answers on
purpose), and checks the visible text, placeholders and `confirm()`s
against AGENTS.md's rule (`lib/text.ts`: every word is in the rules or the
approved list) and that icon controls have an aria-label and the same
tooltip.

## Results

Each shard writes `<results>/<shard id, : as _>.json`:

```json
{ "shard": "ui:daemons", "status": "passed | failed | error", "durationMs": 7200,
  "passed": { "<check>": 12 },
  "failures": [{ "check": "…", "message": "…", "count": 3,
                 "repro": { "archetype": "…", "subtype": "…", "seed": 4, "key": "…",
                            "record": { … }, "steps": ["…"], "screenshot": "…png", "url": "…" } }],
  "notes": ["…"], "coverage": ["row:<table>|<label>", "item:<id>", "option:<entry>|<id>", "…"] }
```

Notes hold what isn't a failure: timings, pending owner rulings, what a
shard chose not to check. The owner's rulings of November 2026 are
asserted (`engine/book.ts` `rulings`, `explainWarning`, `engine/kinds.ts`,
`engine/trades.ts`): Study Thy Weapon with no weapon and an MIU with
nothing to link are rolled again (one granted outright keeps the empty
pick), Puppetmaster leaves a power granted outright alone, a set wins over
adds whatever order they came in (Curse of Thlezzloath with Scales: BIV
7), and a downgrade to an availability with nothing of its kind is lost. `coverage` is what the shard's
characters reached; `coverage.ts` lists what no shard did.

A failure seen many times (300 seeds hitting one bug) is one entry with its
count and the first reproduction. Engine reproductions are a seed
(`seededRoller(seed)` on a new record, see `engine/archetype.ts`) and the
record itself; UI ones the steps, the address and a screenshot (in
`<results>/screens/<shard>/`).

## Isolation

Shards run side by side without touching each other or anything real:

- each starts its own server (`lib/app.ts`, `restart()` for feature:network): a temporary directory with a
  `git clone` of `data/rules`, a fresh database with every migration, a free
  port, `PUBLIC_ORIGIN=http://localhost:<port>` (so passkeys work), balance
  warm-up off (on for `feature:balance`). Never the preview or live site.
- each starts its own headless Chrome (`lib/cdp.ts`: `--headless=new`, its
  own profile directory, `--remote-debugging-port=0`), driven over the
  DevTools protocol with Node's WebSocket. It never opens a window.
- processes are tracked by PID (`lib/procs.ts`) and only those are killed,
  on exit or a signal.
- the browser bundle is built once per source state into
  `.e2e/client/<hash>` (a lock directory makes concurrent shards wait for
  one build).

## Adding checks

- A book rule: a function in `engine/book.ts` (`specific[<archetype id>]`,
  or a `PROFILES` line for fixed kit, talents, alignment and armour),
  quoting the book. An owner's ruling likewise, citing it.
- A warning or restriction the book explains: `explainWarning` in
  `engine/archetype.ts` (by design: passes; pending a ruling: a note).
- A feature: a function in `ui/f-*.ts`, registered in `ui/features.ts`. Use
  `Session.step()` (screenshot and console errors on failure) and
  `Session.checkText()`.
