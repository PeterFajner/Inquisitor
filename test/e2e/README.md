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
```

Options: `--results <dir>` (default `.e2e/results`), `--seeds N` (random
characters per subtype in an engine shard, 300), `--reroll-seeds N` (those
re-rolled, filled or updated, 150), `--few N` (the slower checks: legal
choices, Occupation, overrides, 12), `--ui-seeds N` (seeded characters a UI
shard opens per subtype, 4). The exit code is 1 when any shard failed.

## Shards

- `engine:<archetype>` (one per archetype, ~1–50 s): every subtype, against
  the real rules in `data/rules` (read only). Random characters: no open
  choices, no engine warnings, the record replays exactly (freeform and
  random, through JSON), every choice legal (among its options, as many as
  it asks), `:count` dice made as many results, open picks within the
  book's bounds ("any": none at random; "up to N": 0..N, evenly), base stats
  within the stat line, gear of the rolled availability, alien gear only
  where allowed, nothing a restriction refuses, everything owned and every
  option on the GM sheet, the book's own rules (`engine/book.ts`). Then
  every top-level decision re-rolled (and the Stats and Boons Rerolls),
  freeform + "choose at random" (all, and one at a time), and rules updates
  that need a decision: each must give a whole character distributed as a
  fresh one (Welch z > 5 on items, talents, powers, stat total, power score,
  decisions, options chosen). Every Occupation dropdown option, overrides
  (remove/add each thing, stats, alignment), the Word export.
- `engine:rules-update`: the rules changed under saved characters (dice, a
  new pick): `diff()` and `updateRules()`.
- `ui:<archetype>` (one per archetype, ~10–30 s): each subtype made with
  the New character form, then seeded characters chosen to cover the most
  options and results (saved through the API). Each: no open choices,
  everything owned and every choice shown outside the Rolls panel, a
  dropdown per archetype pick, the GM approval line, the no-UI-text rule.
  Then the Stats and Boons Rerolls, every Occupation dropdown option (and
  Choose at random on what it opens), Rolls-panel re-rolls, the subtype.
- `feature:<area>`: `new-character`, `edits` (name, stats, alignment,
  pickers, add/remove), `rolls`, `undo-redo`, `duplicate-delete` (both
  deletes), `export` (Download Docx, print), `history`, `share`, `warbands`,
  `rules-page` (tabs, Table of Contents, search, links, Rolled on by,
  addresses, back/forward), `navigation` (Characters ↔ Rules in place,
  back/forward), `passkey` (Chrome's virtual authenticator), `rule-edit-live`
  (edit, history, revert, conflicts, SSE in another browser), `rules-update`,
  `phone-light`, `phone-dark`, `desktop-light`, `desktop-dark` (a tour of
  every page at 390×844 touch or 1366×900: nothing wider than the screen,
  24 px tap targets, the text rule), `error-pages`, `balance`.

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
  "notes": ["…"] }
```

A failure seen many times (300 seeds hitting one bug) is one entry with its
count and the first reproduction. Engine reproductions are a seed
(`seededRoller(seed)` on a new record, see `engine/archetype.ts`) and the
record itself; UI ones the steps, the address and a screenshot (in
`<results>/screens/<shard>/`).

## Isolation

Shards run side by side without touching each other or anything real:

- each starts its own server (`lib/app.ts`): a temporary directory with a
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

- A book rule: a function in `engine/book.ts` (`specific[<archetype id>]`),
  quoting the book.
- A feature: a function in `ui/f-*.ts`, registered in `ui/features.ts`. Use
  `Session.step()` (screenshot and console errors on failure) and
  `Session.checkText()`.
