// The app's paths, and which link clicks stay in the page (./router.ts):
// pure, so the tests can run them without a browser.
//
//   /, /c/<id>, /w/<id>   the builder (one page: the character or warband it shows)
//   /rules                the rules
//   /c/<id>/history       a character's history
//   /s/<token>            a share link
//
// The builder and the rules are kept (mounted, hidden, once shown); the
// others are made again each time. A path needs its PageData from the server
// (GET /api/v1/page) when it names a record; "/" and "/rules" need only the
// account, which the app already has.

export type PageKind = "builder" | "rules" | "history" | "share";
export type Route = { page: PageKind; kept: boolean; needsData: boolean };

const ROUTES: [RegExp, PageKind, boolean][] = [
  [/^\/$/, "builder", false],
  [/^\/c\/[^/]+\/?$/, "builder", true],
  [/^\/w\/[^/]+\/?$/, "builder", true],
  [/^\/rules\/?$/, "rules", false],
  [/^\/c\/[^/]+\/history\/?$/, "history", true],
  [/^\/s\/[^/]+\/?$/, "share", true],
];

/** The page a path shows; null for one that isn't the app's (the server's 404, /api, /static). */
export function routeOf(pathname: string): Route | null {
  for (const [re, page, needsData] of ROUTES)
    if (re.test(pathname)) return { page, kept: page === "builder" || page === "rules", needsData };
  return null;
}

/** Which page instance a URL is shown in: the kept pages have one each; the others one per path. */
export function instanceOf(route: Route, pathname: string, search: string): string {
  return route.kept ? route.page : `${route.page}:${pathname}${search}`;
}

/** A kept page's own root ("/", "/rules"): going there shows the page as it was left. */
export const isRoot = (pathname: string): boolean => pathname === "/" || /^\/rules\/?$/.test(pathname);

type Click = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };
type Link = { href: string; target: string; download: boolean };
type Here = { origin: string; pathname: string; search: string };

/**
 * Whether a click on a link becomes a client-side navigation: a plain
 * left click (no modifier: those open a new tab or window, or download),
 * not already handled, on a link to one of the app's pages on this origin,
 * meant for this window. A link to a hash on this page is left to the
 * browser: it stays within the page (the rules page's cards, a history's
 * versions).
 */
export function intercepts(e: Click, a: Link, here: Here): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (a.download || (a.target && a.target !== "_self")) return false;
  let url: URL;
  try {
    url = new URL(a.href, here.origin);
  } catch {
    return false;
  }
  if (url.origin !== here.origin) return false;
  // (The same page without a hash, though, would load the document again.)
  if (url.pathname === here.pathname && url.search === here.search && a.href.includes("#")) return false;
  return routeOf(url.pathname) !== null;
}
