/// <reference lib="dom.iterable" />
// History, share links and the Download button, each a shard.
import * as ops from "../../../src/client/builder/ops.ts";
import type { Page } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium } from "../lib/rules.ts";
import { api, currentId, headRecord, idle, newCharacter, openBuilder, openCharacter, openList, Session } from "../lib/ui.ts";
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
    await s.step("the share page's Preview tab shows the sheet, read-only", { ...ob, steps: [...ob.steps!, "Preview"] }, async () => {
      await other.click('.view-tab[data-tab="preview"]');
      await other.waitFor(() => !!document.querySelector(".shared .char-sheet .sheet") && !document.querySelector(".shared .ccard"), [], { what: "the sheet" });
      const edits = await other.eval(() => document.querySelectorAll(".shared .sheet-edit, .shared .sheet-add, .shared .line-x, .shared .cell-btn").length);
      if (edits) throw new Error(`${edits} edit controls on the shared sheet`);
      await other.click('.view-tab[data-tab="edit"]');
      await other.waitFor(() => !!document.querySelector(".shared .ccard"));
    }, other);
    await s.checkText("the share page's Preview", ob, other, ["E2E Corsair"]);
    await s.step("the share page's Download arrow has the Docx / PDF toggle and no list", { ...ob, steps: [...ob.steps!, "Docx / PDF"] }, async () => {
      await other.click('.shared .dl-arrow[aria-label="Docx / PDF"]');
      await other.waitFor(() => !!document.querySelector(".dl-drop .dl-format"));
      if (await other.eval(() => !!document.querySelector(".dl-drop .dl-list, .dl-drop .dl-search"))) throw new Error("a character list on a share page");
      await other.key("Escape");
      const t0 = Date.now();
      await other.click(".shared .dl-main");
      const file = await s.chrome.download(t0);
      if (!file.endsWith("E2E Corsair.docx")) throw new Error(`file ${file}`);
    }, other);
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

// The Download button (owner, November 2026): its arrow's dropdown picks the
// format (Docx / PDF) and other characters to download with this one
// ("Include other characters", searched); the caption follows; both are kept
// with the account, per character for the picks.
export async function downloadFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const made: { id: string; name: string }[] = [];
    for (const [a, sub, name] of [["inquisitor", "fighter", "E2E Gregor"], ["imperial-guard", "fighter", "E2E Varro"], ["enforcers", "fighter", "E2E Ruth"], ["kroot", null, "E2E Kroot"]] as const) {
      const id = await newCharacter(page, a, sub ?? realCompendium().archetypes.get(a)!.subtypes[0].id);
      await rename(page, name);
      made.push({ id, name });
    }
    // The last made is shown: E2E Kroot.
    const self = made[3];
    const base: Repro = { steps: ["four characters: E2E Gregor, E2E Varro, E2E Ruth, E2E Kroot (shown)"] };
    const captions = () => page.eval(() => [...document.querySelectorAll(".dl-main")].map((b) => b.getAttribute("aria-label") ?? b.textContent ?? ""));
    const wantCaption = async (want: string) => {
      await page.waitFor((w: string) => [...document.querySelectorAll(".dl-main")].every((b) => (b.getAttribute("aria-label") ?? b.textContent) === w), [want], { what: `both buttons saying ${want}`, timeout: 5000 }).catch(async () => {
        throw new Error(`the buttons say ${JSON.stringify(await captions())}, not ${want}`);
      });
    };
    const settingsNow = async () => (await api(page, "GET", "/api/v1/settings")).body.settings as { format: string; with: Record<string, string[]> };
    const open = async (where: "bar" | "foot" = "bar") => {
      if (await page.eval(() => !!document.querySelector(".dl-drop"))) return;
      await page.click(where === "bar" ? ".char-tools .dl-arrow" : ".ccard-foot .dl-arrow");
      await page.waitFor(() => !!document.querySelector(".dl-drop")?.checkVisibility(), [], { what: "the dropdown" });
    };
    const rowNames = () => page.eval(() => [...document.querySelectorAll(".dl-drop .dl-row-name")].map((x) => x.textContent ?? ""));
    const pick = async (name: string) => {
      await page.eval((n: string) => {
        const row = [...document.querySelectorAll(".dl-drop .dl-row")].find((x) => x.querySelector(".dl-row-name")?.textContent === n)!;
        row.querySelector("input")!.setAttribute("data-e2e", "pick");
      }, name);
      await page.click('[data-e2e="pick"]');
      await page.eval(() => document.querySelector('[data-e2e="pick"]')?.removeAttribute("data-e2e"));
      await idle(page);
    };

    await s.step("Download Docx by default; the arrow opens the dropdown with the toggle and the other characters", { ...base, steps: [...base.steps!, "Include other characters"] }, async () => {
      await wantCaption("Download Docx");
      await open();
      const st = await page.eval(() => ({
        title: document.querySelector(".dl-drop .dl-title")?.textContent,
        pressed: [...document.querySelectorAll(".dl-format-opt")].map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`),
        expanded: document.querySelector(".char-tools .dl-arrow")?.getAttribute("aria-expanded"),
      }));
      if (st.title !== "Include other characters") throw new Error(`title ${st.title}`);
      if (st.pressed.join() !== "Docx:true,PDF:false") throw new Error(`toggle ${st.pressed}`);
      if (st.expanded !== "true") throw new Error("the arrow isn't marked expanded");
      const rows = await rowNames();
      // The others, as the list orders them (newest first), never the character itself.
      if (rows.join() !== "E2E Ruth,E2E Varro,E2E Gregor") throw new Error(`rows ${rows}`);
    });
    await s.checkText("the Download dropdown", base, page, ["E2E Gregor", "E2E Varro", "E2E Ruth", "E2E Kroot"]);
    await s.step("search narrows the list by name or archetype", { ...base, steps: [...base.steps!, "Include other characters", "search: guard", "search: ruth", "search: zzz", "clear"] }, async () => {
      for (const [q, want] of [["guard", "E2E Varro"], ["RUTH", "E2E Ruth"], ["zzz", ""], ["", "E2E Ruth,E2E Varro,E2E Gregor"]] as const) {
        await page.eval((v: string) => {
          const i = document.querySelector(".dl-drop input.dl-search") as HTMLInputElement;
          i.focus();
          i.select();
        }, q);
        if (q) await page.type(q);
        else await page.key("Backspace");
        await page.waitFor((w: string) => [...document.querySelectorAll(".dl-drop .dl-row-name")].map((x) => x.textContent).join() === w, [want], { what: `rows "${want}" for "${q}"`, timeout: 3000 });
      }
    });
    await s.step("picking characters makes it the Warband download, kept for the account", { ...base, steps: [...base.steps!, "Include other characters", "pick E2E Gregor", "pick E2E Ruth"] }, async () => {
      await open();
      await pick("E2E Gregor");
      await wantCaption("Download Warband Docx");
      await pick("E2E Ruth");
      const st = await settingsNow();
      // In the list's order.
      if (JSON.stringify(st.with[self.id]) !== JSON.stringify([made[2].id, made[0].id])) throw new Error(`kept ${JSON.stringify(st.with)}`);
    });
    await s.step("the PDF toggle: Download Warband PDF, kept for the account", { ...base, steps: [...base.steps!, "Include other characters", "PDF"] }, async () => {
      await open();
      await page.click(".dl-format-opt", 1);
      await idle(page);
      await wantCaption("Download Warband PDF");
      if ((await settingsNow()).format !== "pdf") throw new Error("format not kept");
    });
    await s.step("Escape closes the dropdown and puts focus back on the arrow; a click outside closes it", { ...base, steps: [...base.steps!, "Escape", "Include other characters", "click outside"] }, async () => {
      await open();
      await page.key("Escape");
      await page.waitFor(() => !document.querySelector(".dl-drop") && document.activeElement?.classList.contains("dl-arrow") === true, [], { what: "closed, focus on the arrow" });
      await open();
      await page.click(".builder-title");
      await page.waitFor(() => !document.querySelector(".dl-drop"), [], { what: "closed by a click outside" });
    });
    await s.step("the picks and format come back from the server, not this browser", { ...base, steps: [...base.steps!, "clear localStorage", "reload"] }, async () => {
      await page.eval(() => localStorage.clear());
      await page.reload();
      await page.waitFor(() => !!document.querySelector(".char-view"));
      await idle(page);
      await wantCaption("Download Warband PDF");
      await open();
      const checked = await page.eval(() => [...document.querySelectorAll(".dl-drop .dl-row")].filter((x) => (x.querySelector("input") as HTMLInputElement).checked).map((x) => x.querySelector(".dl-row-name")!.textContent));
      if (checked.join() !== "E2E Ruth,E2E Gregor") throw new Error(`checked ${checked}`);
      await page.key("Escape");
    });
    await s.step("another character keeps its own picks (none) and shares the format", { ...base, steps: [...base.steps!, "open E2E Varro"] }, async () => {
      await openCharacter(page, s.app.url, made[1].id);
      await wantCaption("Download PDF");
      await openCharacter(page, s.app.url, self.id);
      await wantCaption("Download Warband PDF");
    });
    await s.step("Download Warband Docx: one file, this character first, then the picked", { ...base, steps: [...base.steps!, "Include other characters", "Docx", "Download Warband Docx"] }, async () => {
      await open();
      await page.click(".dl-format-opt", 0);
      await page.key("Escape");
      await wantCaption("Download Warband Docx");
      const t0 = Date.now();
      await page.click(".char-tools .dl-main");
      const file = await s.chrome.download(t0);
      if (!file.endsWith("E2E Kroot, E2E Ruth, E2E Gregor.docx")) throw new Error(`file ${file}`);
      const text = s.readDownload(file, (b) => docxText(unzipEntry(b, "word/document.xml")));
      const at = ["E2E Kroot", "E2E Ruth", "E2E Gregor"].map((n) => text.indexOf(n));
      if (at.some((x) => x < 0) || !(at[0] < at[1] && at[1] < at[2])) throw new Error(`names at ${at} in the .docx`);
      if (text.includes("E2E Varro")) throw new Error("an unpicked character is in the .docx");
    });
    await s.step("Download Warband PDF: a PDF file of the same characters", { ...base, steps: [...base.steps!, "Include other characters", "PDF", "Download Warband PDF (under the card)"] }, async () => {
      await open("foot");
      await page.click(".dl-format-opt", 1);
      await page.key("Escape");
      await wantCaption("Download Warband PDF");
      const t0 = Date.now();
      await page.click(".ccard-foot .dl-main");
      const file = await s.chrome.download(t0);
      if (!file.endsWith("E2E Kroot, E2E Ruth, E2E Gregor.pdf")) throw new Error(`file ${file}`);
      s.readDownload(file, (b) => {
        const head = new TextDecoder().decode(b.slice(0, 5));
        if (head !== "%PDF-") throw new Error(`starts ${JSON.stringify(head)}`);
        if (!new TextDecoder("latin1").decode(b.slice(-32)).includes("%%EOF")) throw new Error("no %%EOF");
        return null;
      });
    });
    await s.step("unpicking every character: back to Download PDF", { ...base, steps: [...base.steps!, "Include other characters", "unpick both"] }, async () => {
      await open();
      await pick("E2E Gregor");
      await pick("E2E Ruth");
      await wantCaption("Download PDF");
      if ((await settingsNow()).with[self.id]) throw new Error("the picks are still kept");
      await page.key("Escape");
    });
    await s.step("a picked character deleted elsewhere drops out", { ...base, steps: [...base.steps!, "pick E2E Varro", "another tab deletes E2E Varro", "reload"] }, async () => {
      await open();
      await pick("E2E Varro");
      await wantCaption("Download Warband PDF");
      await page.key("Escape");
      page.allow.push(/404/);
      if ((await api(page, "POST", `/api/v1/characters/${made[1].id}/delete`)).status !== 200) throw new Error("delete failed");
      await page.reload();
      await page.waitFor(() => !!document.querySelector(".char-view"));
      await idle(page);
      await wantCaption("Download PDF");
      await open();
      if ((await rowNames()).includes("E2E Varro")) throw new Error("the deleted character is still listed");
      await page.key("Escape");
      page.allow.pop();
    });
  });
}
