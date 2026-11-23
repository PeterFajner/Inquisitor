// A page the server couldn't show (no such character, warband or share
// link, or one that isn't the viewer's): no words (AGENTS.md), only the
// HTTP status and the way home.
import type { PageData } from "../../shared/api.ts";

export function ErrorPage({ data }: { data: PageData }) {
  return (
    <main class="error-page">
      <a href="/" aria-label="Inquisitor" title="Inquisitor">
        <img src="/static/icon.svg" alt="" width={56} height={56} />
      </a>
      {data.status ? <p class="error-status">{data.status}</p> : null}
      <style>{`
        .error-page { min-height: 100vh; min-height: 100dvh; display: grid; place-content: center; justify-items: center; gap: 12px; padding: 16px; }
        .error-status { margin: 0; font: 600 40px/1 var(--font-mono); color: var(--ink-3); }
      `}</style>
    </main>
  );
}
