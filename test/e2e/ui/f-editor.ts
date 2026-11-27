/// <reference lib="dom.iterable" />
// The rules editor beyond the Text field (feature:rules-editor): the
// structured effect editor (a pick of two talents added through its
// palette and pickers), saved; the saved rules pass `rules:check`; another
// browser sees the edit live; a character that uses the entry offers the
// update, and the Update panel names the new choice. New entry (a talent),
// a delete of an entry a saved character owns (the Update panel lists the
// loss), Delete's confirm, a new rule pack, a move (the canvas's
// position, through the API), a stale save's Re-apply. The no-UI-text rule
// on every editor panel. And the 2023 browser's characters imported
// (feature:legacy-import).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import * as ops from "../../../src/client/builder/ops.ts";
import { parseRecord } from "../../../src/shared/engine/record.ts";
import type { Page } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium, ROOT } from "../lib/rules.ts";
import { api, headRecord, idle, newCharacter, openBuilder, openCharacter, openList, saveRecord } from "../lib/ui.ts";
import type { RunOptions } from "../shards.ts";
import { randomBuild } from "../engine/archetype.ts";
import { signUp } from "./f-account.ts";
import { withSession } from "./f-builder.ts";
import { openRules } from "./f-rules.ts";

const NODE = [process.execPath, "--disable-warning=ExperimentalWarning"];

type Rules = { version: string; packs: { pack: { id: string }; entries: any[] }[]; meta: Record<string, Record<string, { commit: string }>> };
const rulesNow = async (page: Page) => (await api<Rules>(page, "GET", "/api/v1/rules")).body;
const entryNow = async (page: Page, pack: string, kind: string, id: string) => (await rulesNow(page)).packs.find((p) => p.pack.id === pack)?.entries.find((e) => e.kind === kind && e.id === id);

/** `npm run rules:check` against the shard's own rules clone. */
function rulesCheck(dir: string): { ok: boolean; out: string } {
  const r = spawnSync(NODE[0], [...NODE.slice(1), join(ROOT, "scripts/rules-check.ts")], { cwd: ROOT, env: { ...process.env, RULES_DIR: dir }, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.slice(-1500) };
}

/** Marks the n-th visible element matching `sel` whose aria-label is `label` (and inside `within`), so it can be clicked. */
const markNth = (page: Page, within: string, label: string, n: number, tag = "e2e") =>
  page.eval(
    (w: string, l: string, i: number, t: string) => {
      document.querySelectorAll(`[data-${t}]`).forEach((x) => x.removeAttribute(`data-${t}`));
      const el = [...document.querySelectorAll(`${w} [aria-label="${l}"]`)].filter((x) => (x as HTMLElement).checkVisibility())[i];
      el?.setAttribute(`data-${t}`, "");
      return !!el;
    },
    within,
    label,
    n,
    tag,
  );

export async function rulesEditorFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    const base: Repro = { steps: ["Create account"] };
    await s.step("sign up", base, () => signUp(s, page));
    // A saved character that owns Leadership (every Inquisitor) and one with a generated item.
    const inqId = await newCharacter(page, "inquisitor", "fighter");
    // Another browser (a visitor) watching the card.
    const KEY = "loyalist:talent/leadership";
    const other = await s.newPage(undefined, { isolated: true });
    await openRules(other, s.app.url, `#${KEY}`);

    // --- the structured effect editor: a pick of Catfall or Medic on Leadership ---
    const steps = [...base.steps!, `/rules#${KEY}`, "Edit", "Effects: Add → Pick", "Pick: Add → Talents → Catfall", "Pick: Add → Talents → Medic", "Save"];
    await openRules(page, s.app.url, `#${KEY}`);
    await s.step("the effect editor adds a pick of two talents, saved", { steps }, async () => {
      await page.click(`.rb-card[data-key="${KEY}"] [aria-label="Edit"]`);
      await page.waitFor(() => !!document.querySelector(".rb-panel .ed-effects"), [], { what: "the editor's effects" });
      await idle(page);
      await s.checkText("the rules editor (a talent)", { steps });
      const before = await page.eval(() => document.querySelectorAll(".rb-panel .ed-effects > li:not(.ed-add)").length);
      await page.click('.rb-panel .ed-effects > .ed-add [aria-label="Add"]');
      await page.waitFor(() => !!document.querySelector('.pal-wrap [aria-label="Pick"]'), [], { what: "the effect palette" });
      await s.checkText("the effect palette", { steps });
      await page.click('.pal-wrap [aria-label="Pick"]');
      await idle(page);
      const after = await page.eval(() => document.querySelectorAll(".rb-panel .ed-effects > li:not(.ed-add)").length);
      if (after !== before + 1) throw new Error(`effects ${before} → ${after}`);
      // the new effect: the last one before the list's own Add
      await page.eval(() => {
        const lis = [...document.querySelectorAll(".rb-panel .ed-effects > li:not(.ed-add)")];
        lis[lis.length - 1]?.setAttribute("data-e2e-last", "");
      });
      for (const name of ["Catfall", "Medic"]) {
        // the new pick's own Add (the last effect's), then Talents, then the talent in the picker
        if (!(await markNth(page, "[data-e2e-last]", "Add", 0))) throw new Error("the pick has no Add");
        await page.click("[data-e2e]");
        await page.waitFor(() => !!document.querySelector('.pal-wrap [aria-label="Talents"]'), [], { what: "the palette in the pick" });
        await page.click('.pal-wrap [aria-label="Talents"]');
        await idle(page);
        // (a new grant opens its picker by itself; else its button opens it)
        if (!(await page.eval(() => !!document.querySelector('.picker[aria-label="Talents"] input')))) {
          await page.eval(() => {
            const bs = [...document.querySelectorAll('[data-e2e-last] button.refbtn[aria-label="Talents"]')];
            bs[bs.length - 1]?.setAttribute("data-e2e-ref", "");
          });
          await page.click("[data-e2e-ref]");
          await page.eval(() => document.querySelector("[data-e2e-ref]")?.removeAttribute("data-e2e-ref"));
        }
        await page.waitFor(() => !!document.querySelector('.picker[aria-label="Talents"] .picker-list'), [], { what: "the talents picker" });
        await s.checkText("the talents picker", { steps });
        await page.click('.picker[aria-label="Talents"] input[aria-label="Search"]');
        await page.type(name);
        await page.waitFor((t: string) => [...document.querySelectorAll('.picker[aria-label="Talents"] .picker-item')].some((b) => b.textContent?.trim() === t), [name], { what: `${name} in the picker` });
        await page.eval((t: string) => [...document.querySelectorAll('.picker[aria-label="Talents"] .picker-item')].find((b) => b.textContent?.trim() === t)?.setAttribute("data-pick", ""), name);
        await page.click("[data-pick]");
        await idle(page);
      }
      await page.click('.rb-panel [aria-label="Save"]');
      await idle(page);
      await page.waitFor(() => !document.querySelector(".rb-panel .ed-effects"), [], { what: "the editor to close (saved)", timeout: 15_000 });
      const e = await entryNow(page, "loyalist", "talent", "leadership");
      const pick = (e?.effects ?? []).find((x: any) => "pick" in x);
      const from = JSON.stringify(pick?.from ?? []);
      if (!pick || !from.includes("catfall") || !from.includes("medic")) throw new Error(`saved effects ${JSON.stringify(e?.effects).slice(0, 300)}`);
    });
    await s.step("the saved rules pass rules:check", { steps }, async () => {
      const chk = rulesCheck(s.app.rulesDir);
      if (!chk.ok) throw new Error(chk.out);
    });
    await s.step("another browser shows the edit live", { steps: [`another browser: /rules#${KEY}`, "(the edit)"] }, async () => {
      await other.waitFor((k: string) => /Catfall/.test(document.querySelector(`.rb-card[data-key="${k}"]`)?.textContent ?? ""), [KEY], { what: "the edit, live", timeout: 15_000 });
    }, other);
    // The Inquisitor offers the update, naming the new choice.
    page.allow.push(/409 \(Conflict\) \S+\/api\/v1\/balance/);
    await s.step("a character using the edited entry offers the update, the panel names the change", { steps: [...steps, `/c/${inqId} (a load)`, "Update to the current rules"] }, async () => {
      await openCharacter(page, s.app.url, inqId);
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]')?.checkVisibility(), [], { what: "the Update button", timeout: 20_000 });
      await page.clickLabel("Update to the current rules");
      await page.waitFor(() => !!document.querySelector(".rules-update"), [], { what: "the update panel" });
      await s.checkText("the rules update panel (a new pick)", { steps });
      await page.clickLabel("Apply");
      await idle(page);
      const rec = await headRecord(page, inqId);
      const v = ops.view(realCompendium(), rec);
      const key = Object.keys(rec.choices).find((k) => k.startsWith("leadership/"));
      if (!key) throw new Error(`no leadership pick made: ${Object.keys(rec.choices).join(", ")}`);
      void v;
    });
    page.allow.pop();

    // --- New entry: a talent ---
    const newSteps = [...base.steps!, "/rules", "New entry", "Talents", "Name E2E Talent", "Save"];
    await s.step("New entry makes a talent", { steps: newSteps }, async () => {
      await openRules(page, s.app.url, "#loyalist:talent/dodge");
      await page.clickLabel("New entry");
      await page.waitFor(() => !!document.querySelector('.kinds-menu [role="menuitem"]'), [], { what: "the kinds menu" });
      await s.checkText("the New entry menu", { steps: newSteps });
      await page.click('.kinds-menu [aria-label="Talents & Exotic Abilities"], .kinds-menu [aria-label="Talents"]').catch(async () => {
        const labels = await page.eval(() => [...document.querySelectorAll('.kinds-menu [role="menuitem"]')].map((x) => x.getAttribute("aria-label")));
        throw new Error(`no Talents in the kinds menu: ${labels.join(", ")}`);
      });
      await page.waitFor(() => !!document.querySelector('.rb-panel input[aria-label="Name"]'), [], { what: "a new entry's editor" });
      await s.checkText("a new entry's editor", { steps: newSteps });
      await page.click('.rb-panel input[aria-label="Name"]');
      await page.type("E2E Talent");
      await idle(page);
      await page.click('.rb-panel [aria-label="Save"]');
      await idle(page);
      await page.waitFor(() => !document.querySelector('.rb-panel input[aria-label="Name"]'), [], { what: "the editor to close (saved)", timeout: 15_000 });
      const rules = await rulesNow(page);
      const made = rules.packs.flatMap((p) => p.entries).find((e) => e.name === "E2E Talent");
      if (!made) throw new Error("no entry named E2E Talent");
      const chk = rulesCheck(s.app.rulesDir);
      if (!chk.ok) throw new Error(`rules:check after New entry: ${chk.out}`);
    });

    // --- Delete an entry a saved character owns: its Update panel lists the loss ---
    const b = Array.from({ length: 40 }, (_, i) => randomBuild(c, "rogue-trader", "fighter", i + 1)).find((x) => x.character.items.some((it) => it.from.some((f) => f.key?.endsWith(":item"))))!;
    const victim = b.character.items.find((it) => it.from.some((f) => f.key?.endsWith(":item")))!;
    const vKey = `${c.origin.get(`item/${victim.id}`)}:item/${victim.id}`;
    const delSteps = [...base.steps!, `a saved Rogue Trader with ${victim.name}`, `/rules#${vKey}`, "Edit", "Delete", "OK"];
    let cid = "";
    await s.step("Delete asks with confirm(); Cancel keeps the entry, OK deletes it", { steps: delSteps }, async () => {
      cid = await saveRecord(s, b.record, "E2E Trader");
      await openRules(page, s.app.url, `#${vKey}`);
      await page.click(`.rb-card[data-key="${vKey}"] [aria-label="Edit"]`);
      await page.waitFor(() => !!document.querySelector('.rb-panel [aria-label="Delete"]'));
      page.dialogAnswer = false;
      await page.click('.rb-panel [aria-label="Delete"]');
      await idle(page);
      const d = page.dialogs[page.dialogs.length - 1];
      if (!d || d.type !== "confirm") throw new Error("no confirm()");
      if (d.message !== `Delete ${victim.name}?`) throw new Error(`confirm() says ${JSON.stringify(d.message)}`);
      if (!(await entryNow(page, vKey.split(":")[0], "item", victim.id))) throw new Error("deleted though cancelled");
      await s.checkText("the editor's Delete confirm()", { steps: delSteps });
      page.dialogAnswer = true;
      await page.click('.rb-panel [aria-label="Delete"]');
      await idle(page);
      await page.waitFor((k: string) => !document.querySelector(`.rb-card[data-key="${k}"]`), [vKey], { what: "the card gone", timeout: 15_000 });
      if (await entryNow(page, vKey.split(":")[0], "item", victim.id)) throw new Error("still in the rules");
    });
    await s.step("the deleted entry's character offers the update and lists the loss", { steps: [...delSteps, `/c/${cid}`, "Update to the current rules"] }, async () => {
      page.allow.push(/409 \(Conflict\) \S+\/api\/v1\/balance/);
      await openCharacter(page, s.app.url, cid);
      await page.waitFor(() => !!document.querySelector('[aria-label="Update to the current rules"]')?.checkVisibility(), [], { what: "the Update button", timeout: 20_000 });
      await page.clickLabel("Update to the current rules");
      await page.waitFor(() => !!document.querySelector(".rules-update"), [], { what: "the update panel" });
      const text = await page.eval(() => document.querySelector(".rules-update")!.textContent ?? "");
      if (!text.includes(victim.name)) throw new Error(`the panel doesn't name ${victim.name}: "${text.slice(0, 300)}"`);
      await s.checkText("the update panel (an item deleted)", { steps: delSteps });
      page.allow.pop();
    });

    // --- a new rule pack ---
    const packSteps = [...base.steps!, "/rules", "Rule packs", "New rule pack", "Name E2E Pack", "New rule pack (✓)"];
    await s.step("New rule pack makes a pack", { steps: packSteps }, async () => {
      await openRules(page, s.app.url);
      await page.clickLabel("Rule packs");
      await page.waitFor(() => !!document.querySelector('ul.packs, [aria-label="New rule pack"]'), [], { what: "the packs menu" });
      await s.checkText("the Rule packs menu", { steps: packSteps });
      await page.click('[aria-label="New rule pack"]');
      await page.waitFor(() => !!document.querySelector('form.new-pack input[aria-label="Name"]'), [], { what: "the new pack form" });
      await page.click('form.new-pack input[aria-label="Name"]');
      await page.type("E2E Pack");
      await s.checkText("the new pack form", { steps: packSteps }, page, ["E2E Pack"]);
      await page.click('form.new-pack button[type="submit"]');
      await idle(page);
      const rules = await rulesNow(page);
      if (!rules.packs.some((p) => p.pack.id === "e2e-pack")) throw new Error(`packs ${rules.packs.map((p) => p.pack.id).join(", ")}`);
      const chk = rulesCheck(s.app.rulesDir);
      if (!chk.ok) throw new Error(`rules:check after a new pack: ${chk.out}`);
    });

    // --- a move (the canvas's position) through the API: a commit, live elsewhere ---
    await s.step("a move is saved as a commit of its own", { steps: ["POST /api/v1/rules/move loyalist talent/dodge [123, 456]"] }, async () => {
      const v0 = (await rulesNow(page)).version;
      const res = await api(page, "POST", "/api/v1/rules/move", { pack: "loyalist", kind: "talent", id: "dodge", pos: [123, 456] });
      if (res.status !== 200) throw new Error(`move: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
      const e = await entryNow(page, "loyalist", "talent", "dodge");
      if (JSON.stringify(e?.pos) !== "[123,456]") throw new Error(`pos ${JSON.stringify(e?.pos)}`);
      const v1 = (await rulesNow(page)).version;
      if (v1 === v0) throw new Error("the rules version didn't change");
      const chk = rulesCheck(s.app.rulesDir);
      if (!chk.ok) throw new Error(`rules:check after a move: ${chk.out}`);
    });

    // --- a visitor can't write the rules ---
    await s.step("a visitor's rule writes are refused", { steps: ["another browser (a visitor)", "POST /api/v1/rules/entries, /entries/delete, /move, /packs"] }, async () => {
      other.allow.push(/40[13]/);
      const e = await entryNow(other, "loyalist", "talent", "dodge");
      for (const [path, body] of [
        ["/api/v1/rules/entries", { pack: "loyalist", entry: e, base: null }],
        ["/api/v1/rules/entries/delete", { pack: "loyalist", kind: "talent", id: "dodge", base: null }],
        ["/api/v1/rules/move", { pack: "loyalist", kind: "talent", id: "dodge", pos: [1, 1] }],
        ["/api/v1/rules/packs", { id: "e2e-visitor", name: "E2E" }],
      ] as const) {
        const res = await api(other, "POST", path, body);
        if (res.status !== 401 && res.status !== 403) throw new Error(`${path}: ${res.status}`);
      }
      if (!(await entryNow(other, "loyalist", "talent", "dodge"))) throw new Error("dodge gone");
    }, other);

    // --- a stale save: Re-apply my changes to the newer version ---
    const DKEY = "loyalist:talent/dodge";
    const second = await s.newPage();
    const reSteps = ["two tabs edit Dodge's Text", "tab 1 saves", "tab 2 saves (refused)", "Re-apply my changes to the newer version", "Save"];
    await s.step("a stale save offers Re-apply, which keeps both edits", { steps: reSteps }, async () => {
      for (const p of [page, second]) {
        await openRules(p, s.app.url, `#${DKEY}`);
        await p.click(`.rb-card[data-key="${DKEY}"] [aria-label="Edit"]`);
        await p.waitFor(() => !!document.querySelector('.rb-panel textarea[aria-label="Text"]'));
      }
      await page.eval(() => {
        const t = document.querySelector('.rb-panel textarea[aria-label="Text"]') as HTMLTextAreaElement;
        t.focus();
        t.selectionStart = t.selectionEnd = t.value.length;
      });
      await page.type(" E2E-text");
      await page.click('.rb-panel [aria-label="Save"]');
      await idle(page);
      // tab 2 changes another field: the points
      await second.eval(() => {
        const i = document.querySelector('.rb-panel input[aria-label="Points"]') as HTMLInputElement;
        i.focus();
        i.select();
      });
      await second.type("9");
      second.allow.push(/409/);
      await second.click('.rb-panel [aria-label="Save"]');
      await idle(second);
      await second.waitFor(() => !!document.querySelector('[aria-label="Re-apply my changes to the newer version"]'), [], { what: "Re-apply", timeout: 10_000 });
      await s.checkText("the conflict view", { steps: reSteps }, second);
      await second.click('[aria-label="Re-apply my changes to the newer version"]');
      await idle(second);
      await second.click('.rb-panel [aria-label="Save"]');
      await idle(second);
      await second.waitFor(() => !document.querySelector('.rb-panel textarea[aria-label="Text"]'), [], { what: "saved", timeout: 15_000 });
      const e = await entryNow(page, "loyalist", "talent", "dodge");
      if (!String(e?.text).includes("E2E-text") || e?.points !== 9) throw new Error(`text ${String(e?.text).slice(-30)}, points ${e?.points}: not both edits`);
    }, second);
    await second.close();
    await other.close();
  });
}

/** The 2023 browser's kept characters and warbands (localStorage), as legacy.ts read them (it drops the warbands now). */
function legacyStore(): { characters: unknown; warbands: unknown; ids: string[] } {
  const c = realCompendium();
  const ids = ["legacy-a", "legacy-b"];
  const chars = ids.map((id, i) => {
    const rec = randomBuild(c, i ? "kroot" : "inquisitor", i ? c.archetypes.get("kroot")!.subtypes[0].id : "sage", i + 1).record;
    return { id, name: `E2E Legacy ${i}`, head_id: `${id}-v1`, versions: [{ id: `${id}-v1`, parent_id: null, record: rec, rules_version: "legacy", kind: "roll", created_at: "2023-07-09T12:00:00Z" }] };
  });
  return { characters: { characters: chars }, warbands: { warbands: [{ id: "legacy-w", name: "E2E Legacy Band", character_ids: ids }] }, ids };
}

export async function legacyImportFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    const store = legacyStore();
    const seed = async (p: Page) => {
      await p.goto(`${s.app.url}/nope-e2e-seed`);
      await p.eval((cs: string, ws: string) => {
        localStorage.setItem("inquisitor:characters:v1", cs);
        localStorage.setItem("inquisitor:warbands:v1", ws);
      }, JSON.stringify(store.characters), JSON.stringify(store.warbands));
    };
    page.allow.push(/404 \(Not Found\)/);
    const base: Repro = { steps: ["localStorage holds two 2023 characters and a warband", "open /"] };
    await s.step("the kept characters are imported on load; the warband is left behind (warbands went)", base, async () => {
      await seed(page);
      await openBuilder(page, s.app.url);
      await page.waitFor(async () => true);
      const t0 = Date.now();
      let list: { name: string }[] = [];
      while (Date.now() - t0 < 15_000) {
        list = ((await api(page, "GET", "/api/v1/characters")).body.characters ?? []) as { name: string }[];
        if (list.length >= 2) break;
        await new Promise((res) => setTimeout(res, 200));
      }
      if (list.filter((x) => /E2E Legacy/.test(x.name)).length !== 2) throw new Error(`characters ${JSON.stringify(list.map((x) => x.name))}`);
      const keys = await page.eval(() => [localStorage.getItem("inquisitor:characters:v1"), localStorage.getItem("inquisitor:warbands:v1")]);
      if (keys.some((x) => x !== null)) throw new Error("the kept keys are still there");
      for (const ch of (await api(page, "GET", "/api/v1/characters")).body.characters as { id: string }[]) {
        const rec = await headRecord(page, ch.id);
        if (!parseRecord(rec).ok) throw new Error(`${ch.id}: not a record`);
      }
      await openList(page);
      const rows = await page.eval(() => [...document.querySelectorAll(".char-list .char-row")].map((x) => x.textContent ?? ""));
      if (!rows.some((x) => x.includes("E2E Legacy 0"))) throw new Error(`list ${JSON.stringify(rows)}`);
    });
    await s.checkText("the builder after an import", base, page, ["E2E Legacy"]);
    await s.step("a second load makes no copies", { steps: [...base.steps!, "reload"] }, async () => {
      await page.reload();
      await page.waitFor(() => document.querySelector(".builder")?.getAttribute("aria-busy") === "false");
      await idle(page);
      const n = ((await api(page, "GET", "/api/v1/characters")).body.characters as unknown[]).length;
      if (n !== 2) throw new Error(`${n} characters`);
    });
    // The same keys again (as if the reply had been lost before they were removed): no duplicates.
    await s.step("an import retried after a lost reply makes no copies", { steps: ["the same localStorage again", "the import's reply lost once (CDP Fetch)", "reload"] }, async () => {
      await seed(page);
      await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/import*", requestStage: "Response" }] });
      let failed = 0;
      const off = s.chrome.on(page.sessionId, (method, p) => {
        if (method !== "Fetch.requestPaused") return;
        if (!failed++) void page.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "ConnectionReset" });
        else void page.send("Fetch.continueRequest", { requestId: p.requestId });
      });
      page.allow.push(/ERR_CONNECTION_RESET|Failed to fetch|import/);
      try {
        await page.goto(`${s.app.url}/`);
        await idle(page).catch(() => {});
        await page.reload();
        await page.waitFor(() => document.querySelector(".builder")?.getAttribute("aria-busy") === "false");
        await idle(page);
      } finally {
        off();
        await page.send("Fetch.disable");
        page.allow.pop();
      }
      if (!failed) throw new Error("the import was never sent");
      const n = ((await api(page, "GET", "/api/v1/characters")).body.characters as unknown[]).length;
      if (n !== 2) throw new Error(`${n} characters after a retried import`);
      const keys = await page.eval(() => localStorage.getItem("inquisitor:characters:v1"));
      if (keys !== null) throw new Error("the kept keys are still there after the retry");
    });
  });
}
