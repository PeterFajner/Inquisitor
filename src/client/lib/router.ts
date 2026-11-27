// Moving between the app's pages without loading the document again
// (./routes.ts has the paths). A click on a link to one of them, and back
// and forward, show that page in place (history.pushState, popstate); a
// path that names a record (a character, a share link) gets its
// PageData from GET /api/v1/page first, so a bad one still shows the error
// page. The builder and the rules are kept once shown, hidden while another
// page is (src/client/app.tsx), each with its URL and scroll position as
// left: going back to one ("/", "/rules", a tab) shows it as it was. The
// other pages are made again each time.
//
// Kept pages don't write the address themselves: setUrl changes it while the
// page is shown, else only what the page will be shown at; urlOf reads it.
import { API, type PageData } from "../../shared/api.ts";
import { instanceOf, intercepts, isRoot, routeOf, type PageKind } from "./routes.ts";
import { store } from "./store.ts";

export type PageId = PageKind | "error";
/** A page instance: `seq` goes up each time it's sent somewhere new (another character, a card's address). */
export type Shown = { key: string; page: PageId; data: PageData; seq: number };
/** What a page component is given: its data, its `seq`, and whether it's the page shown. */
export type PageProps = { data: PageData; seq: number; active: boolean };
type State = {
  current: string;
  /** Mounted, in the order they were made (a kept page stays where it is in the DOM). */
  pages: Shown[];
  /** How the current page was reached: a site tab, another link (or navigate()), back/forward; null: the document's load. */
  via: "tab" | "link" | "pop" | null;
  /** Where to scroll once it's shown: its last place (a kept page), or the top; null to leave it. */
  scroll: number | null;
  n: number;
};

export const nav = store<State>({ current: "", pages: [], via: null, scroll: null, n: 0 });

const kept = (p: PageId) => p === "builder" || p === "rules";
const full = () => location.pathname + location.search + location.hash;
/** The current page's URL (path, search, hash). */
let here = "";
/** Kept pages' URLs and scroll positions, as left. */
const urls = new Map<string, string>();
const scrolls = new Map<string, number>();
let account: PageData["account"] = { signed_in: false, public_id: null };
let prepare: (page: PageId) => Promise<unknown> = async () => {};
let token = 0;
const title = typeof document === "undefined" ? "" : document.title;

/** The current page, from the document's PageData; then links and back/forward are handled here. */
export function start(data: PageData, load: (page: PageId) => Promise<unknown>): void {
  prepare = load;
  account = data.account;
  here = full();
  const r = routeOf(location.pathname);
  const page: PageId = data.status || !r ? "error" : r.page;
  const key = data.status || !r ? `error:${location.pathname}` : instanceOf(r, location.pathname, location.search);
  nav.set({ current: key, pages: [{ key, page, data, seq: 0 }], via: null, scroll: null, n: 0 });
  document.addEventListener("click", onClick);
  addEventListener("popstate", () => void go(full(), "pop", "pop"));
}

function onClick(e: MouseEvent) {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement)) return;
  if (!intercepts(e, { href: a.href, target: a.target, download: a.hasAttribute("download") }, location)) return;
  e.preventDefault();
  const u = new URL(a.href);
  void go(u.pathname + u.search + u.hash, "push", a.classList.contains("site-tab") ? "tab" : "link");
}

/** Shows a page of the app (a new history entry, or `replace` the current one). */
export function navigate(url: string, opts: { replace?: boolean } = {}): Promise<void> {
  return go(url, opts.replace ? "replace" : "push", "link");
}

/** A kept page's URL: the address while it's shown, else where it was left. */
export function urlOf(key: string): string {
  return nav.get().current === key ? here : urls.get(key) ?? "";
}

/** A kept page's new URL: the address if it's shown (a new entry with `push`), else only remembered. */
export function setUrl(key: string, url: string, opts: { push?: boolean } = {}): void {
  if (nav.get().current !== key) {
    urls.set(key, url);
    return;
  }
  if (url === here) return;
  if (opts.push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
  here = url;
}

async function pageData(pathname: string): Promise<PageData | null> {
  try {
    const res = await fetch(`${API}/page?path=${encodeURIComponent(pathname)}`, { credentials: "same-origin" });
    if (!res.ok) return null;
    return { ...((await res.json()) as PageData), account };
  } catch {
    return null;
  }
}

const pathOf = (url: string) => url.replace(/#.*$/, "");

async function go(to: string, mode: "push" | "replace" | "pop", via: State["via"]): Promise<void> {
  const u = new URL(to, location.origin);
  const r = routeOf(u.pathname);
  const fallback = () => (mode === "pop" ? location.reload() : location.assign(u.href));
  if (!r) return fallback();
  const n = ++token;
  const s = nav.get();
  const leaving = s.current;
  const key = instanceOf(r, u.pathname, u.search);
  const alive = s.pages.find((p) => p.key === key);
  let path = u.pathname + u.search + u.hash;
  // A kept page's root: the page as it was left.
  if (alive && isRoot(u.pathname) && !u.hash) path = (key === leaving ? here : urls.get(key)) ?? path;
  const at = key === leaving ? here : urls.get(key);
  if (key === leaving && path === here) return;
  // The same page at another hash: the rules page goes there; the others only keep the address.
  if (key === leaving && r.page !== "rules" && pathOf(path) === pathOf(here)) {
    if (mode !== "pop") history.pushState(null, "", path);
    here = path;
    return;
  }

  let next: Shown;
  if (alive && path === at) next = alive;
  else if (r.needsData) {
    const data = await pageData(u.pathname);
    if (n !== token) return;
    if (!data) return fallback();
    next = data.status ? { key: `error:${u.pathname}`, page: "error", data, seq: 0 } : { key, page: r.page, data, seq: (alive?.seq ?? -1) + 1 };
  } else next = { key, page: r.page, data: alive?.data ?? { account }, seq: (alive?.seq ?? -1) + 1 };
  await prepare(next.page);
  if (n !== token) return;

  if (next.key !== leaving) {
    urls.set(leaving, here);
    scrolls.set(leaving, window.scrollY);
  }
  if (mode === "push") history.pushState(null, "", path);
  else if (mode === "replace" || path !== full()) history.replaceState(null, "", path);
  here = path;
  // Scrolling is the pages' and this router's from now on (the rules page sets this itself too).
  history.scrollRestoration = "manual";
  const pages = s.pages.filter((p) => p.key === next.key || kept(p.page)).map((p) => (p.key === next.key ? next : p));
  if (!pages.includes(next)) pages.push(next);
  const scroll = next.key === leaving ? null : kept(next.page) ? scrolls.get(next.key) ?? 0 : 0;
  nav.set({ current: next.key, pages, via, scroll, n: s.n + 1 });
  document.title = title;
}
