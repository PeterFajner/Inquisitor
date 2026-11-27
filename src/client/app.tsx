// The app's one entry (scripts/client.ts ENTRIES.app). The server picks what
// a path shows and sends it as PageData (src/shared/api.ts); this mounts the
// matching page, and from then on the router (./lib/router.ts) moves between
// pages in place: the builder and the rules stay mounted once shown, hidden
// (.page-away) while another page is. Pages are loaded on demand so the
// canvas code isn't in the builder's bundle.
import { render, type ComponentType } from "preact";
import { useEffect, useLayoutEffect, useReducer, useRef } from "preact/hooks";
import type { PageData } from "../shared/api.ts";
import { account } from "./lib/account.ts";
import { pageData } from "./lib/api.ts";
import { nav, start, type PageId, type PageProps } from "./lib/router.ts";
import { useStore } from "./lib/store.ts";
import { Mosaic } from "./components/Mosaic.tsx";
import "./styles/base.css";

const data = pageData<PageData>() ?? { account: { signed_in: false, public_id: null } };
if (data.account) account.set({ signedIn: data.account.signed_in, publicId: data.account.public_id });

type Page = ComponentType<PageProps>;

const LOAD: Record<PageId, () => Promise<Page>> = {
  error: () => import("./pages/error.tsx").then((m) => m.ErrorPage),
  rules: () => import("./pages/rules.tsx").then((m) => m.RulesPage),
  history: () => import("./pages/history.tsx").then((m) => m.HistoryPage),
  share: () => import("./pages/share.tsx").then((m) => m.SharePage),
  builder: () => import("./pages/builder.tsx").then((m) => m.BuilderPage), // "/", /c/<id>
};
const loaded = new Map<PageId, Page>();
const prepare = async (page: PageId) => {
  if (!loaded.has(page)) loaded.set(page, await LOAD[page]());
};

start(data, prepare);

function App() {
  const s = useStore(nav);
  const [, bump] = useReducer((n: number, _: void) => n + 1, 0);
  const first = s.pages[0]?.page;
  useEffect(() => {
    if (first) void prepare(first).then(() => bump());
  }, []);
  const hosts = useRef(new Map<string, HTMLElement | null>());

  // A page reached in place: its place, and the focus moved into it (to its tab, from a tab; else to its main region).
  useLayoutEffect(() => {
    if (!s.n) return;
    if (s.scroll !== null) window.scrollTo(0, s.scroll);
    const host = hosts.current.get(s.current);
    if (!host || !s.via) return;
    const to = (s.via === "tab" && host.querySelector<HTMLElement>('.site-tab[aria-current="page"]')) || host.querySelector<HTMLElement>("main") || host;
    if (to.tabIndex < 0 && !to.hasAttribute("tabindex")) to.setAttribute("tabindex", "-1");
    to.focus({ preventScroll: true });
  }, [s.n]);

  const ready = s.pages.every((p) => loaded.has(p.page));
  return (
    <>
      <Mosaic />
      {!ready && <main class="loading" aria-busy="true" />}
      {ready && s.pages.map((p) => {
        const P = loaded.get(p.page)!;
        const on = p.key === s.current;
        return (
          <div
            key={p.key}
            class={on ? "page" : "page page-away"}
            aria-hidden={on ? undefined : "true"}
            ref={(el) => {
              if (el) hosts.current.set(p.key, el);
              else hosts.current.delete(p.key);
            }}
          >
            <P data={p.data} seq={p.seq} active={on} />
          </div>
        );
      })}
    </>
  );
}

render(<App />, document.getElementById("app")!);
