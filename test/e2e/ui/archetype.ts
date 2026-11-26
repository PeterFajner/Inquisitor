/// <reference lib="dom.iterable" />
// One archetype through the browser: each subtype made with the New
// character form, then seeded characters picked to cover as many of its
// options and results as possible (saved through the API, opened by
// address). Every character: no open choices, everything it has and every
// choice made shown outside the Rolls panel, the Occupation dropdowns as
// the book's choices, the GM approval line, the no-UI-text rule. Then the
// controls on the character made in the form: every section's Reroll, every option of
// every Occupation dropdown, re-rolls in the Rolls panel, the subtype.
import * as ops from "../../../src/client/builder/ops.ts";
import type { BuildResult } from "../../../src/shared/engine/build.ts";
import type { CharacterRecord } from "../../../src/shared/engine/record.ts";
import { randomBuild } from "../engine/archetype.ts";
import type { Page } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { includesCaseless, ledTo, optionShape } from "../lib/outcomes.ts";
import { archetype, realCompendium } from "../lib/rules.ts";
import { expectedShown, headRecord, idle, newCharacter, openBuilder, openCharacter, saveRecord, Session, shownText } from "../lib/ui.ts";
import type { RunOptions } from "../shards.ts";

const GM_LINE = "* Should have GM approval before use.";
const norm = (k: string) => k.replace(/#\d+|~\d+|\*\d+/g, "#N");

/** Seeds whose characters together show the most different choices and things. */
export function coveringSeeds(archId: string, subId: string, n: number, pool = 300): number[] {
  const c = realCompendium();
  const builds = Array.from({ length: pool }, (_, i) => ({ seed: i + 1, b: randomBuild(c, archId, subId, i + 1) }));
  const facts = (b: BuildResult) => {
    const e = expectedShown(b);
    return new Set([...e.things.map((t) => `t:${t}`), ...e.choices.map((x) => `c:${norm(x.key)}=${x.result}`)]);
  };
  const seen = new Set<string>();
  const out: number[] = [];
  while (out.length < n) {
    let best: { seed: number; gain: number } | null = null;
    for (const { seed, b } of builds) {
      if (out.includes(seed)) continue;
      const gain = [...facts(b)].filter((f) => !seen.has(f)).length;
      if (!best || gain > best.gain) best = { seed, gain };
    }
    if (!best || best.gain === 0) break;
    out.push(best.seed);
    for (const f of facts(builds[best.seed - 1].b)) seen.add(f);
  }
  return out;
}

/** What one character page must show. */
async function checkShown(s: Session, archId: string, rec: CharacterRecord, repro: Repro): Promise<void> {
  const c = realCompendium();
  const arch = archetype(archId);
  const page = s.page;
  const built = ops.view(c, rec);
  const text = await shownText(page);
  const r = s.r;
  // Open choices of a random character: none, so no pending section.
  const pending = await page.eval(() => !!document.querySelector(".csec-pending"));
  r.expect(!pending, "a random character shows no open choices", `pending section shown (${built.pending.map((p) => p.key).join(", ")})`, repro);
  // The GM approval line, under asterisked archetypes only.
  r.expect(text.includes(GM_LINE) === !!arch.gmApproval, "GM approval line under asterisked archetypes only", `gmApproval ${!!arch.gmApproval}, line shown ${text.includes(GM_LINE)}`, repro);
  const want = expectedShown(built);
  // (names compared without case: the book's "Deadeye shot" is the talent "Deadeye Shot")
  for (const t of want.things) r.expect(includesCaseless(text, t), "everything the character has is shown outside the Rolls panel", `${t} not shown`, repro, `${archId}: ${t}`);
  const boons = await page.eval(() => Object.fromEntries([...document.querySelectorAll(".cstats tbody tr")].map((tr) => [tr.querySelector("th")?.textContent ?? "", tr.querySelectorAll("td")[1]?.textContent ?? ""])));
  const options = new Map<string, ReturnType<typeof ops.choiceOptions>>();
  for (const ch of want.choices) {
    if (includesCaseless(text, ch.result)) {
      r.pass("every choice made is shown outside the Rolls panel");
      continue;
    }
    // A choice with one option was made by itself (a forced pick): nothing was chosen.
    if (!options.has(ch.key)) options.set(ch.key, ops.choiceOptions(c, rec, ch.key));
    const p = options.get(ch.key);
    if (!p || p.options.length < 2) continue;
    // A stat change chosen among others ("+5 BS") is shown in the Boon column.
    const statPick = /^[+\-−]\d+ (WS|BS|S|T|I|Wp|Sg|Nv|Ld)$/.exec(ch.result);
    if (statPick) {
      r.expect(!!boons[statPick[1]] && boons[statPick[1]] !== "-", "every choice made is shown outside the Rolls panel", `${ch.key} (${ch.label}) = ${ch.result}: Boon column blank for ${statPick[1]}`, repro, `${archId}: ${norm(ch.key)}`);
      continue;
    }
    // A named option is shown by what it led to (a routing option: "Legendary weapon"), or its stats in the Boon column ("+5 Nv").
    const opt = built.character.options.find((o) => o.key === ch.key && o.name === ch.result);
    const shape = opt ? optionShape(c, opt.source, opt.id) : null;
    if (opt && shape?.kind === "routing" && ledTo(built, ch.key).length) {
      r.pass("every choice made is shown outside the Rolls panel");
      continue;
    }
    if (opt && shape?.kind === "stats") {
      const blank = shape.stats.filter((st) => !boons[st] || boons[st] === "-");
      r.expect(!blank.length, "every choice made is shown outside the Rolls panel", `${ch.key} (${ch.label}) = ${ch.result}: Boon column blank for ${blank.join(", ")}`, repro, `${archId}: ${norm(ch.key)}`);
      continue;
    }
    r.fail("every choice made is shown outside the Rolls panel", `${ch.key} (${ch.label}) = ${ch.result} only in the Rolls panel`, repro, `${archId}: ${norm(ch.key)}`);
  }
  // Occupation: a dropdown per archetype pick, showing the choice made.
  const occ = await page.eval(() => [...document.querySelectorAll(".occ select")].map((x) => ({ label: x.getAttribute("aria-label"), value: (x as HTMLSelectElement).value, text: (x as HTMLSelectElement).selectedOptions[0]?.text ?? "" })));
  for (const e of built.log) {
    if (e.type !== "choice" || e.parent || !e.key.startsWith(`${archId}/`)) continue;
    const p = ops.choiceOptions(c, rec, e.key);
    if (!p || p.kind !== "pick" || p.count !== 1 || p.options.length < 2) continue;
    const chosen = rec.choices[e.key]?.[0];
    r.expect(occ.some((o) => o.value === chosen), "Occupation shows each archetype pick as a dropdown", `${e.key} = ${chosen} (${e.result.join(", ")}) has no dropdown (dropdowns: ${occ.map((o) => `${o.label}=${o.text}`).join("; ")})`, repro, `${archId}: ${norm(e.key)}`);
  }
  await s.checkText(`${archId} character`, repro);
}

export async function uiArchetype(r: Report, archId: string, o: RunOptions): Promise<void> {
  const c = realCompendium();
  const arch = archetype(archId);
  const s = await Session.start(r, o.results);
  try {
    await openBuilder(s.page, s.app.url);
    for (const sub of arch.subtypes) {
      const base: Repro = { archetype: archId, subtype: sub.id };
      // --- the New character form ---------------------------------------------------
      let id: string | null = null;
      const steps = [`/ → New character → Archetype ${archId} → Subtype ${sub.id} → Random`];
      await s.step("New character makes the archetype and subtype chosen", { ...base, steps }, async () => {
        id = await newCharacter(s.page, archId, sub.id);
        const rec = await headRecord(s.page, id);
        if (rec.archetype !== archId || rec.subtype !== sub.id) throw new Error(`made ${rec.archetype}/${rec.subtype}`);
      });
      if (!id) continue;
      const rec = await headRecord(s.page, id);
      await checkShown(s, archId, rec, { ...base, steps, record: rec });

      // --- the controls -----------------------------------------------------------------
      await controls(s, archId, id, { ...base, steps });

      // --- seeded characters, for coverage -------------------------------------------------
      for (const seed of coveringSeeds(archId, sub.id, o.uiSeeds)) {
        const b = randomBuild(c, archId, sub.id, seed);
        const repro: Repro = { ...base, seed, record: b.record, steps: ["saved through the API", "opened at /c/<id>"] };
        let cid = "";
        const ok = await s.step("a saved character opens", repro, async () => {
          cid = await saveRecord(s, b.record);
          await openCharacter(s.page, s.app.url, cid);
        });
        if (ok) await checkShown(s, archId, b.record, repro);
      }
    }
  } finally {
    await s.stop();
  }
}

const versions = async (page: Page, id: string) => (await page.eval(async (x: string) => (await (await fetch(`/api/v1/characters/${x}`)).json()).character.versions.length, id)) as number;

async function controls(s: Session, archId: string, id: string, base: Repro): Promise<void> {
  const page = s.page;
  const c = realCompendium();
  const noPending = async (what: string, repro: Repro) => {
    const rec = await headRecord(page, id);
    const v = ops.view(c, rec);
    s.r.expect(!v.pending.length, `${what} leaves no open choices`, `open: ${v.pending.map((p) => p.key).join(", ")}`, { ...repro, record: rec }, v.pending.map((p) => norm(p.key)).join(", "));
    const shown = await page.eval(() => !!document.querySelector(".csec-pending"));
    s.r.expect(!shown, `${what} leaves no open choices`, "the pending section is shown", { ...repro, record: rec });
  };
  // Every section's Reroll (Stats, Boons, Talents, Equipment…): a new version each, no open choices.
  const sections: string[] = await page.eval(() => [...document.querySelectorAll(".csec-title")].filter((h) => h.querySelector("button.text-btn")).map((h) => h.querySelector("span")?.textContent ?? ""));
  for (const section of sections) {
    const has = await page.eval((t: string) => [...document.querySelectorAll(".csec-title")].some((h) => h.querySelector("span")?.textContent === t && h.querySelector("button.text-btn")), section);
    if (!has) continue;
    const steps = [...(base.steps ?? []), `${section}: Reroll`];
    const n0 = await versions(page, id);
    await s.step(`${section} Reroll makes a new version`, { ...base, steps }, async () => {
      await page.eval((t: string) => {
        document.querySelectorAll('[data-e2e="reroll"]').forEach((el) => el.removeAttribute("data-e2e"));
        const h = [...document.querySelectorAll(".csec-title")].find((x) => x.querySelector("span")?.textContent === t)!;
        h.querySelector("button.text-btn")!.setAttribute("data-e2e", "reroll");
      }, section);
      await page.click('[data-e2e="reroll"]');
      await idle(page);
      const n1 = await versions(page, id);
      if (n1 !== n0 + 1) throw new Error(`versions ${n0} → ${n1}`);
    });
    await noPending(`${section} Reroll`, { ...base, steps });
    if (section === "Boons") {
      // D3+3 boons, re-rolled duplicates aside.
      const rec = await headRecord(page, id);
      const n = Object.keys(rec.dice).filter((k) => /\/boons#\d+$/.test(k)).length;
      const count = rec.dice[Object.keys(rec.dice).find((k) => k.endsWith("/boons:count"))!]?.[0];
      if (count !== undefined) s.r.expect(n === count + 3, "Boons Reroll rolls D3+3 boons", `count die ${count}, ${n} boons`, { ...base, steps, record: rec });
    }
  }
  // Every Occupation dropdown (not Archetype/Subtype), every option; by position (two may share a label).
  const occs = await page.eval(() =>
    [...document.querySelectorAll(".occ select")]
      .map((x, i) => ({ i, label: x.getAttribute("aria-label") ?? "", options: [...(x as HTMLSelectElement).options].map((o) => o.value) }))
      .filter((x) => x.label !== "Archetype" && x.label !== "Subtype"),
  );
  const labels = occs.map((x) => x.label);
  const twice = labels.filter((l, i) => labels.indexOf(l) !== i);
  s.r.expect(!twice.length, "Occupation dropdowns have distinct labels", `two dropdowns labelled ${[...new Set(twice)].map((l) => `"${l}"`).join(", ")}`, base, `${archId}: ${twice.join(",")}`);
  // The same dropdown: by its options (the list may reorder after a change, and Preact may reuse its node for another).
  const mark = (sig: string[]) =>
    page.eval((x: string) => {
      document.querySelectorAll("[data-e2e-occ]").forEach((el) => el.removeAttribute("data-e2e-occ"));
      const opts = (el: Element) => [...(el as HTMLSelectElement).options].map((o) => o.value).filter(Boolean).join("\n");
      const el = [...document.querySelectorAll(".occ select")].find((el) => opts(el) === x);
      el?.setAttribute("data-e2e-occ", "");
      return (el as HTMLSelectElement | undefined)?.value;
    }, sig.filter(Boolean).join("\n"));
  const fill = async (steps: string[]) => {
    if (await page.eval(() => !!document.querySelector(".csec-pending"))) {
      await s.step("Choose at random fills the open choices", { ...base, steps: [...steps, "Choose at random"] }, async () => {
        await page.click('.pending-all [aria-label="Choose at random"]');
        await idle(page);
      });
      await noPending("Choose at random", { ...base, steps: [...steps, "Choose at random"] });
    }
  };
  for (const occ of occs) {
    const original = await mark(occ.options);
    for (const value of occ.options.slice(0, 6)) {
      const steps = [...(base.steps ?? []), `Occupation dropdown #${occ.i} (${occ.label}) → ${value || "–"}`];
      // (a dropdown a parent's change took away, as a Rank 6 pick after Rank 1 is chosen: gone by design; it was restored below before its turn)
      if ((await mark(occ.options)) === undefined) {
        s.r.note(`${archId}: Occupation dropdown ${occ.label} not shown for this character any more (a parent's choice took it away)`);
        break;
      }
      await s.step("Occupation dropdowns change the choice", { ...base, steps }, async () => {
        const cur = await mark(occ.options);
        if (cur === value) return;
        await page.select("select[data-e2e-occ]", value);
        await idle(page);
        const now = await mark(occ.options);
        if (now !== value) throw new Error(`${occ.label} shows ${JSON.stringify(now)} after choosing ${JSON.stringify(value)}`);
      });
      // What the change opened: Choose at random fills it.
      await fill(steps);
      await s.checkText(`${archId} after Occupation ${occ.label}`, { ...base, steps });
    }
    // Back to the choice it had, so the dropdowns that depend on it (a Rank's own picks) are there for their turn.
    if (original !== undefined && (await mark(occ.options)) !== original) {
      const steps = [...(base.steps ?? []), `Occupation dropdown #${occ.i} (${occ.label}) → ${original || "–"} (as it was)`];
      await s.step("Occupation dropdowns change the choice", { ...base, steps }, async () => {
        await page.select("select[data-e2e-occ]", original);
        await idle(page);
      });
      await fill(steps);
    }
  }
  // The Rolls panel: open it, re-roll the first few top rows.
  const rollSteps = [...(base.steps ?? []), "Rolls"];
  await s.step("the Rolls panel opens", { ...base, steps: rollSteps }, async () => {
    await page.clickLabel("Rolls");
    // (a fixed profile, as an Arbite's, has nothing rolled or chosen: an empty table)
    await page.waitFor(() => !!document.querySelector(".csec-log:not(.collapsed)"), [], { what: "the Rolls panel open" });
  });
  // Top rows, rows nested under a result or an option, and rows deeper still: a few of each depth.
  const rows = await page.eval(() =>
    [...document.querySelectorAll(".log .log-row")]
      .map((row) => ({ depth: Number(getComputedStyle(row).getPropertyValue("--depth").trim() || 0), label: row.querySelector('[aria-label^="Re-roll: "]')?.getAttribute("aria-label") }))
      .filter((x) => x.label) as { depth: number; label: string }[],
  );
  const pickRows = (keep: (d: number) => boolean, n: number) => [...new Set(rows.filter((x) => keep(x.depth)).map((x) => x.label))].filter((l) => !/: (WS|BS|S|T|I|Wp|Sg|Nv|Ld)$/.test(l)).slice(0, n);
  const chosenRows = [...new Set([...pickRows((d) => d === 0, 5), ...pickRows((d) => d === 1, 4), ...pickRows((d) => d >= 2, 3)])];
  for (const label of chosenRows) {
    // An earlier re-roll may have taken this row away.
    if (!(await page.eval((l: string) => !!document.querySelector(`.log [aria-label="${l}"]`), label))) continue;
    const steps = [...rollSteps, label];
    const n0 = await versions(page, id);
    await s.step("Rolls panel re-roll makes a new version", { ...base, steps }, async () => {
      await page.clickLabel(label);
      await idle(page);
      const n1 = await versions(page, id);
      if (n1 !== n0 + 1) throw new Error(`versions ${n0} → ${n1}`);
    });
    await noPending("Rolls panel re-roll", { ...base, steps });
  }
  await s.step("the Rolls panel closes", { ...base, steps: rollSteps }, async () => {
    await page.clickLabel("Rolls");
    await page.waitFor(() => !document.querySelector(".log"));
  });
  // Another subtype.
  const arch = archetype(archId);
  if (arch.subtypes.length > 1) {
    const rec = await headRecord(page, id);
    const other = arch.subtypes.find((x) => x.id !== rec.subtype)!;
    const steps = [...(base.steps ?? []), `Occupation Subtype → ${other.id}`];
    await s.step("Occupation subtype rebuilds the character", { ...base, steps }, async () => {
      await page.select('.occ select[aria-label="Subtype"]', other.id);
      await idle(page);
      const now = await headRecord(page, id);
      if (now.subtype !== other.id) throw new Error(`subtype ${now.subtype}`);
    });
    await noPending("Occupation subtype", { ...base, steps });
  }
}
