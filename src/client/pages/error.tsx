// A page the server couldn't show (no such character, warband or share
// link, or one that isn't the viewer's): no words (AGENTS.md), only the
// HTTP status under the bar (its tabs are the way home).
import type { PageData } from "../../shared/api.ts";
import { SiteBar } from "../components/SiteBar.tsx";

export function ErrorPage({ data }: { data: PageData }) {
  return (
    <>
      <SiteBar page={null} />
      <main class="error-page">
        {data.status ? <p class="error-status">{data.status}</p> : null}
      </main>
      <style>{`
        .error-page { min-height: calc(100dvh - 49px); display: grid; place-content: center; justify-items: center; gap: 12px; padding: 16px; }
        .error-status { margin: 0; font: 600 40px/1 var(--font-mono); color: var(--ink-3); }
      `}</style>
    </>
  );
}
