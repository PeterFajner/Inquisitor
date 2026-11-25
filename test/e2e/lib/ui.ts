/// <reference lib="dom.iterable" />
// The builder as a person uses it, for the UI shards: a session (app +
// Chrome + page), waiting for the app to settle, making characters through
// the form or (seeded, for coverage) through the API, reading what is shown,
// and the checks every page gets (no console errors, the no-UI-text rule,
// labelled icon controls).
import { join } from "node:path";
import type { BuildResult } from "../../../src/shared/engine/build.ts";
import type { CharacterRecord } from "../../../src/shared/engine/record.ts";
import { startApp, type App } from "./app.ts";
import { Chrome, DESKTOP, type Page, type View } from "./cdp.ts";
import type { Report, Repro } from "./report.ts";
import { fileName } from "./report.ts";
import { bookWords, uiTextProblems } from "./text.ts";

/** Counts the page's fetches in flight, so `idle` knows when the app has settled. */
const INSTRUMENT = `(() => {
  if (window.__e2e) return;
  window.__e2e = { inflight: 0, loads: (window.__e2e_loads = (window.__e2e_loads || 0) + 1) };
  const f = window.fetch;
  window.fetch = function (...a) {
    window.__e2e.inflight++;
    return f.apply(this, a).finally(() => window.__e2e.inflight--);
  };
})();`;

/** Failures the app makes on purpose: the first save of a browser without a session answers 401 and makes a visitor (PLAN.md). */
export const EXPECTED = [/status of 401 \(Unauthorized\)/];

export class Session {
  app!: App;
  chrome!: Chrome;
  page!: Page;
  r: Report;
  shots: string;
  rulesVersion = "";
  words!: Set<string>;
  private shotN = 0;

  constructor(r: Report, results: string) {
    this.r = r;
    this.shots = join(results, "screens", fileName(r.shard));
  }

  static async start(r: Report, results: string, view: View = DESKTOP, opts: { balance?: boolean } = {}): Promise<Session> {
    const s = new Session(r, results);
    s.app = await startApp(opts);
    s.chrome = await Chrome.launch();
    s.page = await s.newPage(view);
    const rules = (await (await fetch(`http://127.0.0.1:${s.app.port}/api/v1/rules`)).json()) as { version: string };
    s.rulesVersion = rules.version;
    s.words = bookWords(rules);
    r.note(`server ${s.app.url} (pid ${s.app.proc.pid}), Chrome pid ${s.chrome.proc.pid}`);
    return s;
  }

  async newPage(view: View = DESKTOP, opts: { isolated?: boolean } = {}): Promise<Page> {
    const p = await this.chrome.newPage(view, opts);
    p.allow.push(...EXPECTED);
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
    return p;
  }

  async stop(): Promise<void> {
    await this.chrome?.close();
    await this.app?.stop();
  }

  async screenshot(name: string, page = this.page): Promise<string> {
    return page.screenshot(join(this.shots, `${String(++this.shotN).padStart(3, "0")}-${name.replace(/[^\w.-]+/g, "_").slice(0, 80)}.png`));
  }

  /**
   * Runs one step: a throw is a failure with a screenshot and the steps so
   * far; console errors and exceptions during it are failures too. Returns
   * false when the step failed.
   */
  async step(check: string, repro: Repro, fn: () => Promise<void>, page = this.page): Promise<boolean> {
    page.takeProblems();
    let ok = true;
    try {
      await fn();
      this.r.pass(check);
    } catch (e) {
      ok = false;
      let shot: string | undefined;
      try {
        shot = await this.screenshot(check, page);
      } catch {}
      this.r.fail(check, String((e as Error).message ?? e), { ...repro, url: await page.url().catch(() => undefined), screenshot: shot }, `${check}: ${String((e as Error).message).replace(/\d+/g, "N").slice(0, 160)}`);
    }
    for (const p of page.takeProblems()) {
      let shot: string | undefined;
      try {
        shot = await this.screenshot(`console-${check}`, page);
      } catch {}
      this.r.fail("no console errors or exceptions", `${p.kind}: ${p.text}${p.url ? ` (${p.url})` : ""}`, { ...repro, steps: [...(repro.steps ?? []), check], screenshot: shot }, `${p.kind}: ${String(p.text).split("\n")[0].replace(/[0-9a-zA-Z_-]{16}/g, "ID").slice(0, 160)}`);
      ok = false;
    }
    return ok;
  }

  /** The no-UI-text rule and labelled controls on what the page shows now. */
  async checkText(where: string, repro: Repro, page = this.page, extra: string[] = []): Promise<void> {
    const shown = await visibleTexts(page);
    const bad = uiTextProblems(shown.texts, this.words, extra);
    for (const b of bad) this.r.fail("visible text is the book's (AGENTS.md)", `${where}: "${b.text}" (words not in the book: ${b.words.join(", ")})`, { ...repro, url: await page.url() }, b.words.join(" "));
    if (!bad.length) this.r.pass("visible text is the book's (AGENTS.md)");
    for (const c of shown.unlabelled) this.r.fail("icon controls have an aria-label and the same tooltip", `${where}: ${c}`, { ...repro, url: await page.url() }, c.replace(/\d+/g, "N"));
    if (!shown.unlabelled.length) this.r.pass("icon controls have an aria-label and the same tooltip");
    for (const d of page.dialogs.splice(0)) {
      const bad = uiTextProblems([d.message], this.words, extra);
      this.r.expect(!bad.length, "dialog text is the book's (AGENTS.md)", `${where}: ${d.type} "${d.message}"`, repro, d.message.replace(/E2E\S*/g, ""));
    }
  }
}

/** Waits until no fetch is in flight and nothing is aria-busy, twice in a row. */
export async function idle(page: Page, timeout = 20_000): Promise<void> {
  const settled = () => {
    const w = window as unknown as { __e2e?: { inflight: number } };
    return (w.__e2e?.inflight ?? 0) === 0 && !document.querySelector('[aria-busy="true"]');
  };
  const t0 = Date.now();
  for (let calm = 0; calm < 3; ) {
    if (Date.now() - t0 > timeout) throw new Error("the app never settled (a fetch in flight or aria-busy)");
    calm = (await page.eval(settled)) ? calm + 1 : 0;
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** Every text a person sees (text nodes in visible elements, selected options, placeholders) and controls with no name. */
export function visibleTexts(page: Page, root = "body", skip = ""): Promise<{ texts: string[]; unlabelled: string[] }> {
  return page.eval(
    (rootSel: string, skipSel: string) => {
      const texts: string[] = [];
      const unlabelled: string[] = [];
      const base = document.querySelector(rootSel);
      if (!base) return { texts, unlabelled };
      const hidden = (el: Element) => (skipSel && el.closest(skipSel)) || !(el as HTMLElement).checkVisibility({ visibilityProperty: true, opacityProperty: true });
      const walk = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const p = n.parentElement;
        // (an author's public id is data, not words)
        if (!p || p.closest("option, script, style, noscript, .hv-author") || hidden(p)) continue;
        if (n.textContent!.trim()) texts.push(n.textContent!.trim());
      }
      for (const s of base.querySelectorAll("select")) if (!hidden(s) && s.selectedOptions[0]) texts.push(s.selectedOptions[0].text.trim());
      for (const i of base.querySelectorAll("input, textarea")) {
        if (hidden(i)) continue;
        const el = i as HTMLInputElement;
        if (!el.value && el.placeholder) texts.push(el.placeholder);
      }
      for (const c of base.querySelectorAll("button, a[href], [role=button]")) {
        if (hidden(c)) continue;
        const label = c.getAttribute("aria-label");
        const text = (c.textContent ?? "").trim();
        if (!text && !label) unlabelled.push(`<${c.tagName.toLowerCase()} class="${c.getAttribute("class") ?? ""}"> has no text and no aria-label`);
        else if (!text && c.classList.contains("icon-btn") && c.getAttribute("title") !== label) unlabelled.push(`<${c.tagName.toLowerCase()} aria-label="${label}"> tooltip "${c.getAttribute("title")}"`);
      }
      return { texts, unlabelled };
    },
    root,
    skip,
  );
}

/** What the builder shows of a character outside the Rolls panel and the book's quote: the card, the sheet, the dropdowns' choices. */
export async function shownText(page: Page): Promise<string> {
  const { texts } = await visibleTexts(page, ".char-view", ".csec-log, .csec-source");
  return texts.join(" ").replace(/\s+/g, " ");
}

/** fetch() in the page (its cookies, same origin). */
export async function api<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.eval(
    async (m: string, p: string, b: string | null) => {
      const r = await fetch(p, { method: m, headers: b ? { "content-type": "application/json" } : {}, body: b ?? undefined });
      const t = await r.text();
      let j: unknown = t;
      try {
        j = JSON.parse(t);
      } catch {}
      return { status: r.status, body: j as never };
    },
    method,
    path,
    body === undefined ? null : JSON.stringify(body),
  );
}

/** A character saved from a record (as the builder saves one), a visitor made first if need be; its id. */
export async function saveRecord(s: Session, rec: CharacterRecord, name = "", page = s.page): Promise<string> {
  const body = { name, record: { ...rec, rulesVersion: s.rulesVersion }, rules_version: s.rulesVersion, kind: "roll" };
  let res = await api<{ character: { id: string } }>(page, "POST", "/api/v1/characters", body);
  if (res.status === 401) {
    await api(page, "POST", "/api/v1/account/visitor");
    res = await api(page, "POST", "/api/v1/characters", body);
  }
  if (res.status !== 200 && res.status !== 201) throw new Error(`save: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body.character.id;
}

/** The saved character's head record (from the server). */
export async function headRecord(page: Page, id: string): Promise<CharacterRecord> {
  const res = await api<{ character: { head_id: string; versions: { id: string; record: CharacterRecord }[] } }>(page, "GET", `/api/v1/characters/${id}`);
  const c = res.body.character;
  return c.versions.find((v) => v.id === c.head_id)!.record;
}

export const currentId = async (page: Page): Promise<string | null> => /^\/c\/([^/]+)/.exec(new URL(await page.url()).pathname)?.[1] ?? null;

/** The builder at /, settled. */
export async function openBuilder(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitFor(() => document.querySelector(".builder") && document.querySelector(".builder")!.getAttribute("aria-busy") === "false", [], { what: "the builder", timeout: 30_000 });
  await idle(page);
}

/** Opens the characters list (a drawer on a phone) when it is closed. */
export async function openList(page: Page): Promise<void> {
  const open = await page.eval(() => !!document.querySelector(".char-list.open") || matchMedia("(min-width: 861px)").matches && !!document.querySelector(".builder.list-open"));
  if (!open) await page.click('button.site-menu[aria-label="Characters"]');
  await page.waitFor(() => document.querySelector(".char-list")?.checkVisibility());
}

/** New character → archetype, subtype → Random: the character made, its id. */
export async function newCharacter(page: Page, archetype: string, subtype: string): Promise<string> {
  const creating = await page.eval(() => !!document.querySelector(".new-char"));
  if (!creating) {
    await openList(page);
    await page.clickLabel("New character");
  }
  await page.waitFor(() => document.querySelector('.new-char select[aria-label="Archetype"]'), [], { what: "the New character form" });
  await page.select('.new-char select[aria-label="Archetype"]', archetype);
  if (await page.eval(() => !!document.querySelector('.new-char select[aria-label="Subtype"]'))) await page.select('.new-char select[aria-label="Subtype"]', subtype);
  const before = await currentId(page);
  await page.click('.new-char [aria-label="Random"]');
  await page.waitFor((b: string | null) => {
    const m = /^\/c\/([^/]+)/.exec(location.pathname);
    return m && m[1] !== b && document.querySelector(".char-view") && !document.querySelector(".new-char") ? m[1] : null;
  }, [before], { what: "the new character", timeout: 20_000 });
  await idle(page);
  return (await currentId(page))!;
}

/** Opens a character by its address (a full load). */
export async function openCharacter(page: Page, url: string, id: string): Promise<void> {
  await page.goto(`${url}/c/${id}`);
  await page.waitFor(() => !!document.querySelector(".char-view") && document.querySelector(".builder")?.getAttribute("aria-busy") === "false", [], { what: "the character", timeout: 30_000 });
  await idle(page);
}

/** The names a built character should show (things, chosen options), and its choices' results. */
export function expectedShown(b: BuildResult): { things: string[]; choices: { key: string; label: string; result: string }[] } {
  const ch = b.character;
  const things = [...ch.talents, ...ch.exotics, ...ch.mutations, ...ch.powers, ...ch.items].map((t) => t.name);
  const choices = b.log.filter((e) => e.type === "choice").flatMap((e) => e.result.filter(Boolean).map((result) => ({ key: e.key, label: e.label, result })));
  return { things: [...new Set(things)], choices };
}
