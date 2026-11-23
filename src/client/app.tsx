// The app's one entry (scripts/client.ts ENTRIES.app). The server picks what
// a path shows and sends it as PageData (src/shared/api.ts); this mounts the
// matching page. Pages are loaded on demand so the canvas code isn't in the
// builder's bundle.
import { render, type ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { PageData } from "../shared/api.ts";
import { account } from "./lib/account.ts";
import { pageData } from "./lib/api.ts";
import { Mosaic } from "./components/Mosaic.tsx";
import "./styles/base.css";

const data = pageData<PageData>() ?? { account: { signed_in: false, public_id: null } };
if (data.account) account.set({ signedIn: data.account.signed_in, publicId: data.account.public_id });

type Page = ComponentType<{ data: PageData }>;

function load(): Promise<Page> {
  if (data.status) return import("./pages/error.tsx").then((m) => m.ErrorPage);
  if (data.view === "rules") return import("./pages/rules.tsx").then((m) => m.RulesPage);
  if (data.view === "history") return import("./pages/history.tsx").then((m) => m.HistoryPage);
  if (data.warband) return import("./pages/warband.tsx").then((m) => m.WarbandPage);
  return import("./pages/builder.tsx").then((m) => m.BuilderPage); // "/", /c/<id>, /s/<token>
}

function App() {
  const [Page, setPage] = useState<Page | null>(null);
  useEffect(() => {
    load().then((p) => setPage(() => p));
  }, []);
  return (
    <>
      <Mosaic />
      {Page ? <Page data={data} /> : <main class="loading" aria-busy="true" />}
    </>
  );
}

render(<App />, document.getElementById("app")!);
