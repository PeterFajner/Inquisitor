/// <reference lib="dom.iterable" />
// The builder's features, each a shard: the New character form, editing a
// character in place (name, stats, alignment, adding and removing things),
// the Rolls panel, undo/redo, duplicate, both deletes, the Word and print
// exports.
import { existsSync } from "node:fs";
import * as ops from "../../../src/client/builder/ops.ts";
import type { Page } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium } from "../lib/rules.ts";
import { api, currentId, headRecord, idle, newCharacter, openBuilder, openList, Session, shownText } from "../lib/ui.ts";
import { docxText, unzipEntry } from "../lib/zip.ts";
import type { RunOptions } from "../shards.ts";

// As src/client/builder/NewCharacter.tsx (a .tsx Node can't load): an archetype as one character, the dropdown's order.
const archetypeName = (a: { name: string; characters?: string }): string => a.characters ?? a.name;
const byArchetypeName = (a: { name: string; characters?: string }, b: { name: string; characters?: string }): number => archetypeName(a).localeCompare(archetypeName(b));

export async function withSession(r: Report, o: RunOptions, fn: (s: Session) => Promise<void>, opts: Parameters<typeof Session.start>[3] & { view?: Parameters<typeof Session.start>[2] } = {}): Promise<void> {
  const s = await Session.start(r, o.results, opts.view, opts);
  try {
    await fn(s);
  } finally {
    await s.stop();
  }
}

const characterJson = async (page: Page, id: string) => (await api(page, "GET", `/api/v1/characters/${id}`)).body.character as { name: string; head_id: string; versions: { id: string; parent_id: string | null; record: any; kind: string }[]; shares?: string[] };
const rowCount = (page: Page) => page.eval(() => document.querySelectorAll(".char-list .char-row").length);

export async function newCharacterFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    const repro: Repro = { steps: ["open / in a new browser"] };
    await s.step("a first visit shows the New character form", repro, async () => {
      await openBuilder(page, s.app.url);
      await page.waitFor(() => !!document.querySelector(".new-char"), [], { what: "the New character form" });
      if (new URL(await page.url()).pathname !== "/") throw new Error(`address ${await page.url()}`);
    });
    await s.step("the Archetype dropdown lists every archetype A–Z, asterisked for GM approval", repro, async () => {
      const opts = await page.eval(() => [...(document.querySelector('.new-char select[aria-label="Archetype"]') as HTMLSelectElement).options].map((x) => ({ v: x.value, t: x.text })));
      const want = [...c.archetypes.values()].sort(byArchetypeName).map((a) => ({ v: a.id, t: `${archetypeName(a)}${a.gmApproval ? "*" : ""}` }));
      if (JSON.stringify(opts) !== JSON.stringify(want)) throw new Error(`dropdown ${JSON.stringify(opts).slice(0, 300)} ≠ ${JSON.stringify(want).slice(0, 300)}`);
      const v = await page.eval(() => (document.querySelector('.new-char select[aria-label="Archetype"]') as HTMLSelectElement).value);
      if (v !== "inquisitor") throw new Error(`starts on ${v}, not Inquisitor`);
    });
    await s.step("the Subtype dropdown follows the archetype (none for one subtype)", repro, async () => {
      for (const a of c.archetypes.values()) {
        await page.select('.new-char select[aria-label="Archetype"]', a.id);
        const subs = await page.eval(() => {
          const sel = document.querySelector('.new-char select[aria-label="Subtype"]') as HTMLSelectElement | null;
          return sel ? [...sel.options].map((x) => x.value) : null;
        });
        const want = a.subtypes.length > 1 ? a.subtypes.map((x) => x.id) : null;
        if (JSON.stringify(subs) !== JSON.stringify(want)) throw new Error(`${a.id}: subtypes ${JSON.stringify(subs)} ≠ ${JSON.stringify(want)}`);
      }
    });
    await s.checkText("New character form", repro);
    let id = "";
    await s.step("Random makes the character and lists it", { steps: [...repro.steps!, "Inquisitor, Fighter → Random"] }, async () => {
      id = await newCharacter(page, "inquisitor", "fighter");
      await openList(page);
      const row = await page.eval(() => [...document.querySelectorAll(".char-row")].map((x) => x.textContent));
      if (row.length !== 1 || !row[0]!.includes("Inquisitor, Fighter") || !row[0]!.startsWith("–")) throw new Error(`list ${JSON.stringify(row)}`);
      const cur = await page.eval(() => document.querySelector('.char-row[aria-current="true"]')?.textContent ?? null);
      if (!cur) throw new Error("the new character isn't highlighted in the list");
    });
    await s.step("New character hides the current character until made or closed", { steps: ["New character"] }, async () => {
      await openList(page);
      await page.clickLabel("New character");
      await page.waitFor(() => !!document.querySelector(".new-char"));
      const st = await page.eval(() => ({
        path: location.pathname,
        tools: !!document.querySelector('[aria-label="Undo"]'),
        view: !!document.querySelector(".char-view"),
        current: !!document.querySelector('.char-row[aria-current="true"]'),
      }));
      if (st.path !== "/" || st.tools || st.view || st.current) throw new Error(`while making: ${JSON.stringify(st)}`);
      await page.click('.new-char [aria-label="Close"]');
      await page.waitFor((x: string) => location.pathname === `/c/${x}` && !!document.querySelector(".char-view"), [id], { what: "back to the character" });
    });
    // Every archetype through the form, one subtype each: made, listed with its name.
    for (const a of [...c.archetypes.values()].sort(byArchetypeName)) {
      const sub = a.subtypes[a.subtypes.length - 1];
      await s.step("every archetype can be made from the form", { archetype: a.id, subtype: sub.id, steps: ["New character", `${a.id} / ${sub.id}`, "Random"] }, async () => {
        const cid = await newCharacter(page, a.id, sub.id);
        const rec = await headRecord(page, cid);
        if (rec.archetype !== a.id || rec.subtype !== sub.id) throw new Error(`made ${rec.archetype}/${rec.subtype}`);
        const tag = await page.eval(() => document.querySelector('.char-row[aria-current="true"] .char-row-tag')?.textContent ?? "");
        if (!tag.startsWith(archetypeName(a))) throw new Error(`list tag "${tag}"`);
      });
    }
    r.expect((await rowCount(page)) === c.archetypes.size + 1, "the list has every character made", `${await rowCount(page)} rows`, repro);
  });
}

export async function editsFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "inquisitor", "fighter");
    const base: Repro = { archetype: "inquisitor", subtype: "fighter", steps: ["New character Inquisitor Fighter"] };
    await s.step("rename with the name field", { ...base, steps: [...base.steps!, "type a name, Enter"] }, async () => {
      await page.click('input[aria-label="Rename"]');
      await page.type("E2E Malachai");
      await page.key("Enter");
      await idle(page);
      const ch = await characterJson(page, id);
      if (ch.name !== "E2E Malachai") throw new Error(`name ${ch.name}`);
      const row = await page.eval(() => document.querySelector('.char-row[aria-current="true"] .char-row-name')?.textContent);
      if (row !== "E2E Malachai") throw new Error(`list shows ${row}`);
    });
    // Stats: the card's Base, then the sheet's Starting cell, then restore.
    const rec0 = await headRecord(page, id);
    const v0 = ops.view(c, rec0).character;
    // (before the human cap: a WS held at 100 has more Boon than 100 − Base)
    const boonWS = (v0.stats.WS.uncapped ?? v0.stats.WS.modified) - v0.stats.WS.base;
    await s.step("a stat's Base edited sets the Total (overridden)", { ...base, steps: [...base.steps!, "Base WS → 31"] }, async () => {
      await page.click('button.cstats-edit[aria-label^="Base WS "]');
      await page.eval(() => {
        const i = document.querySelector('input[aria-label="Base WS"]') as HTMLInputElement;
        i.focus();
        i.select();
      });
      await page.type("31");
      await page.key("Enter");
      await idle(page);
      const total = await page.eval(() => {
        const row = [...document.querySelectorAll(".cstats tbody tr")].find((x) => x.querySelector("th")?.textContent === "WS")!;
        return { total: row.querySelector(".cstats-total")?.textContent, ovr: row.classList.contains("ovr") };
      });
      if (total.total !== String(31 + boonWS) || !total.ovr) throw new Error(`WS row ${JSON.stringify(total)}, wanted ${31 + boonWS} overridden`);
    });
    // The sheet is the Preview tab's; its controls edit the character as the card's do.
    await s.step("the Preview tab shows the sheet in place of the card; Edit brings the card back", { ...base, steps: [...base.steps!, "Preview", "Edit", "Preview"] }, async () => {
      await page.click('.view-tab[data-tab="preview"]');
      await page.waitFor(() => !!document.querySelector(".char-sheet .sheet") && !document.querySelector(".ccard"), [], { what: "the sheet alone" });
      if ((await page.eval(() => document.querySelector('.view-tab[aria-selected="true"]')?.textContent)) !== "Preview") throw new Error("Preview isn't the selected tab");
      await page.click('.view-tab[data-tab="edit"]');
      await page.waitFor(() => !!document.querySelector(".ccard") && !document.querySelector(".char-sheet"), [], { what: "the card alone" });
      // The arrow keys move between the tabs.
      await page.eval(() => (document.querySelector('.view-tab[aria-selected="true"]') as HTMLElement).focus());
      await page.key("ArrowRight");
      await page.waitFor(() => !!document.querySelector(".char-sheet .sheet") && document.activeElement?.getAttribute("data-tab") === "preview", [], { what: "Preview by the arrow key" });
    });
    await s.step("the sheet's stat cell edits and restores", { ...base, steps: [...base.steps!, "Preview", "sheet BS → 12", "restore"] }, async () => {
      await page.click('.char-sheet button.cell-btn[aria-label^="BS "]');
      await page.eval(() => {
        const i = document.querySelector('.char-sheet input[aria-label="BS"]') as HTMLInputElement;
        i.focus();
        i.select();
      });
      await page.type("12");
      await page.key("Enter");
      await idle(page);
      const rec = await headRecord(page, id);
      if (!rec.overrides.some((x) => x.op === "stat" && x.stat === "BS" && x.value === 12)) throw new Error(`overrides ${JSON.stringify(rec.overrides)}`);
      await page.click('.char-sheet button.restore[aria-label^="Restore the rules\' value: BS"]');
      await idle(page);
      const back = await headRecord(page, id);
      if (back.overrides.some((x) => x.op === "stat" && x.stat === "BS")) throw new Error("BS still overridden");
    });
    await s.step("alignment: change, marked, back to the rules'", { ...base, steps: [...base.steps!, "alignment → other", "alignment → ↺"] }, async () => {
      const cur = await page.eval(() => (document.querySelector('select[aria-label="Alignment"]') as HTMLSelectElement).value);
      const other = ["Puritan", "Radical", "Neutral"].find((x) => x !== cur)!;
      await page.select('select[aria-label="Alignment"]', other);
      await idle(page);
      const marked = await page.eval(() => !!document.querySelector('.sheet-align [aria-label="Overridden"]'));
      if (!marked) throw new Error("no Overridden mark");
      await page.select('select[aria-label="Alignment"]', "");
      await idle(page);
      const rec = await headRecord(page, id);
      if (rec.overrides.some((x) => x.op === "alignment")) throw new Error("still overridden");
    });
    for (const [tab, kind, label] of [["Talents", "talent", "Talents"], ["Exotic Abilities", "exotic", "Exotic Abilities"], ["Mutations", "mutation", "Mutations"], ["Psychic Abilities", "power", "Psychic Abilities"]] as const) {
      await s.step(`add from the abilities picker (${label}), then remove`, { ...base, steps: [...base.steps!, `Add (abilities) → ${tab} → first`, "Remove"] }, async () => {
        await page.click(".sheet-add", 0);
        await page.waitFor(() => !!document.querySelector("dialog.bpick[open]"));
        await page.eval((t: string) => [...document.querySelectorAll(".bpick-tab")].find((x) => x.textContent === t)!.setAttribute("data-e2e", "tab"), tab);
        await page.click('[data-e2e="tab"]');
        await page.waitFor((t: string) => document.querySelector('.bpick-tab[aria-selected="true"]')?.textContent === t, [tab]);
        const name = await page.eval(() => document.querySelector(".bpick-opt .bpick-opt-label")?.textContent ?? "");
        await page.click(".bpick-opt", 0);
        await idle(page);
        const rec = await headRecord(page, id);
        if (!rec.overrides.some((x) => x.op === "add" && x.kind === kind)) throw new Error(`no ${kind} added: ${JSON.stringify(rec.overrides)}`);
        const text = await shownText(page);
        if (!text.includes(name)) throw new Error(`${name} not shown after adding`);
        await page.clickLabel(`Remove: ${await page.eval((n: string) => [...document.querySelectorAll(".line-x")].map((x) => x.getAttribute("aria-label")!.slice(8)).find((x) => x.startsWith(n)) ?? n, name)}`);
        await idle(page);
        const after = await headRecord(page, id);
        if (after.overrides.some((x) => x.op === "add" && x.kind === kind)) throw new Error(`${name} still added`);
      });
    }
    await s.step("search in the equipment picker, add, then remove", { ...base, steps: [...base.steps!, "Add (equipment) → search Bolt Pistol"] }, async () => {
      await page.click(".sheet-add", 1);
      await page.waitFor(() => !!document.querySelector("dialog.bpick[open]"));
      await page.click('dialog.bpick input[aria-label="Search"]');
      await page.type("Bolt Pistol");
      await page.waitFor(() => [...document.querySelectorAll(".bpick-opt-label")].some((x) => x.textContent === "Bolt Pistol"));
      await page.eval(() => [...document.querySelectorAll(".bpick-opt")].find((x) => x.querySelector(".bpick-opt-label")?.textContent === "Bolt Pistol")!.setAttribute("data-e2e", "opt"));
      await page.click('[data-e2e="opt"]');
      await idle(page);
      const ch = ops.view(c, await headRecord(page, id)).character;
      const bp = ch.items.find((x) => x.id === "bolt-pistol");
      if (!bp?.overridden) throw new Error("Bolt Pistol not added");
      if (!(await shownText(page)).includes("Bolt Pistol")) throw new Error("Bolt Pistol not shown");
    });
    await s.step("remove an item the rules gave, flagged", { ...base, steps: [...base.steps!, "Remove: first item"] }, async () => {
      const rec = await headRecord(page, id);
      const ch = ops.view(c, rec).character;
      const it = ch.items.find((x) => !x.overridden);
      if (!it) return;
      const label = await page.eval((n: string) => [...document.querySelectorAll(".line-x")].map((x) => x.getAttribute("aria-label")!).find((x) => x.startsWith(`Remove: ${n}`)) ?? null, it.name);
      if (!label) throw new Error(`no remove button for ${it.name}`);
      await page.clickLabel(label);
      await idle(page);
      const after = await headRecord(page, id);
      if (!after.overrides.some((x) => x.op === "remove" && x.id === it.id)) throw new Error("no remove override");
    });
    await s.checkText("an edited character", base, page, ["E2E Malachai"]);
    await s.step("the tab picked stays after a reload (this browser's)", { ...base, steps: [...base.steps!, "reload"] }, async () => {
      await page.reload();
      await page.waitFor(() => !!document.querySelector(".char-sheet .sheet"), [], { what: "Preview after the reload" });
      await page.click('.view-tab[data-tab="edit"]');
      await page.waitFor(() => !!document.querySelector(".ccard"));
      // The added Bolt Pistol shows on the card too.
      if (!(await shownText(page)).includes("Bolt Pistol")) throw new Error("Bolt Pistol not on the card");
    });
    await s.checkText("an edited character's card", base, page, ["E2E Malachai"]);
  });
}

export async function rollsFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    // Inquisitors make choices (faction, alignment) and roll (stats, gear, boons).
    const id = await newCharacter(page, "inquisitor", "psyker");
    const base: Repro = { archetype: "inquisitor", subtype: "psyker", steps: ["New character Inquisitor Psyker", "Rolls"] };
    await s.step("the Rolls panel lists every decision in order", base, async () => {
      await page.clickLabel("Rolls");
      await page.waitFor(() => document.querySelectorAll(".log .log-row").length > 0);
      const rows = await page.eval(() => document.querySelectorAll(".log .log-row").length);
      const v = ops.view(c, await headRecord(page, id));
      if (rows !== v.log.length) throw new Error(`${rows} rows, the log has ${v.log.length}`);
    });
    await s.checkText("the Rolls panel", base);
    await s.step("change a choice in the Rolls panel with the picker", { ...base, steps: [...base.steps!, "Change: (the alignment)"] }, async () => {
      const rec = await headRecord(page, id);
      const v = ops.view(c, rec);
      const e = v.log.find((x) => x.type === "choice" && x.key === "inquisitor/alignment")!;
      const label = `Change: ${e.label}`;
      const i = await page.eval((l: string, key: string) => {
        const rows = [...document.querySelectorAll(".log .log-row")];
        return rows.findIndex((row) => row.querySelector(`[aria-label="${l}"]`) && row.textContent?.includes(key));
      }, label, e.result[0]);
      if (i < 0) throw new Error(`no ${label} row`);
      await page.eval((n: number, l: string) => document.querySelectorAll(".log .log-row")[n].querySelector(`[aria-label="${l}"]`)!.setAttribute("data-e2e", "chg"), i, label);
      await page.click('[data-e2e="chg"]');
      await page.waitFor(() => !!document.querySelector("dialog.bpick[open]"));
      const other = await page.eval((cur: string) => [...document.querySelectorAll(".bpick-opt-label")].map((x) => x.textContent!).find((x) => x !== cur) ?? null, e.result[0]);
      if (!other) throw new Error("no other option");
      await page.eval((t: string) => [...document.querySelectorAll(".bpick-opt")].find((x) => x.querySelector(".bpick-opt-label")?.textContent === t)!.setAttribute("data-e2e", "opt"), other);
      await page.click('[data-e2e="opt"]');
      await idle(page);
      const after = await headRecord(page, id);
      if (after.choices["inquisitor/alignment"]?.[0] !== other) throw new Error(`alignment ${JSON.stringify(after.choices["inquisitor/alignment"])}, chose ${other}`);
      // The faction depends on it: chosen again (pending, or made).
      const nv = ops.view(c, after);
      if (nv.pending.length) {
        await page.click('.pending-all [aria-label="Choose at random"]');
        await idle(page);
      }
      const done = ops.view(c, await headRecord(page, id));
      if (done.pending.length) throw new Error(`open: ${done.pending.map((p) => p.key)}`);
    });
    await s.step("every re-roll button in the Rolls panel works", { ...base, steps: [...base.steps!, "Re-roll each row (top rows)"] }, async () => {
      const labels = await page.eval(() => [...new Set([...document.querySelectorAll('.log [aria-label^="Re-roll: "]')].map((x) => x.getAttribute("aria-label")!))]);
      for (const l of labels.slice(0, 12)) {
        if (!(await page.eval((x: string) => !!document.querySelector(`.log [aria-label="${x}"]`), l))) continue;
        await page.clickLabel(l);
        await idle(page);
        const v = ops.view(c, await headRecord(page, id));
        if (v.pending.length) throw new Error(`${l}: left open ${v.pending.map((p) => p.key)}`);
      }
    });
    await s.step("a re-rolled duplicate is marked Rolled again", base, async () => {
      const v = ops.view(c, await headRecord(page, id));
      const n = v.log.filter((e) => e.rerolled).length;
      const shown = await page.eval(() => document.querySelectorAll('.log .log-row.rerolled [aria-label="Rolled again"]').length);
      if (n !== shown) throw new Error(`${n} re-rolled in the log, ${shown} marked`);
    });
  });
}

export async function undoFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "rogue-trader", "fighter");
    const base: Repro = { archetype: "rogue-trader", subtype: "fighter", steps: ["New character Rogue Trader Fighter"] };
    const head = async () => (await characterJson(page, id)).head_id;
    const h0 = await head();
    const disabled = (l: string) => page.eval((x: string) => (document.querySelector(`[aria-label="${x}"]`) as HTMLButtonElement | null)?.disabled ?? null, l);
    await s.step("undo is off on a new character, redo too", base, async () => {
      if ((await disabled("Undo")) !== true || (await disabled("Redo")) !== true) throw new Error(`Undo ${await disabled("Undo")}, Redo ${await disabled("Redo")}`);
    });
    // Three edits.
    const names = ["E2E One", "E2E Two", "E2E Three"];
    for (const n of names) {
      await page.eval(() => {
        const i = document.querySelector('input[aria-label="Rename"]') as HTMLInputElement;
        i.focus();
        i.select();
      });
      await page.type(n);
      await page.key("Enter");
      await idle(page);
    }
    const shownName = () => page.eval(() => (document.querySelector('input[aria-label="Rename"]') as HTMLInputElement).value);
    await s.step("undo steps back through the versions", { ...base, steps: [...base.steps!, "rename ×3", "Undo ×3"] }, async () => {
      for (const want of ["E2E Two", "E2E One", ""]) {
        await page.clickLabel("Undo");
        await idle(page);
        if ((await shownName()) !== want) throw new Error(`after undo: "${await shownName()}", wanted "${want}"`);
      }
      if ((await head()) !== h0) throw new Error("head isn't the first version");
      if ((await disabled("Undo")) !== true) throw new Error("Undo still on at the first version");
    });
    await s.step("redo steps forward again", { ...base, steps: [...base.steps!, "Redo ×3"] }, async () => {
      for (const want of ["E2E One", "E2E Two", "E2E Three"]) {
        await page.clickLabel("Redo");
        await idle(page);
        if ((await shownName()) !== want) throw new Error(`after redo: "${await shownName()}", wanted "${want}"`);
      }
      if ((await disabled("Redo")) !== true) throw new Error("Redo still on at the newest version");
    });
    await s.step("an edit after undo branches; redo follows the branch undone from", { ...base, steps: [...base.steps!, "Undo", "Stats Reroll", "Undo", "Redo"] }, async () => {
      await page.clickLabel("Undo");
      await idle(page);
      await page.eval(() => [...document.querySelectorAll(".csec-title")].find((x) => x.textContent?.startsWith("Stats"))!.querySelector("button")!.setAttribute("data-e2e", "reroll"));
      await page.click('[data-e2e="reroll"]');
      await idle(page);
      const branch = await head();
      await page.clickLabel("Undo");
      await idle(page);
      await page.clickLabel("Redo");
      await idle(page);
      if ((await head()) !== branch) throw new Error("redo went to the other branch, not the one undone from");
      const ch = await characterJson(page, id);
      if (ch.versions.length !== 5) throw new Error(`${ch.versions.length} versions (nothing is lost: 5 expected)`);
    });
    await s.step("undo survives a reload", { ...base, steps: [...base.steps!, "reload", "Undo"] }, async () => {
      await page.reload();
      await page.waitFor(() => !!document.querySelector(".char-view"));
      await idle(page);
      const before = await head();
      await page.clickLabel("Undo");
      await idle(page);
      if ((await head()) === before) throw new Error("undo did nothing after a reload");
    });
  });
}

export async function duplicateDeleteFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "adepta-sororitas", "battle-sister");
    const base: Repro = { archetype: "adepta-sororitas", subtype: "battle-sister", steps: ["New character Battle Sister"] };
    // The test's own checks that a deleted character is gone (GET answers 404).
    page.allow.push(/404 \(Not Found\) \S+\/api\/v1\/characters\/[\w-]+$/);
    let dup = "";
    await s.step("Duplicate makes a copy and shows it", { ...base, steps: [...base.steps!, "Duplicate"] }, async () => {
      await page.clickLabel("Duplicate");
      await idle(page);
      dup = (await currentId(page))!;
      if (!dup || dup === id) throw new Error(`address ${await page.url()}`);
      const [a, b] = [await headRecord(page, id), await headRecord(page, dup)];
      const strip = (x: any) => JSON.stringify({ ...x, rulesVersion: undefined });
      if (strip(a) !== strip(b)) throw new Error("the copy's record differs");
      if ((await rowCount(page)) !== 2) throw new Error(`${await rowCount(page)} rows`);
    });
    await s.step("the top bar's Delete asks; Cancel keeps it", { ...base, steps: [...base.steps!, "Delete (top bar)", "Cancel"] }, async () => {
      page.dialogAnswer = false;
      await page.click('.char-delete [aria-label="Delete"]');
      await idle(page);
      const d = page.dialogs[page.dialogs.length - 1];
      if (!d || d.type !== "confirm") throw new Error("no confirm()");
      if ((await rowCount(page)) !== 2) throw new Error("deleted though cancelled");
    });
    await s.step("the top bar's Delete asks; OK deletes", { ...base, steps: [...base.steps!, "Delete (top bar)", "OK"] }, async () => {
      page.dialogAnswer = true;
      await page.click('.char-delete [aria-label="Delete"]');
      await idle(page);
      const res = await api(page, "GET", `/api/v1/characters/${dup}`);
      if (res.status !== 404) throw new Error(`the copy is still there (${res.status})`);
      if ((await rowCount(page)) !== 1) throw new Error(`${await rowCount(page)} rows`);
      if ((await currentId(page)) !== id) throw new Error(`shows ${await page.url()} after the delete`);
    });
    await s.step("the Delete under the character asks; Cancel keeps it", { ...base, steps: [...base.steps!, "Delete (under the character)", "Cancel"] }, async () => {
      page.dialogAnswer = false;
      await page.click('.char-foot [aria-label="Delete"]');
      await idle(page);
      const d = page.dialogs[page.dialogs.length - 1];
      if (!d || d.type !== "confirm") throw new Error("no confirm()");
      if ((await api(page, "GET", `/api/v1/characters/${id}`)).status !== 200) throw new Error("deleted though cancelled");
    });
    await s.checkText("the Delete confirm()", base);
    await s.step("the Delete under the character asks; OK deletes", { ...base, steps: [...base.steps!, "Delete (under the character)", "OK"] }, async () => {
      page.dialogAnswer = true;
      await page.click('.char-foot [aria-label="Delete"]');
      await idle(page);
      if ((await api(page, "GET", `/api/v1/characters/${id}`)).status !== 404) throw new Error("not deleted");
      await page.waitFor(() => !!document.querySelector(".new-char") && location.pathname === "/", [], { what: "the New character form after the last delete" });
    });
  });
}

export async function exportFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "imperial-guard", "fighter");
    await page.click('input[aria-label="Rename"]');
    await page.type("E2E Varro");
    await page.key("Enter");
    await idle(page);
    const base: Repro = { archetype: "imperial-guard", subtype: "fighter", steps: ["New character Imperial Guard Fighter", "name E2E Varro"] };
    for (const [where, sel] of [["top bar", '.char-tools [aria-label="Download Docx"]'], ["card footer", ".ccard-foot .dl-main"]] as const) {
      await s.step(`Download Docx (${where}) saves the sheet`, { ...base, steps: [...base.steps!, `Download Docx (${where})`] }, async () => {
        const t0 = Date.now();
        await page.click(sel);
        const file = await s.chrome.download(t0);
        if (!file.endsWith("E2E Varro.docx")) throw new Error(`file ${file}`);
        const text = s.readDownload(file, (b) => docxText(unzipEntry(b, "word/document.xml")));
        const ch = ops.view(c, await headRecord(page, id)).character;
        const missing = [ch.name, ...ch.items.map((x) => x.name), ...ch.talents.map((x) => x.name)].filter((n) => !text.includes(n));
        if (missing.length) throw new Error(`the .docx lacks ${missing.join(", ")}`);
      });
    }
    await s.step("Download PDF saves the sheet as a PDF", { ...base, steps: [...base.steps!, "Docx / PDF → PDF", "Download PDF"] }, async () => {
      await page.click(".char-tools .dl-arrow");
      await page.waitFor(() => !!document.querySelector(".dl-drop .dl-format"));
      await page.click(".dl-format-opt", 1);
      await idle(page);
      await page.key("Escape");
      await page.waitFor(() => document.querySelector(".char-tools .dl-main")?.getAttribute("aria-label") === "Download PDF", [], { what: "Download PDF" });
      const t0 = Date.now();
      await page.click(".char-tools .dl-main");
      const file = await s.chrome.download(t0);
      if (!file.endsWith("E2E Varro.pdf")) throw new Error(`file ${file}`);
      s.readDownload(file, (b) => {
        if (new TextDecoder().decode(b.slice(0, 5)) !== "%PDF-") throw new Error("not a PDF");
        return null;
      });
    });
    if (!existsSync(s.chrome.downloads)) r.note("no downloads directory");
  });
}
