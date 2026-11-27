/// <reference lib="dom.iterable" />
// Headless Chrome over the DevTools protocol (Node's own WebSocket): one
// Chrome per shard, its own profile directory and debugging port (port 0:
// Chrome picks a free one and says which), tracked by PID. Never a visible
// window: --headless=new only.
//
// A Page records console errors, uncaught exceptions and failed requests
// (they fail the shard unless a test expects them), answers dialogs
// (confirm(): `page.dialogAnswer`), and drives input the way a person does:
// real mouse events (or touch taps on a phone), typed text, keys.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stop, track } from "./procs.ts";

const CHROMES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean) as string[];

type Waiter = { ok(v: unknown): void; fail(e: Error): void; method: string };
type Listener = (method: string, params: any) => void;

export type View = { width: number; height: number; mobile?: boolean; touch?: boolean; dark?: boolean; dpr?: number };
export const DESKTOP: View = { width: 1366, height: 900 };
export const PHONE: View = { width: 390, height: 844, mobile: true, touch: true, dpr: 3 };

export class Chrome {
  proc!: ChildProcess;
  ws!: WebSocket;
  dir!: string;
  downloads!: string;
  private id = 0;
  private waiting = new Map<number, Waiter>();
  private listeners = new Map<string, Set<Listener>>(); // by sessionId ("" = browser)
  private downloadsSeen: { guid: string; name: string; at: number; state: string }[] = []; // Browser.downloadWillBegin/Progress

  static async launch(): Promise<Chrome> {
    const bin = CHROMES.find((c) => existsSync(c));
    if (!bin) throw new Error("Chrome not found: set CHROME=/path/to/chrome");
    const c = new Chrome();
    c.dir = mkdtempSync(join(tmpdir(), "inquisitor-e2e-chrome-"));
    c.downloads = join(c.dir, "downloads");
    mkdirSync(c.downloads);
    c.proc = track(
      spawn(
        bin,
        [
          "--headless=new",
          "--remote-debugging-port=0",
          `--user-data-dir=${c.dir}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-sync",
          "--disable-default-apps",
          "--disable-component-update",
          "--disable-features=Translate,MediaRouter,OptimizationHints",
          "--password-store=basic",
          "--use-mock-keychain",
          "--mute-audio",
          "--hide-scrollbars",
          "about:blank",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      ),
    );
    const wsUrl = await new Promise<string>((ok, fail) => {
      let err = "";
      const t = setTimeout(() => fail(new Error(`Chrome didn't start: ${err.slice(-1000)}`)), 30_000);
      c.proc.stderr!.on("data", (d) => {
        err += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
        if (m) {
          clearTimeout(t);
          ok(m[1]);
        }
      });
      c.proc.on("exit", () => fail(new Error(`Chrome exited: ${err.slice(-1000)}`)));
    });
    c.proc.stderr!.resume();
    c.ws = new WebSocket(wsUrl);
    await new Promise((ok, fail) => {
      c.ws.addEventListener("open", ok, { once: true });
      c.ws.addEventListener("error", () => fail(new Error("DevTools socket")), { once: true });
    });
    c.ws.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data)) as { id?: number; error?: { message: string }; result?: unknown; method?: string; params?: unknown; sessionId?: string };
      if (m.id !== undefined) {
        const w = c.waiting.get(m.id);
        if (!w) return;
        c.waiting.delete(m.id);
        if (m.error) w.fail(new Error(`${w.method}: ${m.error.message}`));
        else w.ok(m.result);
      } else if (m.method) {
        for (const l of c.listeners.get(m.sessionId ?? "") ?? []) l(m.method, m.params);
      }
    });
    c.on("", (method, p) => {
      if (method === "Browser.downloadWillBegin") c.downloadsSeen.push({ guid: p.guid, name: p.suggestedFilename, at: Date.now(), state: "inProgress" });
      else if (method === "Browser.downloadProgress") {
        const d = c.downloadsSeen.find((x) => x.guid === p.guid);
        if (d) d.state = p.state;
      }
    });
    await c.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: c.downloads, eventsEnabled: true });
    return c;
  }

  /**
   * The file of the first download begun at or after `since` (named `name`
   * when given), once Chrome says it completed, no `.crdownload` is left and
   * its size is non-zero and holds still.
   */
  async download(since: number, name?: string, timeout = 20_000): Promise<string> {
    const t0 = Date.now();
    const tick = () => new Promise((ok) => setTimeout(ok, 100));
    let last = -1;
    for (;;) {
      const d = this.downloadsSeen.find((x) => x.at >= since && (!name || x.name === name));
      if (d?.state === "canceled") throw new Error(`download ${d.name} canceled`);
      if (d?.state === "completed") {
        const file = join(this.downloads, d.name);
        const busy = readdirSync(this.downloads).some((f) => f.endsWith(".crdownload"));
        const size = existsSync(file) ? statSync(file).size : 0;
        if (!busy && size > 0 && size === last) return file;
        last = size;
        if (Date.now() - t0 > timeout) throw new Error(`download ${d.name}: ${size} bytes${busy ? ", a .crdownload left" : ""}`);
      } else if (Date.now() - t0 > timeout) {
        const seen = this.downloadsSeen.filter((x) => x.at >= since).map((x) => `${x.name} (${x.state})`);
        throw new Error(d ? `download ${d.name}: ${d.state}` : `no download${name ? ` named ${name}` : ""}${seen.length ? `; seen: ${seen.join(", ")}` : ""}`);
      }
      await tick();
    }
  }

  send<T = any>(method: string, params: object = {}, sessionId?: string, timeoutMs = 60_000): Promise<T> {
    return new Promise<T>((ok, fail) => {
      const i = ++this.id;
      const t = setTimeout(() => {
        this.waiting.delete(i);
        fail(new Error(`${method}: no answer in ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiting.set(i, { ok: (v) => (clearTimeout(t), ok(v as T)), fail: (e) => (clearTimeout(t), fail(e)), method });
      this.ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(sessionId: string, l: Listener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set();
    this.listeners.set(sessionId, set);
    set.add(l);
    return () => set.delete(l);
  }

  /** A new tab (in its own browser context when `isolated`: separate cookies, as another browser). */
  async newPage(view: View = DESKTOP, opts: { isolated?: boolean } = {}): Promise<Page> {
    const ctx = opts.isolated ? (await this.send<{ browserContextId: string }>("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId : undefined;
    // Its downloads land with the others' (a new context starts with downloads denied).
    if (ctx) await this.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: this.downloads, eventsEnabled: true, browserContextId: ctx });
    const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url: "about:blank", ...(ctx ? { browserContextId: ctx } : {}) });
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const p = new Page(this, sessionId, targetId, view);
    await p.init();
    return p;
  }

  async close(): Promise<void> {
    try {
      await this.send("Browser.close", {}, undefined, 3000);
    } catch {}
    await stop(this.proc);
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export type Problem = { kind: "console" | "exception" | "network" | "log"; text: string; url?: string };

export class Page {
  chrome: Chrome;
  sessionId: string;
  targetId: string;
  view: View;
  problems: Problem[] = [];
  /** Expected failures (a regexp over the text) not counted as problems. */
  allow: RegExp[] = [];
  dialogs: { type: string; message: string }[] = [];
  /** What the next confirm()/prompt() is answered (true: OK). */
  dialogAnswer = true;
  private loads = 0;

  constructor(chrome: Chrome, sessionId: string, targetId: string, view: View) {
    this.chrome = chrome;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.view = view;
  }

  send<T = any>(method: string, params: object = {}, timeoutMs?: number): Promise<T> {
    return this.chrome.send<T>(method, params, this.sessionId, timeoutMs);
  }

  async init(): Promise<void> {
    this.chrome.on(this.sessionId, (method, p) => {
      if (method === "Runtime.exceptionThrown") this.problem({ kind: "exception", text: p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text, url: p.exceptionDetails?.url });
      else if (method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert"))
        this.problem({ kind: "console", text: p.args.map((a: any) => a.value ?? a.description ?? "").join(" ") });
      else if (method === "Log.entryAdded" && p.entry.level === "error") this.problem({ kind: p.entry.source === "network" ? "network" : "log", text: p.entry.text, url: p.entry.url });
      else if (method === "Page.javascriptDialogOpening") {
        this.dialogs.push({ type: p.type, message: p.message });
        void this.send("Page.handleJavaScriptDialog", { accept: this.dialogAnswer }).catch(() => {});
      } else if (method === "Page.loadEventFired") this.loads++;
    });
    await Promise.all([this.send("Runtime.enable"), this.send("Page.enable"), this.send("Log.enable")]);
    await this.setView(this.view);
  }

  private problem(p: Problem): void {
    if (this.allow.some((re) => re.test(`${p.text ?? ""} ${p.url ?? ""}`))) return;
    this.problems.push(p);
  }

  /** Problems so far, cleared. */
  takeProblems(): Problem[] {
    const out = this.problems;
    this.problems = [];
    return out;
  }

  async setView(v: View): Promise<void> {
    this.view = v;
    await this.send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.dpr ?? 1, mobile: !!v.mobile });
    await this.send("Emulation.setTouchEmulationEnabled", v.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: v.dark ? "dark" : "light" }] });
  }

  /** A full document load. */
  async goto(url: string): Promise<void> {
    const before = this.loads;
    const r = await this.send<{ errorText?: string; loaderId?: string }>("Page.navigate", { url });
    if (r.errorText) throw new Error(`navigate ${url}: ${r.errorText}`);
    // No loader: a same-document navigation (only the hash changed), no load event.
    if (r.loaderId) await this.until(() => this.loads > before, 30_000, `load of ${url}`);
  }

  async reload(): Promise<void> {
    const before = this.loads;
    await this.send("Page.reload", {});
    await this.until(() => this.loads > before, 30_000, "reload");
  }

  /** Evaluates `fn(...args)` in the page (args as JSON); awaits a promise. */
  async eval<T = unknown, A extends unknown[] = unknown[]>(fn: string | ((...args: A) => T | Promise<T>), ...args: A): Promise<T> {
    const expression = typeof fn === "string" ? fn : `(${fn.toString()})(...${JSON.stringify(args)})`;
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }

  private async until(cond: () => boolean, ms: number, what: string): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Polls `fn(...args)` in the page until it is truthy; returns its value. */
  async waitFor<T, A extends unknown[] = unknown[]>(fn: (...args: A) => T, args: A = [] as unknown as A, opts: { timeout?: number; what?: string } = {}): Promise<T> {
    const t0 = Date.now();
    const timeout = opts.timeout ?? 15_000;
    let last: unknown;
    for (;;) {
      try {
        const v = await this.eval(fn as (...a: A) => T, ...args);
        if (v) return v;
      } catch (e) {
        last = e;
      }
      if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${opts.what ?? fn.toString().slice(0, 160)}${last ? ` (${(last as Error).message})` : ""}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** The point to tap on the first element matching `selector` (scrolled into view), and whether something else covers it. */
  private async target(selector: string, nth = 0): Promise<{ x: number; y: number }> {
    const r = await this.eval(
      (sel: string, n: number) => {
        // The n-th one shown (kept pages hidden behind the shown one have their own copies).
        const el = [...document.querySelectorAll(sel)].filter((x) => (x as HTMLElement).checkVisibility())[n] as HTMLElement | undefined;
        if (!el) return { error: `no element ${sel}${n ? ` #${n}` : ""}` };
        // Scrolled only when not wholly on screen (a sticky tab is: scrolling it would move the page under it),
        // or when something sticky covers it (the top bar over a row near the top).
        const r0 = el.getBoundingClientRect();
        if (r0.top < 0 || r0.left < 0 || r0.bottom > innerHeight || r0.right > innerWidth) el.scrollIntoView({ block: "center", inline: "center" });
        const covered = () => {
          const b = el.getBoundingClientRect();
          const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return !!t && t !== el && !el.contains(t) && !(t as HTMLElement).closest?.("label")?.contains(el);
        };
        if (covered()) el.scrollIntoView({ block: "center", inline: "center" });
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return { error: `${sel} has no size` };
        const x = b.left + b.width / 2;
        const y = b.top + b.height / 2;
        const top = document.elementFromPoint(x, y);
        if (top && top !== el && !el.contains(top) && !(top as HTMLElement).closest?.("label")?.contains(el))
          return { error: `${sel} is covered by <${top.tagName.toLowerCase()} class="${(top as HTMLElement).className}">` };
        if ((el as HTMLButtonElement).disabled) return { error: `${sel} is disabled` };
        return { x, y };
      },
      selector,
      nth,
    );
    if ("error" in r) throw new Error(String(r.error));
    return r as { x: number; y: number };
  }

  /** Clicks (or taps, on a touch view) the element, as a person would. */
  async click(selector: string, nth = 0): Promise<void> {
    await this.waitFor((sel: string, n: number) => !![...document.querySelectorAll(sel)].filter((x) => (x as HTMLElement).checkVisibility())[n], [selector, nth], { what: selector });
    const { x, y } = await this.target(selector, nth);
    if (this.view.touch) {
      await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    }
  }

  /** A tap (or click) at a point of the viewport. */
  async tap(x: number, y: number): Promise<void> {
    if (this.view.touch) {
      await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    }
  }

  /** Clicks the control with this aria-label. */
  clickLabel(label: string, nth = 0): Promise<void> {
    return this.click(`[aria-label=${JSON.stringify(label)}]`, nth);
  }

  async hover(selector: string): Promise<void> {
    const { x, y } = await this.target(selector);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }

  /** Picks an option of a <select> (by value), firing input and change as a person's pick does. */
  async select(selector: string, value: string): Promise<void> {
    await this.waitFor((sel: string) => !!document.querySelector(sel), [selector], { what: selector });
    const ok = await this.eval(
      (sel: string, v: string) => {
        const el = document.querySelector(sel) as HTMLSelectElement;
        const r0 = el.getBoundingClientRect();
        if (r0.top < 0 || r0.bottom > innerHeight) el.scrollIntoView({ block: "center" });
        if (![...el.options].some((o) => o.value === v)) return false;
        el.focus();
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      selector,
      value,
    );
    if (!ok) throw new Error(`${selector} has no option ${value}`);
  }

  async type(text: string): Promise<void> {
    await this.send("Input.insertText", { text });
  }

  async key(key: "Enter" | "Escape" | "Tab" | "Backspace" | "ArrowLeft" | "ArrowRight", modifiers = 0): Promise<void> {
    const codes = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowLeft: 37, ArrowRight: 39 };
    const base = { key, code: key, windowsVirtualKeyCode: codes[key], modifiers };
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base, ...(key === "Enter" ? { text: "\r" } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  async screenshot(file: string): Promise<string> {
    mkdirSync(dirname(file), { recursive: true });
    const { data } = await this.send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  url(): Promise<string> {
    return this.eval(() => location.href);
  }

  async close(): Promise<void> {
    try {
      await this.chrome.send("Target.closeTarget", { targetId: this.targetId });
    } catch {}
  }
}
