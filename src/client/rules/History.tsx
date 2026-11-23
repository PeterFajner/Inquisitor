// A card's history: every version of its file, newest first, each with its
// editor's public id (the book icon for the transcription), when, and a
// compact diff against the version before it; signed in, any older version
// can be restored (a new commit).
import { fullTime } from "../history/summary.ts";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ArrowRight, BookOpen, FilePlus, FileX, Move, RotateCcw, UserRound, X } from "lucide-preact";
import type { EntryVersion } from "../../shared/api.ts";
import type { Entry } from "../../shared/rules/schema.ts";
import { useStore } from "../lib/store.ts";
import { EffectChip, KIND_ICON, KIND_LABEL } from "./chips/index.ts";
import { ctxOf, type Names, type RefKind } from "./ctx.ts";
import { diffEntries, textDiff, type Change } from "./diff.ts";
import { L } from "./labels.ts";
import { history, parseKey, revertEntry, rules, type Key } from "./model.ts";

const show = (v: unknown): string =>
  v === undefined || v === null ? "–" : typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);

function ChangeView({ c, before, after, names }: { c: Change; before: Entry | null; after: Entry | null; names: Names }) {
  const ctxB = useMemo(() => (before ? ctxOf(before, names) : null), [before, names]);
  const ctxA = useMemo(() => (after ? ctxOf(after, names) : null), [after, names]);
  switch (c.type) {
    case "created":
      return (
        <div class="chg">
          <span class="ci" role="img" aria-label={L.created} title={L.created}>
            <FilePlus size={14} aria-hidden="true" />
          </span>
        </div>
      );
    case "deleted":
      return (
        <div class="chg">
          <span class="ci" role="img" aria-label={L.deleted} title={L.deleted}>
            <FileX size={14} aria-hidden="true" />
          </span>
        </div>
      );
    case "pos":
      return (
        <div class="chg">
          <span class="ci" role="img" aria-label={L.moved} title={L.moved}>
            <Move size={14} aria-hidden="true" />
          </span>
        </div>
      );
    case "value":
      if (typeof c.before === "string" && typeof c.after === "string" && (c.before.length > 60 || c.after.length > 60)) {
        const d = textDiff(c.before, c.after);
        return (
          <div class="chg">
            {c.label && <span class="chg-label">{c.label}</span>}
            <span class="chg-text">
              {d.before}
              {d.removed && <del class="del">{d.removed}</del>}
              {d.added && <ins class="ins">{d.added}</ins>}
              {d.after}
            </span>
          </div>
        );
      }
      return (
        <div class="chg">
          {c.label && <span class="chg-label">{c.label}</span>}
          <span class="del" title={c.field}>
            {show(c.before)}
          </span>
          <ArrowRight class="dim" size={12} aria-hidden="true" />
          <span class="ins" title={c.field}>
            {show(c.after)}
          </span>
        </div>
      );
    case "stats":
      return (
        <div class="chg">
          <span class="chg-label">{c.label}</span>
          {c.stats.map((s) => (
            <span class="chg-stat">
              {s.stat} <span class="del">{show(s.before)}</span>
              <ArrowRight class="dim" size={12} aria-hidden="true" />
              <span class="ins">{show(s.after)}</span>
            </span>
          ))}
        </div>
      );
    case "effects":
      return (
        <div class="chg">
          {c.label && <span class="chg-label">{c.label}</span>}
          <span class="flow">
            {ctxB && c.removed.map((e) => <span class="del-chip"><EffectChip e={e} ctx={ctxB} /></span>)}
            {ctxA && c.added.map((e) => <span class="ins-chip"><EffectChip e={e} ctx={ctxA} /></span>)}
          </span>
        </div>
      );
  }
}

export function HistoryPanel(p: { cardKey: Key; names: Names; signedIn: boolean; onClose: () => void }) {
  const { pack, kind, id } = parseKey(p.cardKey);
  const [commits, setCommits] = useState<EntryVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const s = useStore(rules);
  const live = s.items.get(p.cardKey);
  const liveCommit = live?.meta?.commit ?? null;

  useEffect(() => {
    let stop = false;
    history(pack, kind, id).then((h) => {
      if (stop) return;
      if (h) setCommits(h.commits);
      else setFailed(true);
    });
    return () => {
      stop = true;
    };
  }, [p.cardKey, liveCommit]);

  const KindIcon = KIND_ICON[kind as RefKind] ?? BookOpen;
  const revert = async (commit: string) => {
    setBusy(commit);
    const r = await revertEntry(pack, kind, id, commit, liveCommit);
    setBusy(null);
    if (!r.ok) setFailed(true);
  };

  return (
    <aside class="rules-panel history" aria-label={L.history}>
      <header class="panel-head">
        <span class="kind-ic" role="img" aria-label={KIND_LABEL[kind as RefKind] ?? kind} title={KIND_LABEL[kind as RefKind] ?? kind}>
          <KindIcon size={18} aria-hidden="true" />
        </span>
        <h2 class="panel-title">{live?.entry.name ?? id}</h2>
        <button type="button" class="icon-btn" aria-label={L.close} title={L.close} onClick={p.onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div class="panel-body" aria-busy={!commits && !failed}>
        <ol class="versions">
          {(commits ?? []).map((c, i) => {
            const older = commits![i + 1];
            const changes = diffEntries(older ? older.entry : null, c.entry);
            const book = c.author === "transcription";
            return (
              <li class={`version${c.commit === liveCommit ? " current" : ""}`}>
                <div class="version-head">
                  <span class="author" role="img" aria-label={book ? L.transcription : c.author} title={book ? L.transcription : c.author}>
                    {book ? <BookOpen size={14} aria-hidden="true" /> : <UserRound size={14} aria-hidden="true" />}
                  </span>
                  {!book && <span class="mono author-id">{c.author}</span>}
                  <time dateTime={c.at}>{fullTime(c.at)}</time>
                  <span class="sp" />
                  {p.signedIn && c.commit !== liveCommit && (
                    <button type="button" class="icon-btn icon-sm" aria-label={L.revert} title={L.revert} disabled={!!busy} aria-busy={busy === c.commit} onClick={() => revert(c.commit)}>
                      <RotateCcw size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div class="changes">
                  {changes.map((ch) => (
                    <ChangeView c={ch} before={older?.entry ?? null} after={c.entry} names={p.names} />
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
