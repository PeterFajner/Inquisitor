/// <reference lib="dom.iterable" />
// Phone (390×844, touch) and desktop, light and dark (prefers-color-scheme):
// a tour of every page with nothing wider than the screen, controls big
// enough to tap on a phone, and the no-UI-text rule; the error pages; the
// balance label. Each a shard.
import type { Page, View } from "../lib/cdp.ts";
import { DESKTOP, PHONE } from "../lib/cdp.ts";
import type { Report, Repro } from "../lib/report.ts";
import { idle, newCharacter, openBuilder, openList, Session } from "../lib/ui.ts";
import type { RunOptions } from "../shards.ts";
import { withSession } from "./f-builder.ts";
import { openRules } from "./f-rules.ts";

/** Elements reaching past the right edge (outside the sheet's own scroll boxes), and whether the page scrolls sideways. */
function overflow(page: Page): Promise<{ scrolls: boolean; wide: string[] }> {
  return page.eval(() => {
    const w = document.documentElement.clientWidth;
    const scrolls = document.documentElement.scrollWidth > w + 1;
    const wide: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const h = el as HTMLElement;
      if (!h.checkVisibility?.() || h.closest(".scroll-x, .rb-tabs, .site-scroll, dialog:not([open])")) continue;
      const b = h.getBoundingClientRect();
      if (b.width && b.right > w + 1 && b.left < w) {
        const parentWide = h.parentElement && h.parentElement.getBoundingClientRect().right > w + 1;
        if (parentWide) continue;
        // Inside a box that scrolls sideways: meant to (a wide table one can swipe). Clipped by one that doesn't: cut off.
        let a = h.parentElement;
        let scrollable = false;
        while (a && a !== document.body) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === "auto" || ox === "scroll") {
            scrollable = true;
            break;
          }
          a = a.parentElement;
        }
        if (!scrollable) wide.push(`<${h.tagName.toLowerCase()} class="${h.className}"> right ${Math.round(b.right)} > ${w}`);
      }
    }
    return { scrolls, wide: wide.slice(0, 5) };
  });
}

/** Controls smaller than 24×24 CSS px (WCAG 2.2 target size) on a touch screen. */
function smallTargets(page: Page): Promise<string[]> {
  return page.eval(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("button, a[href], select, input")) {
      const h = el as HTMLElement;
      // Inline references in a card's text (chips) and the contents' names are links in running text (WCAG's inline exception).
      if (!h.checkVisibility?.() || h.closest(".rb-card .text, p, li > a, .rb-toc, .chip")) continue;
      const b = h.getBoundingClientRect();
      if (b.width && b.height && (b.width < 24 || b.height < 24)) out.push(`${h.getAttribute("aria-label") ?? h.textContent?.trim().slice(0, 30) ?? h.tagName} (${Math.round(b.width)}×${Math.round(b.height)})`);
    }
    return [...new Set(out)];
  });
}

function tour(view: View): (r: Report, o: RunOptions) => Promise<void> {
  const phone = !!view.mobile;
  return async (r, o) =>
    withSession(
      r,
      o,
      async (s) => {
        const page = s.page;
        const check = async (where: string, repro: Repro) => {
          const ov = await overflow(page);
          r.expect(!ov.scrolls && !ov.wide.length, "nothing wider than the screen", `${where}: ${ov.scrolls ? "the page scrolls sideways; " : ""}${ov.wide.join("; ")}`, { ...repro, screenshot: await s.screenshot(where) }, `${where}`);
          if (phone) {
            const small = await smallTargets(page);
            r.expect(!small.length, "controls are big enough to tap (24 px)", `${where}: ${small.slice(0, 12).join(", ")}${small.length > 12 ? ` … (${small.length})` : ""}`, repro, where);
          }
          await s.checkText(where, repro, page, ["E2E Tour"]);
        };
        const base: Repro = { steps: [`${phone ? "phone" : "desktop"} ${view.dark ? "dark" : "light"}`] };
        await s.step("the New character form", base, () => openBuilder(page, s.app.url));
        await check("new character form", base);
        let id = "";
        await s.step("make a character", { ...base, steps: [...base.steps!, "Inquisitor Psyker → Random"] }, async () => {
          id = await newCharacter(page, "inquisitor", "psyker");
          await page.click('input[aria-label="Rename"]');
          await page.type("E2E Tour");
          await page.key("Enter");
          await idle(page);
        });
        await check("a character", base);
        await page.eval(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await check("a character's sheet", base);
        await s.step("the Rolls panel", base, async () => {
          await page.clickLabel("Rolls");
          await page.waitFor(() => !!document.querySelector(".log"));
        });
        await check("the Rolls panel", base);
        if (phone) {
          await s.step("the characters drawer opens and closes", { ...base, steps: [...base.steps!, "☰", "tap outside"] }, async () => {
            await openList(page);
            await check("the characters drawer", base);
            // A tap on the backdrop beside the drawer.
            const at = await page.eval(() => {
              const nav = document.querySelector(".char-list")!.getBoundingClientRect();
              return { x: Math.round((nav.right + innerWidth) / 2), y: Math.round(innerHeight / 2) };
            });
            if (at.x >= (await page.eval(() => innerWidth)) - 2) throw new Error("the drawer covers the whole screen: no backdrop to tap");
            await page.tap(at.x, at.y);
            await page.waitFor(() => !document.querySelector(".char-list.open"), [], { what: "the drawer closed" });
          });
        }
        await s.step("the balance details open with a tap or click", { ...base, steps: [...base.steps!, "Balance details"] }, async () => {
          await page.waitFor(() => !!document.querySelector('.ccard [aria-label="Balance details"]'), [], { what: "the balance label", timeout: 20_000 });
          await page.click('.ccard [aria-label="Balance details"]');
          await page.waitFor(() => !document.querySelector(".ccard .balance-pop")!.hasAttribute("hidden"), [], { what: "the popover" });
        });
        await s.step("the print view", { ...base, steps: [...base.steps!, "Print"] }, async () => {
          await page.eval(() => void (window.print = () => {}));
          await page.clickLabel("Print");
          await page.waitFor(() => !!document.querySelector(".print-page"));
        });
        await check("the print view", base);
        await page.eval(() => (document.querySelector('.print-toolbar [aria-label="Close"]') as HTMLElement)?.click());
        await s.step("the history page", { ...base, steps: [...base.steps!, "History"] }, async () => {
          await page.goto(`${s.app.url}/c/${id}/history`);
          await page.waitFor(() => document.querySelectorAll(".hv-card").length > 0);
          await idle(page);
        });
        await check("the history page", base);
        await s.step("the rules page", { ...base, steps: [...base.steps!, "/rules"] }, () => openRules(page, s.app.url));
        await check("the rules page", base);
        if (phone) {
          await s.step("the Table of Contents opens over the page and closes on a pick", { ...base, steps: [...base.steps!, "/rules", "☰", "a name"] }, async () => {
            await page.click('button.site-menu[aria-label="Table of Contents"]');
            await page.waitFor(() => !!document.querySelector(".rb-toc:not(.rb-away) a[data-key]"));
            await check("the Table of Contents", base);
            await page.click(".rb-toc:not(.rb-away) a[data-key]", 3);
            await page.waitFor(() => !document.querySelector(".rb.toc-open"), [], { what: "the contents closed" });
          });
        }
        await s.step("search", { ...base, steps: [...base.steps!, "/rules", "Search"] }, async () => {
          await page.clickLabel("Search");
          await page.waitFor(() => !!document.querySelector('.search-menu input[aria-label="Search"]'));
        });
        await check("the rules search", base);
        await s.step("a warband", { ...base, steps: [...base.steps!, "/", "New warband"] }, async () => {
          await page.click('a.site-tab[href="/"]');
          await page.waitFor(() => !!document.querySelector(".char-view")?.checkVisibility());
          await openList(page);
          await page.clickLabel("New warband");
          await page.waitFor(() => !!document.querySelector(".wb"));
        });
        await check("a warband", base);
        const bg = await page.eval(() => getComputedStyle(document.body).backgroundColor);
        r.note(`body background (${view.dark ? "dark" : "light"} scheme): ${bg}`);
      },
      { view },
    );
}

export const phoneLight = tour({ ...PHONE, dark: false });
export const phoneDark = tour({ ...PHONE, dark: true });
export const desktopLight = tour({ ...DESKTOP, dark: false });
export const desktopDark = tour({ ...DESKTOP, dark: true });

export async function errorPagesFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(r, o, async (s) => {
    const page = s.page;
    page.allow.push(/404 \(Not Found\)/);
    for (const path of ["/c/nope", "/c/nope/history", "/w/nope", "/s/nope", "/nope", "/rules/nope"]) {
      const repro: Repro = { steps: [path] };
      await s.step("unknown addresses show the error page", repro, async () => {
        const res = await fetch(`${s.app.url.replace("localhost", "127.0.0.1")}${path}`);
        if (res.status !== 404) throw new Error(`${path}: status ${res.status}`);
        await page.goto(`${s.app.url}${path}`);
        await idle(page);
        const tabs = await page.eval(() => document.querySelectorAll("a.site-tab").length);
        if (!tabs) throw new Error("no way back (no top bar)");
      });
      await s.checkText(`the error page ${path}`, repro);
    }
    // Another browser's character: not found here either.
    await openBuilder(page, s.app.url);
    const id = await newCharacter(page, "servitors", "servitor");
    const other = await s.newPage(undefined, { isolated: true });
    other.allow.push(/404 \(Not Found\)/, /403/);
    await s.step("another browser's character isn't shown", { steps: ["a character in browser A", `browser B opens /c/${id}`] }, async () => {
      await other.goto(`${s.app.url}/c/${id}`);
      await idle(other);
      const shown = await other.eval(() => !!document.querySelector(".char-view"));
      if (shown) throw new Error("browser B sees browser A's character");
    }, other);
    await other.close();
  });
}

export async function balanceFeature(r: Report, o: RunOptions): Promise<void> {
  await withSession(
    r,
    o,
    async (s) => {
      const page = s.page;
      await openBuilder(page, s.app.url);
      const SENTENCE = /^This character is in the (top|bottom) (\d+(?:\.\d+)?)% of randomly-rolled (.+)\.$/;
      for (const [a, sub] of [["inquisitor", "fighter"], ["adeptus-astartes", "space-marine"], ["mutants", "scout"]] as const) {
        const repro: Repro = { archetype: a, subtype: sub, steps: [`New character ${a} ${sub}`, "hover Balance details"] };
        await s.step("the balance label: a word, the sentence on hover", repro, async () => {
          await newCharacter(page, a, sub);
          await page.waitFor(() => !!document.querySelector(".ccard .balance-word"), [], { what: "the balance label", timeout: 30_000 });
          const word = await page.eval(() => document.querySelector(".ccard .balance-word")!.textContent);
          if (!["overpowered", "underpowered", "balanced"].includes(word ?? "")) throw new Error(`word "${word}"`);
          await page.hover('.ccard [aria-label="Balance details"]');
          await page.waitFor(() => !document.querySelector(".ccard .balance-pop")!.hasAttribute("hidden"), [], { what: "the popover on hover" });
          const text = await page.eval(() => document.querySelector(".ccard .balance-pop")!.textContent ?? "");
          const m = SENTENCE.exec(text);
          if (!m) throw new Error(`popover "${text}"`);
          const pct = Number(m[2]);
          if (word === "overpowered" && !(m[1] === "top" && pct <= 5)) throw new Error(`${word} but "${text}"`);
          if (word === "underpowered" && !(m[1] === "bottom" && pct <= 5)) throw new Error(`${word} but "${text}"`);
          if (word === "balanced" && pct <= 5) throw new Error(`${word} but "${text}"`);
          await page.key("Escape");
        });
        await s.checkText("the balance label", repro);
      }
    },
    { balance: true },
  );
}

void Session;
