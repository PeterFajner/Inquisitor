/// <reference lib="dom.iterable" />
// History, share links and warbands, each a shard.
import * as ops from "../../../src/client/builder/ops.ts";
import { warbandWarnings as clientWarnings } from "../../../src/client/warband/warnings.ts";
import { warbandWarnings } from "../../../src/shared/engine/warband.ts";
import type { Page } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium } from "../lib/rules.ts";
import { api, currentId, headRecord, idle, newCharacter, openBuilder, openList, Session } from "../lib/ui.ts";
import { docxText, unzipEntry } from "../lib/zip.ts";
import type { RunOptions } from "../shards.ts";
import { withSession } from "./f-builder.ts";

const characterJson = async (page: Page, id: string) => (await api(page, "GET", `/api/v1/characters/${id}`)).body.character as { name: string; head_id: string; versions: { id: string; parent_id: string | null; kind: string; source_id: string | null }[]; shares?: string[] };
const rename = async (page: Page, name: string) => {
  await page.eval(() => {
    const i = document.querySelector('input[aria-label="Rename"]') as HTMLInputElement;
    i.focus();
    i.select();
  });
  await page.type(name);
  await page.key("Enter");
  await idle(page);
};
const clickStats = async (page: Page) => {
  await page.eval(() => [...document.querySelectorAll(".csec-title")].find((x) => x.textContent?.startsWith("Stats"))!.querySelector("button")!.setAttribute("data-e2e", "reroll"));
  await page.click('[data-e2e="reroll"]');
  await idle(page);
};

export async function historyFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "enforcers", "fighter");
    await rename(page, "E2E Arbites");
    await clickStats(page);
    await page.clickLabel("Undo");
    await idle(page);
    await clickStats(page); // a branch
    const base: Repro = { archetype: "enforcers", subtype: "fighter", steps: ["New character Enforcer Fighter", "rename", "Stats Reroll", "Undo", "Stats Reroll"] };
    const ch = await characterJson(page, id);
    await s.step("History opens the version tree, a card per version", { ...base, steps: [...base.steps!, "History"] }, async () => {
      await page.clickLabel("History");
      await page.waitFor((x: string) => location.pathname === `/c/${x}/history` && document.querySelectorAll(".hv-card").length > 0, [id], { what: "the history page" });
      await idle(page);
      // The tree is on the pan-and-zoom canvas: fit it, so every card is in view.
      if (await page.eval(() => !!document.querySelector('[aria-label="Zoom to fit"]'))) await page.clickLabel("Zoom to fit");
      await page.waitFor((n: number) => document.querySelectorAll(".hv-card").length >= n, [ch.versions.length], { timeout: 4000 }).catch(() => {});
      const cards = await page.eval(() => document.querySelectorAll(".hv-card").length);
      if (cards !== ch.versions.length) throw new Error(`${cards} cards, ${ch.versions.length} versions`);
      const heads = await page.eval(() => document.querySelectorAll(".hv-card.is-head").length);
      if (heads !== 1) throw new Error(`${heads} cards marked current`);
    });
    await s.checkText("the history page", base, page, ["E2E Arbites"]);
    await s.step("Compare with the current version opens and closes", { ...base, steps: [...base.steps!, "History", "Compare (first card)", "Close"] }, async () => {
      await page.click('.hv-card:not(.is-head) [aria-label="Compare with the current version"]');
      await page.waitFor(() => !!document.querySelector(".hv-compare"));
      await s.checkText("the history compare panel", base, page, ["E2E Arbites"]);
      await page.click('.hv-compare [aria-label="Close"]');
      await page.waitFor(() => !document.querySelector(".hv-compare"));
    });
    await s.step("Make this the current version moves the head", { ...base, steps: [...base.steps!, "History", "Make this the current version"] }, async () => {
      const before = (await characterJson(page, id)).head_id;
      await page.click('.hv-card:not(.is-head) [aria-label="Make this the current version"]');
      await idle(page);
      const after = (await characterJson(page, id)).head_id;
      if (after === before) throw new Error("the head didn't move");
      const heads = await page.eval(() => document.querySelectorAll(".hv-card.is-head").length);
      if (heads !== 1) throw new Error(`${heads} cards marked current`);
    });
    let copy = "";
    await s.step("Duplicate from this version makes a character from it", { ...base, steps: [...base.steps!, "History", "Duplicate from this version"] }, async () => {
      const before = (await api(page, "GET", "/api/v1/characters")).body.characters.length;
      await page.click('.hv-card [aria-label="Duplicate from this version"]');
      await idle(page);
      const list = (await api(page, "GET", "/api/v1/characters")).body.characters as { id: string }[];
      if (list.length !== before + 1) throw new Error(`${list.length} characters, ${before + 1} expected`);
      copy = list.find((x) => x.id !== id)!.id;
    });
    await s.step("Open in the builder goes back to the character", { ...base, steps: [...base.steps!, "History", "Open in the builder"] }, async () => {
      await page.goto(`${s.app.url}/c/${id}/history`);
      await page.waitFor(() => document.querySelectorAll(".hv-card").length > 0);
      await page.click('.hv-card.is-head [aria-label="Open in the builder"]');
      await page.waitFor((x: string) => location.pathname === `/c/${x}` && !!document.querySelector(".char-view"), [id], { what: "the builder" });
    });
    if (copy) {
      await s.step("a duplicate's history links to its source", { ...base, steps: ["/c/<copy>/history", "Duplicated from"] }, async () => {
        await page.goto(`${s.app.url}/c/${copy}/history`);
        await page.waitFor(() => !!document.querySelector('[aria-label="Duplicated from"]'), [], { what: "the Duplicated from link" });
        await page.click('[aria-label="Duplicated from"]');
        await page.waitFor((x: string) => location.pathname.startsWith(`/c/${x}`), [id], { what: "the source character" });
      });
    }
  });
}

export async function shareFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    await s.chrome.send("Browser.grantPermissions", { origin: s.app.url, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "eldar-pirates", "pirate-prince");
    await rename(page, "E2E Corsair");
    const base: Repro = { archetype: "eldar-pirates", subtype: "pirate-prince", steps: ["New character Eldar Pirate Prince", "rename E2E Corsair"] };
    let token = "";
    await s.step("Share link makes a link and copies it", { ...base, steps: [...base.steps!, "Share link"] }, async () => {
      await page.clickLabel("Share link");
      await page.waitFor(() => !!document.querySelector('[aria-label="Copied"]') || !!document.querySelector("input.share-url"), [], { what: "Copied, or the link shown" });
      const shares = (await characterJson(page, id)).shares ?? [];
      if (shares.length !== 1) throw new Error(`${shares.length} share tokens`);
      token = shares[0];
      const clip = await page.eval(async () => {
        try {
          return await navigator.clipboard.readText();
        } catch {
          return (document.querySelector("input.share-url") as HTMLInputElement | null)?.value ?? "";
        }
      });
      if (!clip.endsWith(`/s/${token}`)) throw new Error(`copied "${clip}"`);
    });
    await s.step("Share link again gives the same link", { ...base, steps: [...base.steps!, "Share link ×2"] }, async () => {
      await page.waitFor(() => !!document.querySelector('[aria-label="Share link"]'), [], { timeout: 5000 });
      await page.clickLabel("Share link");
      await idle(page);
      const shares = (await characterJson(page, id)).shares ?? [];
      if (shares.length !== 1) throw new Error(`${shares.length} share tokens after sharing twice`);
    });
    if (!token) return;
    // Another browser, no session: the read-only view.
    const other = await s.newPage(undefined, { isolated: true });
    const ob: Repro = { ...base, steps: [...base.steps!, "Share link", `another browser opens /s/${token}`] };
    await s.step("the share page shows the character read-only", ob, async () => {
      await other.goto(`${s.app.url}/s/${token}`);
      await other.waitFor(() => !!document.querySelector(".shared .char-view, .shared .ccard, .shared-char"), [], { what: "the shared character" });
      await idle(other);
      const st = await other.eval(() => ({
        name: document.body.textContent!.includes("E2E Corsair"),
        inputs: document.querySelectorAll('.shared input[aria-label="Rename"], .shared .cstats-edit, .shared .line-x, .shared .sheet-add').length,
        rolls: !!document.querySelector('.shared [aria-label^="Re-roll"]'),
      }));
      if (!st.name) throw new Error("the name isn't shown");
      if (st.inputs || st.rolls) throw new Error(`edit controls on a share page: ${JSON.stringify(st)}`);
      const rec = await headRecord(page, id);
      const ch = ops.view(c, rec).character;
      const text = await other.eval(() => document.body.innerText);
      const missing = [...ch.items, ...ch.talents, ...ch.exotics].map((t) => t.name).filter((n) => !text.includes(n));
      if (missing.length) throw new Error(`not on the share page: ${missing.join(", ")}`);
    }, other);
    await s.checkText("the share page", ob, other, ["E2E Corsair"]);
    await s.step("Duplicate to my characters copies it into the other browser", { ...ob, steps: [...ob.steps!, "Duplicate to my characters"] }, async () => {
      await other.clickLabel("Duplicate to my characters");
      await other.waitFor(() => /^\/c\//.test(location.pathname) && !!document.querySelector(".char-view"), [], { what: "the copy in the builder" });
      const mine = (await api(other, "GET", "/api/v1/characters")).body.characters as { id: string; name: string }[];
      if (mine.length !== 1 || mine[0].name !== "E2E Corsair") throw new Error(`other browser has ${JSON.stringify(mine)}`);
      if (mine[0].id === id) throw new Error("not a copy");
    }, other);
    await s.step("the share link's print view (?print) shows the sheet", { ...ob, steps: [`/s/${token}?print`] }, async () => {
      await other.goto(`${s.app.url}/s/${token}?print`);
      await other.waitFor(() => !!document.querySelector(".print-page, .print-sheet"), [], { what: "the print view" });
      if (!(await other.eval(() => document.body.textContent!.includes("E2E Corsair")))) throw new Error("no name");
    }, other);
    await s.checkText("the share print view", ob, other, ["E2E Corsair"]);
    await s.step("a bad share link is the error page", { steps: ["/s/nope"] }, async () => {
      other.allow.push(/404/);
      await other.goto(`${s.app.url}/s/nope`);
      await idle(other);
    }, other);
    await s.checkText("the share error page", { steps: ["/s/nope"] }, other);
    await other.close();
  });
}

export async function warbandFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const ids = [await newCharacter(page, "inquisitor", "fighter"), await newCharacter(page, "inquisitor", "sage"), await newCharacter(page, "inquisitor-acolyte", "scout")];
    const base: Repro = { steps: ["New characters: Inquisitor Fighter, Inquisitor Sage, Acolyte Scout"] };
    let wb = "";
    await s.step("New warband makes one and shows it", { ...base, steps: [...base.steps!, "New warband"] }, async () => {
      await openList(page);
      await page.clickLabel("New warband");
      await page.waitFor(() => /^\/w\//.test(location.pathname) && !!document.querySelector(".wb"), [], { what: "the warband" });
      wb = /^\/w\/([^/]+)/.exec(new URL(await page.url()).pathname)![1];
    });
    await s.step("rename the warband", { ...base, steps: [...base.steps!, "New warband", "Rename → E2E Retinue"] }, async () => {
      await page.click(".wb-name-btn");
      await page.waitFor(() => !!document.querySelector("input.wb-name-input"));
      await page.type("E2E Retinue");
      await page.key("Enter");
      await idle(page);
      const w = (await api(page, "GET", "/api/v1/warbands")).body.warbands as { id: string; name: string }[];
      if (w.find((x) => x.id === wb)?.name !== "E2E Retinue") throw new Error(JSON.stringify(w));
    });
    await s.step("Add a character: tick several, save", { ...base, steps: [...base.steps!, "Add a character", "tick all", "Save"] }, async () => {
      await page.clickLabel("Add a character");
      await page.waitFor(() => !!document.querySelector("dialog.bpick[open]"));
      const n = await page.eval(() => document.querySelectorAll("dialog.bpick .bpick-opt").length);
      for (let i = 0; i < n; i++) await page.click("dialog.bpick .bpick-opt", i);
      await page.click('dialog.bpick [aria-label="Save"]');
      await idle(page);
      const members = await page.eval(() => document.querySelectorAll(".wb-member").length);
      if (members !== 3) throw new Error(`${members} members`);
      const sheets = await page.eval(() => document.querySelectorAll(".wb-sheet").length);
      if (sheets !== 3) throw new Error(`${sheets} sheets`);
    });
    await s.step("the warband rules warn (two Inquisitors)", base, async () => {
      const recs = await Promise.all(ids.map((x) => headRecord(page, x)));
      const engine = warbandWarnings(c, recs.map((rec) => ({ archetype: rec.archetype })));
      if (!engine.some((w) => w.archetype.includes("inquisitor"))) throw new Error(`the engine has no warning for two Inquisitors: ${JSON.stringify(engine)}`);
      const want = clientWarnings(c, recs.map((rec, i) => ({ id: ids[i], character: ops.view(c, rec).character })));
      const shown = await page.eval(() => document.querySelectorAll(".wb-warning").length);
      if (shown !== want.length) throw new Error(`${shown} warnings shown, ${want.length} expected: ${JSON.stringify(want).slice(0, 300)}`);
    });
    await s.checkText("the warband", base, page, ["E2E Retinue"]);
    await s.step("move a member down, then up", { ...base, steps: [...base.steps!, "Move down (first)", "Move up (second)"] }, async () => {
      const order = async () => ((await api(page, "GET", "/api/v1/warbands")).body.warbands as { id: string; character_ids: string[] }[]).find((x) => x.id === wb)!.character_ids;
      const o0 = await order();
      await page.click('.wb-member [aria-label^="Move down: "]', 0);
      await idle(page);
      const o1 = await order();
      if (o1[0] !== o0[1] || o1[1] !== o0[0]) throw new Error(`${o0} → ${o1}`);
      await page.click('.wb-member [aria-label^="Move up: "]', 1);
      await idle(page);
      if ((await order()).join() !== o0.join()) throw new Error("not back in order");
    });
    await s.step("Word export of the warband", { ...base, steps: [...base.steps!, "Download Docx"] }, async () => {
      const t0 = Date.now();
      await page.click('.wb-tools [aria-label="Download Docx"]');
      const file = await s.chrome.download(t0);
      if (!file.endsWith("E2E Retinue.docx")) throw new Error(`file "${file}"`);
      const text = s.readDownload(file, (b) => docxText(unzipEntry(b, "word/document.xml")));
      if ((text.match(/Inquisitor, /g) ?? []).length < 2) throw new Error("the members aren't all in the .docx");
    });
    await s.step("Remove from the warband", { ...base, steps: [...base.steps!, "Remove from the warband (last)"] }, async () => {
      await page.click('.wb-member [aria-label^="Remove from the warband: "]', 2);
      await idle(page);
      if ((await page.eval(() => document.querySelectorAll(".wb-member").length)) !== 2) throw new Error("not removed");
      // The character itself stays.
      if ((await api(page, "GET", `/api/v1/characters/${ids[2]}`)).status !== 200) throw new Error("the character was deleted");
    });
    await s.step("a member opens in the builder", { ...base, steps: [...base.steps!, "open a member"] }, async () => {
      await page.click(".wb-member-open", 0);
      await page.waitFor(() => /^\/c\//.test(location.pathname) && !!document.querySelector(".char-view"), [], { what: "the member" });
    });
    await s.step("Duplicate the warband copies it and its characters", { ...base, steps: [...base.steps!, `/w/${wb}`, "Duplicate"] }, async () => {
      await page.goto(`${s.app.url}/w/${wb}`);
      await page.waitFor(() => !!document.querySelector(".wb"));
      await idle(page);
      const before = (await api(page, "GET", "/api/v1/characters")).body.characters.length;
      await page.click('.wb-tools [aria-label="Duplicate"]');
      await idle(page);
      const bands = (await api(page, "GET", "/api/v1/warbands")).body.warbands as unknown[];
      const after = (await api(page, "GET", "/api/v1/characters")).body.characters.length;
      if (bands.length !== 2) throw new Error(`${bands.length} warbands`);
      if (after !== before + 2) throw new Error(`characters ${before} → ${after} (members are copied)`);
    });
    await s.step("Share link for the warband, opened in another browser", { ...base, steps: [...base.steps!, "Share link", "open it elsewhere"] }, async () => {
      const cur = /^\/w\/([^/]+)/.exec(new URL(await page.url()).pathname)![1];
      await page.click('.wb-tools [aria-label="Share link"]');
      await idle(page);
      const w = ((await api(page, "GET", "/api/v1/warbands")).body.warbands as { id: string; shares?: string[] }[]).find((x) => x.id === cur)!;
      const token = w.shares?.[0];
      if (!token) throw new Error("no share token");
      const other = await s.newPage(undefined, { isolated: true });
      try {
        await other.goto(`${s.app.url}/s/${token}`);
        await other.waitFor(() => document.querySelectorAll(".wb-sheet, .sheet").length >= 2, [], { what: "the shared warband's sheets" });
        await s.checkText("the shared warband", base, other, ["E2E Retinue"]);
      } finally {
        await other.close();
      }
    });
    await s.step("Delete the warband asks with confirm(); Cancel keeps it", { ...base, steps: [...base.steps!, "Delete", "Cancel"] }, async () => {
      page.dialogAnswer = false;
      await page.click('.wb-tools [aria-label="Delete"]');
      await idle(page);
      const d = page.dialogs[page.dialogs.length - 1];
      if (!d || d.type !== "confirm") throw new Error("no confirm()");
      if (!/^Delete .+\?$/.test(d.message)) throw new Error(`confirm() says ${JSON.stringify(d.message)}`);
      const bands = (await api(page, "GET", "/api/v1/warbands")).body.warbands.length;
      if (bands !== 2) throw new Error(`${bands} warbands though cancelled`);
    });
    await s.checkText("the warband's Delete confirm()", base);
    await s.step("Delete the warband, OK: its characters stay", { ...base, steps: [...base.steps!, "Delete", "OK"] }, async () => {
      const chars = (await api(page, "GET", "/api/v1/characters")).body.characters.length;
      page.dialogAnswer = true;
      await page.click('.wb-tools [aria-label="Delete"]');
      await idle(page);
      const bands = (await api(page, "GET", "/api/v1/warbands")).body.warbands.length;
      if (bands !== 1) throw new Error(`${bands} warbands`);
      if ((await api(page, "GET", "/api/v1/characters")).body.characters.length !== chars) throw new Error("characters went with it");
      if (/^\/w\//.test(new URL(await page.url()).pathname)) throw new Error("still on the deleted warband");
    });
    void currentId;
  });
}
