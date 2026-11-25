/// <reference lib="dom.iterable" />
// The rules page (tabs, Table of Contents, search, links between cards,
// "Rolled on by", addresses) and moving between the app's pages without a
// document load (back and forward), each a shard.
import type { Page } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { realCompendium } from "../lib/rules.ts";
import { idle, newCharacter, openBuilder, Session } from "../lib/ui.ts";
import type { RunOptions } from "../shards.ts";
import { withSession } from "./f-builder.ts";

const TABS = ["Character Archetypes", "Talents & Exotic Abilities", "Equipment", "Psychic Powers", "Mutations", "Tables", "Rules"];

export async function openRules(page: Page, url: string, hash = ""): Promise<void> {
  await page.goto(`${url}/rules${hash}`);
  await page.waitFor(() => document.querySelector(".rb-main")?.getAttribute("aria-busy") !== "true" && document.querySelectorAll(".rb-card").length > 0, [], { what: "the rules page", timeout: 30_000 });
  await idle(page);
}

const currentTab = (page: Page) => page.eval(() => document.querySelector('.rb-tab[aria-current="page"]')?.getAttribute("aria-label") ?? null);
/** The card with this key on screen (in the viewport, at least partly). */
const cardInView = (page: Page, key: string) =>
  page.eval((k: string) => {
    const el = document.querySelector(`.rb-card[data-key="${k}"]`);
    if (!el) return false;
    const b = el.getBoundingClientRect();
    return b.bottom > 0 && b.top < innerHeight;
  }, key);

export async function rulesFeature(r: Report, o: RunOptions): Promise<void> {
  const c = realCompendium();
  await withSession(r, o, async (s) => {
    const page = s.page;
    const base: Repro = { steps: ["/rules"] };
    await s.step("the rules page opens on its first tab", base, async () => {
      await openRules(page, s.app.url);
      if ((await currentTab(page)) !== TABS[0]) throw new Error(`tab ${await currentTab(page)}`);
    });
    await s.checkText("the rules page", base);
    for (const tab of TABS) {
      await s.step("every tab shows its cards", { steps: ["/rules", `tab ${tab}`] }, async () => {
        await page.clickLabel(tab);
        await page.waitFor((t: string) => document.querySelector('.rb-tab[aria-current="page"]')?.getAttribute("aria-label") === t, [tab]);
        await page.waitFor(() => [...document.querySelectorAll(".rb-card")].some((x) => (x as HTMLElement).checkVisibility()), [], { what: "a card on the tab" });
      });
      await s.checkText(`the rules page, ${tab}`, { steps: ["/rules", `tab ${tab}`] });
    }
    await s.step("the Table of Contents opens, and a name scrolls to its card", { steps: ["/rules", "Equipment", "Table of Contents", "a name near the end"] }, async () => {
      await page.clickLabel("Equipment");
      const open = await page.eval(() => !!document.querySelector(".rb.toc-open"));
      if (!open) await page.click('button.site-menu[aria-label="Table of Contents"]');
      await page.waitFor(() => !!document.querySelector('.rb-toc:not(.rb-away) a[data-key]'));
      const key = await page.eval(() => {
        const links = [...document.querySelectorAll(".rb-toc:not(.rb-away) a[data-key]")];
        const a = links[Math.floor(links.length * 0.8)];
        a.setAttribute("data-e2e", "toc");
        return a.getAttribute("data-key")!;
      });
      await page.click('[data-e2e="toc"]');
      await page.waitFor((k: string) => decodeURIComponent(location.hash) === `#${k}`, [key], { what: `the address #${key}` });
      await page.waitFor((k: string) => {
        const el = document.querySelector(`.rb-card[data-key="${k}"]`);
        if (!el) return false;
        const b = el.getBoundingClientRect();
        return b.bottom > 0 && b.top < innerHeight;
      }, [key], { what: `${key} on screen` });
    });
    await s.step("search finds a card by name and shows it", { steps: ["/rules", "Search", "Rock Steady Aim"] }, async () => {
      await page.clickLabel("Search");
      await page.waitFor(() => !!document.querySelector('.search-menu input[aria-label="Search"]'));
      await page.click('.search-menu input[aria-label="Search"]');
      await page.type("Rock Steady");
      await page.waitFor(() => [...document.querySelectorAll('#rs-list [role="option"]')].some((x) => x.textContent?.includes("Rock Steady Aim")), [], { what: "the result" });
      await page.key("Enter");
      await page.waitFor(() => document.querySelector('.rb-tab[aria-current="page"]')?.getAttribute("aria-label") === "Talents & Exotic Abilities", [], { what: "the talents tab" });
      await page.waitFor(() => /talent\/rock-steady-aim$/.test(decodeURIComponent(location.hash)), [], { what: "the card's address" });
      if (!(await cardInView(page, decodeURIComponent((await page.eval(() => location.hash)).slice(1))))) throw new Error("the card isn't on screen");
    });
    await s.checkText("the search", { steps: ["/rules", "Search"] });
    await s.step("a reference on a card goes to that card (another tab)", { steps: ["/rules#loyalist:archetype/inquisitor", "a talent chip"] }, async () => {
      await page.goto(`${s.app.url}/rules#loyalist:archetype/inquisitor`);
      await page.waitFor(() => !!document.querySelector('.rb-card[data-key="loyalist:archetype/inquisitor"] button.chip.ref.k-talent'), [], { what: "the Inquisitor card's talent chip", timeout: 30_000 });
      await idle(page);
      await page.waitFor(() => {
        const el = document.querySelector('.rb-card[data-key="loyalist:archetype/inquisitor"]');
        return !!el && Math.abs(el.getBoundingClientRect().top) < innerHeight;
      }, [], { what: "the Inquisitor card on screen" });
      const name = await page.eval(() => {
        const b = document.querySelector('.rb-card[data-key="loyalist:archetype/inquisitor"] button.chip.ref.k-talent')!;
        b.setAttribute("data-e2e", "ref");
        return b.textContent!.trim();
      });
      await page.click('[data-e2e="ref"]');
      await page.waitFor(() => document.querySelector('.rb-tab[aria-current="page"]')?.getAttribute("aria-label") === "Talents & Exotic Abilities", [], { what: "the talents tab", timeout: 30_000 });
      const key = decodeURIComponent(await page.eval(() => location.hash)).slice(1);
      const id = key.split("/")[1];
      if (!name.startsWith(c.talents.get(id)?.name ?? "\0")) throw new Error(`went to ${key} for "${name}"`);
      await page.waitFor((k: string) => {
        const el = document.querySelector(`.rb-card[data-key="${k}"]`);
        return !!el && el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0;
      }, [key], { what: "the card on screen" });
    });
    await s.step("back and forward follow the cards visited", { steps: ["(after the reference)", "Back", "Forward"] }, async () => {
      const there = await page.eval(() => location.hash);
      await history(page, -1);
      await page.waitFor(() => decodeURIComponent(location.hash) === "#loyalist:archetype/inquisitor", [], { what: "back at the Inquisitor" });
      await page.waitFor(() => document.querySelector('.rb-tab[aria-current="page"]')?.getAttribute("aria-label") === "Character Archetypes", [], { what: "the archetypes tab" });
      await history(page, 1);
      await page.waitFor((x: string) => location.hash === x, [there], { what: "forward again" });
    });
    // "Rolled on by": a table's back-links.
    const table = [...c.tables.values()].find((t) => t.id === "boons")!;
    await s.step("a table's Rolled on by links to the cards that roll on it", { steps: [`/rules#loyalist:table/${table.id}`, "Rolled on by: first"] }, async () => {
      await page.goto(`${s.app.url}/rules#loyalist:table/${table.id}`);
      await page.waitFor((k: string) => !!document.querySelector(`.rb-card[data-key="${k}"] .rc-by button.chip`), [`loyalist:table/${table.id}`], { what: "Rolled on by", timeout: 30_000 });
      const label = await page.eval((k: string) => document.querySelector(`.rb-card[data-key="${k}"] .rc-by [aria-label]`)?.getAttribute("aria-label"), `loyalist:table/${table.id}`);
      if (label !== "Rolled on by") throw new Error(`label ${label}`);
      await page.eval((k: string) => document.querySelector(`.rb-card[data-key="${k}"] .rc-by button.chip`)!.setAttribute("data-e2e", "by"), `loyalist:table/${table.id}`);
      const before = await page.eval(() => location.hash);
      await page.click('[data-e2e="by"]');
      await page.waitFor((b: string) => location.hash !== b, [before], { what: "a new address" });
    });
    await s.step("a card's address opens it (a shared link)", { steps: ["/rules#loyalist:item/needle-pistol (a fresh load)"] }, async () => {
      await openRules(page, s.app.url, "#loyalist:item/needle-pistol");
      await page.waitFor(() => document.querySelector('.rb-tab[aria-current="page"]')?.getAttribute("aria-label") === "Equipment", [], { what: "the equipment tab" });
      await page.waitFor(() => {
        const el = document.querySelector('.rb-card[data-key="loyalist:item/needle-pistol"]');
        return !!el && el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0;
      }, [], { what: "the card on screen" });
    });
    await s.step("the book's text opens on a card", { steps: ["/rules#loyalist:item/needle-pistol", "The book's text"] }, async () => {
      await page.click('.rb-card[data-key="loyalist:item/needle-pistol"] [aria-label^="The book\'s text"]');
      await page.waitFor(() => !!document.querySelector('.rb-card[data-key="loyalist:item/needle-pistol"] [aria-label="Close"]'), [], { what: "the quote" });
    });
    await s.checkText("a card's quote", { steps: ["/rules#loyalist:item/needle-pistol", "The book's text"] });
    await s.step("a bad address shows the first tab", { steps: ["/rules#nope:nothing/here"] }, async () => {
      await openRules(page, s.app.url, "#nope:nothing/here");
      if (!(await currentTab(page))) throw new Error("no tab");
    });
  });
}

/** Goes back (or forward) one history entry, as the browser's buttons do. */
async function history(page: Page, delta: -1 | 1): Promise<void> {
  const h = await page.send<{ currentIndex: number; entries: { id: number; url: string }[] }>("Page.getNavigationHistory");
  await page.send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex + delta].id });
}

export async function navigationFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "navigator", "navigator");
    const base: Repro = { steps: ["New character Navigator", "set a marker on window"] };
    const mark = () => page.eval(() => ((window as unknown as { __mark: number }).__mark ??= Math.random()));
    const m0 = await mark();
    const same = async (what: string) => {
      const m = await page.eval(() => (window as unknown as { __mark?: number }).__mark ?? null);
      if (m !== m0) throw new Error(`${what} loaded a new document`);
    };
    await s.step("the Rules tab shows the rules page in place", { ...base, steps: [...base.steps!, "Rules (top bar)"] }, async () => {
      await page.click('a.site-tab[href="/rules"]');
      await page.waitFor(() => location.pathname === "/rules" && document.querySelectorAll(".rb-card").length > 0, [], { what: "the rules page", timeout: 30_000 });
      await same("Rules");
    });
    await page.clickLabel("Equipment");
    await page.waitFor(() => document.querySelector('.rb-tab[aria-current="page"]')?.getAttribute("aria-label") === "Equipment");
    await page.eval(() => window.scrollTo(0, 1500));
    await new Promise((res) => setTimeout(res, 300));
    const y = await page.eval(() => scrollY);
    await s.step("the Characters tab goes back to the character as left", { ...base, steps: [...base.steps!, "Rules", "Equipment", "scroll", "Characters (top bar)"] }, async () => {
      await page.click('a.site-tab[href="/"]');
      await page.waitFor((x: string) => location.pathname === `/c/${x}` && !!document.querySelector(".char-view")?.checkVisibility(), [id], { what: "the character" });
      await same("Characters");
    });
    await s.step("Rules again keeps its tab and place", { ...base, steps: [...base.steps!, "Rules (top bar) again"] }, async () => {
      await page.click('a.site-tab[href="/rules"]');
      await page.waitFor(() => location.pathname === "/rules");
      await page.waitFor(() => document.querySelector('.rb-tab[aria-current="page"]')?.getAttribute("aria-label") === "Equipment", [], { what: "Equipment kept" });
      // (cards mount as they come into view: the place may take a moment)
      const back = await page.waitFor((want: number) => Math.abs(scrollY - want) <= 40, [y], { timeout: 4000 }).then(() => true, () => false);
      if (!back) throw new Error(`scrolled to ${await page.eval(() => scrollY)}, left at ${y}`);
      await same("Rules again");
    });
    await s.step("Back and Forward move between the pages in place", { ...base, steps: [...base.steps!, "Back", "Forward"] }, async () => {
      await history(page, -1);
      await page.waitFor((x: string) => location.pathname === `/c/${x}` && !!document.querySelector(".char-view")?.checkVisibility(), [id], { what: "back at the character" });
      await history(page, 1);
      await page.waitFor(() => location.pathname === "/rules" && !!document.querySelector(".rb-main")?.checkVisibility(), [], { what: "forward at the rules" });
      await same("Back/Forward");
    });
    await s.step("History (a page made each time) and back", { ...base, steps: [...base.steps!, "Characters", "History", "Back"] }, async () => {
      await page.click('a.site-tab[href="/"]');
      await page.waitFor(() => !!document.querySelector(".char-view")?.checkVisibility());
      await page.clickLabel("History");
      await page.waitFor((x: string) => location.pathname === `/c/${x}/history` && document.querySelectorAll(".hv-card").length > 0, [id], { what: "history" });
      await history(page, -1);
      await page.waitFor((x: string) => location.pathname === `/c/${x}` && !!document.querySelector(".char-view")?.checkVisibility(), [id], { what: "back at the character" });
      await same("History and back");
    });
    await s.step("one rules fetch and one event stream across pages", { ...base, steps: [...base.steps!, "(the whole tour)"] }, async () => {
      const n = await page.eval(() => performance.getEntriesByType("resource").filter((e) => /\/api\/v1\/rules(\?|$)/.test(e.name)).length);
      const es = await page.eval(() => performance.getEntriesByType("resource").filter((e) => /\/api\/v1\/rules\/events/.test(e.name)).length);
      if (n > 1) throw new Error(`${n} fetches of /api/v1/rules`);
      if (es > 1) throw new Error(`${es} event streams`);
    });
  });
  void Session;
}
