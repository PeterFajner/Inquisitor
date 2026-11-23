// A character's history: its version tree on the canvas (src/client/canvas),
// root at the left, branches fanning out to the right, a wire from each
// version to the next. Each version is a card: what made it, who, when, the
// sheet's Starting row (values that changed since its parent marked good or
// bad), what it gained and lost, and its balance label. The current version
// (the head) is marked and the path to it drawn in the accent colour.
// Icons on each card make it the head, open it in the builder, compare it
// with the head (a panel, in the book's terms) or duplicate it.
//
// Used by /c/<id>/history (src/client/pages/history.tsx) and embeddable in
// the builder for characters kept in this browser: it only shows; the
// caller does the saving through the callbacks.
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ArchiveRestore,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CircleCheck,
  Copy,
  CopyPlus,
  Dice5,
  Dices,
  Equal,
  GitCompareArrows,
  Import,
  Link as LinkIcon,
  ListChecks,
  Minus,
  PenLine,
  Pencil,
  Plus,
  Sparkles,
  SquarePen,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-preact";
import type { EditKind, Version } from "../../shared/api.ts";
import { powerScore, type Distribution } from "../../shared/engine/balance.ts";
import type { Character as Built } from "../../shared/engine/build.ts";
import { SHEET_STATS } from "../../shared/sheet.ts";
import * as ops from "../builder/ops.ts";
import { Canvas, type CanvasApi, type CanvasCard, type CanvasWire, type Size } from "../canvas/index.ts";
import { balanceText, distribution, type Balance } from "../lib/balance.ts";
import { rulesAt, type Rules } from "../lib/rules.ts";
import { H, KIND } from "./labels.ts";
import { compare, fullTime, summarize, thingText, when, type Comparison, type Summary } from "./summary.ts";
import { tidyTree } from "./tree.ts";
import "./history.css";

export type HistoryViewProps = {
  /** Every version of the character (a tree by parent_id), oldest first. */
  versions: readonly Version[];
  /** The current version. */
  headId: string;
  /** The current rules. A version is shown under the rules it was built with when this browser kept them. Null while loading. */
  rules: Rules | null;
  /** Make a version the head. Absent: no such icon (read-only). */
  onSetHead?: (versionId: string) => void | Promise<void>;
  /** Open a version in the builder (edits there branch from it). */
  onOpen?: (versionId: string) => void;
  /** Duplicate a version into a new character. */
  onDuplicate?: (versionId: string) => void | Promise<void>;
  /** Where a duplicate's source version is (a link on the first card), or null when unknown. */
  sourceHref?: (sourceVersionId: string) => Promise<string | null>;
  /** Instead of a link: what to do when the source icon is pressed. */
  onSource?: (sourceVersionId: string) => void;
  /** A version to select and show first (else the head, or everything when it all fits). */
  focus?: string | null;
  /** A save is under way: the icons that save are disabled. */
  busy?: boolean;
  class?: string;
};

const KIND_ICON: Record<EditKind, LucideIcon> = {
  roll: Dice5,
  choice: ListChecks,
  override: PenLine,
  reroll: Dices,
  luna: Sparkles,
  manual: Pencil,
  import: Import,
  duplicate: Copy,
};

const CARD_W = 288;
const EST_H = 230;
const MAX_THINGS = 6;
const CANVAS_LABELS = { zoomIn: H.zoomIn, zoomOut: H.zoomOut, fit: H.fit, minimap: H.minimap, canvas: H.history };

type Shown = { summary: Summary | null; built: Built | null; rules: Rules | null };

type CardData = CanvasCard & {
  v: Version;
  summary: Summary | null;
  /** Against its parent (null for the first version or one that couldn't be built). */
  diff: Comparison | null;
  head: boolean;
  root: boolean;
  balance: Balance | null;
};

/** The versions on the path from the root to `id` (both included). */
export function pathTo(versions: readonly Version[], id: string): Set<string> {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const out = new Set<string>();
  let cur = byId.get(id);
  while (cur && !out.has(cur.id)) {
    out.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

const iconProps = (label: string) => ({ "aria-label": label, role: "img" as const });

function StatGrid({ s, diff }: { s: Summary; diff: Comparison | null }) {
  const changed = new Map(diff?.stats.map((c) => [c.stat, c]) ?? []);
  return (
    <dl class="hv-stats">
      {SHEET_STATS.map((stat) => {
        const c = changed.get(stat);
        const cls = c ? (c.dir > 0 ? " up" : c.dir < 0 ? " down" : " moved") : "";
        return (
          <div class={`hv-stat${cls}`} title={c ? `${c.from} → ${c.to}` : undefined}>
            <dt>{stat}</dt>
            <dd>
              {s.stats[stat]}
              {c && c.dir > 0 && <ArrowUp size={10} aria-hidden="true" class="hv-dir" />}
              {c && c.dir < 0 && <ArrowDown size={10} aria-hidden="true" class="hv-dir" />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Things({ diff }: { diff: Comparison }) {
  if (!diff.gained.length && !diff.lost.length) return null;
  const row = (list: Comparison["gained"], cls: string, label: string, Icon: typeof Plus) => {
    if (!list.length) return null;
    const shown = list.slice(0, MAX_THINGS);
    const more = list.length - shown.length;
    return (
      <li class={cls}>
        <Icon size={14} {...iconProps(label)} />
        <span>
          {shown.map(thingText).join(", ")}
          {more > 0 ? ` +${more}` : ""}
        </span>
      </li>
    );
  };
  return (
    <ul class="hv-things">
      {row(diff.gained, "gain", H.gained, Plus)}
      {row(diff.lost, "loss", H.lost, Minus)}
    </ul>
  );
}

function SourceLink({ id, href, onSource }: { id: string; href?: (id: string) => Promise<string | null>; onSource?: (id: string) => void }) {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (href) void href(id).then((h) => live && setTo(h));
    return () => {
      live = false;
    };
  }, [id, href]);
  if (onSource)
    return (
      <button type="button" class="icon-btn hv-btn" aria-label={H.source} title={H.source} onClick={() => onSource(id)}>
        <LinkIcon size={18} />
      </button>
    );
  if (!to) return null;
  return (
    <a class="icon-btn hv-btn" href={to} aria-label={H.source} title={H.source}>
      <LinkIcon size={18} />
    </a>
  );
}

type Actions = {
  setHead?: (id: string) => void;
  open?: (id: string) => void;
  compare: (id: string) => void;
  duplicate?: (id: string) => void;
  sourceHref?: (id: string) => Promise<string | null>;
  onSource?: (id: string) => void;
  busy: boolean;
  comparing: string | null;
};

function VersionCard({ d, a, now }: { d: CardData; a: Actions; now: number }) {
  const v = d.v;
  const KindIcon = KIND_ICON[v.kind] ?? Pencil;
  const s = d.summary;
  const showName = s && (d.root || d.diff?.name);
  const showTag = s && (d.root || d.diff?.tag);
  const btn = (label: string, Icon: typeof ArchiveRestore, onClick: () => void, opts: { disabled?: boolean; pressed?: boolean } = {}) => (
    <button
      type="button"
      class="icon-btn hv-btn"
      aria-label={label}
      title={label}
      disabled={opts.disabled}
      aria-pressed={opts.pressed === undefined ? undefined : opts.pressed}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon size={18} />
    </button>
  );
  return (
    <article class={`hv-card${d.head ? " is-head" : ""}`}>
      <header class="hv-meta">
        <KindIcon size={16} {...iconProps(KIND[v.kind] ?? v.kind)} />
        <time datetime={v.created_at} title={fullTime(v.created_at)} aria-label={`${H.when}: ${fullTime(v.created_at)}`}>
          {when(v.created_at, now)}
        </time>
        {v.author && (
          <span class="hv-author" title={v.author} aria-label={`${H.author}: ${v.author}`}>
            <UserRound size={13} aria-hidden="true" />
            <span>{v.author}</span>
          </span>
        )}
        {d.head && (
          <span class="hv-head-mark" title={H.head}>
            <CircleCheck size={16} {...iconProps(H.head)} />
          </span>
        )}
      </header>
      {showName && s.name && <p class="hv-name">{s.name}</p>}
      {showTag && <p class="hv-tag">{[s.tag, s.alignment].filter(Boolean).join(", ")}</p>}
      {!showTag && s && d.diff?.alignment && <p class="hv-tag">{s.alignment ?? "–"}</p>}
      {s && <StatGrid s={s} diff={d.diff} />}
      {d.diff && <Things diff={d.diff} />}
      {d.balance && (
        <p class="hv-balance-line">
          <span class={`hv-balance hv-balance-${d.balance.word}`} aria-label={`${H.balance}: ${d.balance.text}`}>
            {d.balance.text}
          </span>
        </p>
      )}
      <footer class="hv-actions">
        {a.setHead && !d.head && btn(H.makeHead, ArchiveRestore, () => a.setHead!(v.id), { disabled: a.busy })}
        {a.open && btn(H.builder, SquarePen, () => a.open!(v.id), { disabled: a.busy })}
        {!d.head && btn(H.compare, GitCompareArrows, () => a.compare(v.id), { pressed: a.comparing === v.id })}
        {a.duplicate && btn(H.duplicate, CopyPlus, () => a.duplicate!(v.id), { disabled: a.busy })}
        {v.kind === "duplicate" && v.source_id && <SourceLink id={v.source_id} href={a.sourceHref} onSource={a.onSource} />}
      </footer>
    </article>
  );
}

function ComparePanel({ from, to, onClose, now }: { from: CardData; to: CardData; onClose: () => void; now: number }) {
  const c = from.summary && to.summary ? compare(from.summary, to.summary) : null;
  const side = (d: CardData) => {
    const Icon = KIND_ICON[d.v.kind] ?? Pencil;
    return (
      <span class="hv-cmp-side">
        <Icon size={16} {...iconProps(KIND[d.v.kind] ?? d.v.kind)} />
        {d.head && <CircleCheck size={16} {...iconProps(H.head)} />}
        <time datetime={d.v.created_at} title={fullTime(d.v.created_at)}>
          {when(d.v.created_at, now)}
        </time>
      </span>
    );
  };
  const arrow = <ArrowRight size={13} aria-hidden="true" />;
  const list = (names: string[], cls: string, label: string, Icon: typeof Plus) =>
    names.map((n) => (
      <li class={cls}>
        <Icon size={14} {...iconProps(label)} /> {n}
      </li>
    ));
  return (
    <section class="hv-compare" aria-label={H.compare}>
      <header class="hv-cmp-head">
        {side(from)}
        {arrow}
        {side(to)}
        <span class="hv-gap" />
        <button type="button" class="icon-btn" aria-label={H.close} title={H.close} onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {c && !c.changed && (
        <div class="hv-cmp-body hv-same">
          <Equal size={20} {...iconProps(H.same)} />
        </div>
      )}
      {c && c.changed && (
        <div class="hv-cmp-body">
          {c.stats.length > 0 && (
            <table class="hv-cmp-stats">
              <tbody>
                {c.stats.map((s) => (
                  <tr class={s.dir > 0 ? "up" : s.dir < 0 ? "down" : ""}>
                    <th scope="row">{s.stat}</th>
                    <td>{s.from}</td>
                    <td>{arrow}</td>
                    <td class="to">
                      {s.to}
                      {s.dir > 0 && <ArrowUp size={12} aria-hidden="true" class="hv-dir" />}
                      {s.dir < 0 && <ArrowDown size={12} aria-hidden="true" class="hv-dir" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ul class="hv-cmp-list">
            {c.name && (
              <li>
                {c.name.from || "–"} {arrow} {c.name.to || "–"}
              </li>
            )}
            {c.tag && (
              <li>
                {c.tag.from} {arrow} {c.tag.to}
              </li>
            )}
            {c.alignment && (
              <li>
                {c.alignment.from ?? "–"} {arrow} {c.alignment.to ?? "–"}
              </li>
            )}
            {list([...c.gained.map(thingText), ...c.options.gained, ...c.rolls.gained], "gain", H.gained, Plus)}
            {list([...c.lost.map(thingText), ...c.options.lost, ...c.rolls.lost], "loss", H.lost, Minus)}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The rules each version was built with, when this browser kept them. */
function usePinned(rules: Rules | null, versions: readonly Version[]): Map<string, Rules> {
  const [pinned, setPinned] = useState<Map<string, Rules>>(new Map());
  const wanted = useMemo(
    () => [...new Set(versions.map((v) => v.rules_version).filter((x): x is string => !!x && x !== rules?.version))].sort().join("\n"),
    [versions, rules?.version],
  );
  useEffect(() => {
    let live = true;
    const ids = wanted ? wanted.split("\n") : [];
    void Promise.all(ids.map((id) => rulesAt(id).catch(() => null))).then((rs) => {
      if (!live) return;
      const m = new Map<string, Rules>();
      for (const r of rs) if (r) m.set(r.version, r);
      setPinned(m);
    });
    return () => {
      live = false;
    };
  }, [wanted]);
  return pinned;
}

export function HistoryView(p: HistoryViewProps) {
  const { versions, headId, rules } = p;
  const api = useRef<CanvasApi | null>(null);
  const [selected, setSelected] = useState<string | null>(p.focus ?? null);
  const [comparing, setComparing] = useState<string | null>(null);
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const [dists, setDists] = useState<ReadonlyMap<string, Distribution>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const pinned = usePinned(rules, versions);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Each version built under its rules.
  const shown = useMemo(() => {
    const out = new Map<string, Shown>();
    for (const v of versions) {
      const r = (v.rules_version && pinned.get(v.rules_version)) || rules;
      const rec = ops.engineRecord(v.record);
      let built: Built | null = null;
      if (r && rec) {
        try {
          built = ops.view(r.compendium, rec).character;
        } catch {}
      }
      out.set(v.id, { summary: built ? summarize(built) : null, built, rules: r });
    }
    return out;
  }, [versions, pinned, rules]);

  // Balance distributions, one per rules version, archetype and subtype.
  useEffect(() => {
    let live = true;
    const asks = new Map<string, { r: Rules; a: string; s: string }>();
    for (const x of shown.values()) {
      if (!x.built || !x.rules) continue;
      const key = `${x.rules.version}|${x.built.archetype.id}/${x.built.subtype.id}`;
      if (!dists.has(key)) asks.set(key, { r: x.rules, a: x.built.archetype.id, s: x.built.subtype.id });
    }
    for (const [key, q] of asks)
      void distribution(q.r, q.a, q.s).then((d) => {
        if (live && d) setDists((m) => new Map(m).set(key, d));
      });
    return () => {
      live = false;
    };
  }, [shown]);

  const layout = useMemo(
    () =>
      tidyTree(
        versions.map((v) => ({ id: v.id, parent: v.parent_id, h: sizes.get(v.id)?.h ?? EST_H })),
        { w: CARD_W, gapX: 56, gapY: 24 },
      ),
    [versions, sizes],
  );

  const cards: CardData[] = useMemo(() => {
    const ids = new Set(versions.map((v) => v.id));
    return versions.map((v) => {
      const x = shown.get(v.id)!;
      const parent = v.parent_id && ids.has(v.parent_id) ? shown.get(v.parent_id)!.summary : null;
      const pos = layout.positions.get(v.id)!;
      let balance: Balance | null = null;
      if (x.built && x.rules) {
        const d = dists.get(`${x.rules.version}|${x.built.archetype.id}/${x.built.subtype.id}`);
        if (d) balance = balanceText(powerScore(x.built, x.rules.compendium), d, x.rules.compendium.archetypes.get(x.built.archetype.id)?.characters ?? x.built.archetype.name, x.built.subtype.name);
      }
      return {
        id: v.id,
        x: pos.x,
        y: pos.y,
        w: CARD_W,
        h: EST_H,
        label: `${KIND[v.kind] ?? v.kind} ${fullTime(v.created_at)}`,
        v,
        summary: x.summary,
        diff: parent && x.summary ? compare(parent, x.summary) : null,
        head: v.id === headId,
        root: !v.parent_id || !ids.has(v.parent_id),
        balance,
      };
    });
  }, [versions, shown, layout, dists, headId]);

  const onHeadPath = useMemo(() => pathTo(versions, headId), [versions, headId]);
  const wires: CanvasWire[] = useMemo(() => {
    const ids = new Set(versions.map((v) => v.id));
    return versions
      .filter((v) => v.parent_id && ids.has(v.parent_id))
      .map((v) => ({
        from: v.parent_id!,
        to: v.id,
        fromSide: "right" as const,
        toSide: "left" as const,
        class: onHeadPath.has(v.id) ? "hv-wire-head" : undefined,
      }));
  }, [versions, onHeadPath]);

  // The callbacks, through a ref so renderCard stays the same function.
  const actions = useRef<Actions>(null as unknown as Actions);
  actions.current = {
    setHead: p.onSetHead ? (id) => void p.onSetHead!(id) : undefined,
    open: p.onOpen,
    duplicate: p.onDuplicate ? (id) => void p.onDuplicate!(id) : undefined,
    compare: (id) => setComparing((c) => (c === id ? null : id)),
    sourceHref: p.sourceHref,
    onSource: p.onSource,
    busy: !!p.busy,
    comparing,
  };
  // Cards re-render when their object changes: busy/comparing/now go in the object's identity via this key.
  const tick = `${p.busy ? 1 : 0}|${comparing}|${now}|${!!p.onSetHead}|${!!p.onOpen}|${!!p.onDuplicate}`;
  const keyed = useMemo(() => cards.map((c) => ({ ...c })), [cards, tick]);
  const renderCard = useCallback((card: CanvasCard) => <VersionCard d={card as CardData} a={actions.current} now={Date.now()} />, []);

  // The first view: everything when it fits at a readable zoom, else the focus (or the head).
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !api.current || !versions.length) return;
    if (sizes.size < versions.length) return;
    placed.current = true;
    const target = p.focus && versions.some((v) => v.id === p.focus) ? p.focus : null;
    const s = api.current.size();
    const b = layout.bounds;
    const fitK = Math.min((s.w - 128) / Math.max(1, b.w), (s.h - 128) / Math.max(1, b.h));
    if (target || fitK < 0.6) api.current.flyTo(target ?? headId, { instant: true, maxZoom: 1, pad: 56 });
    else api.current.fit({ instant: true, maxZoom: 1 });
  }, [sizes, versions.length, layout]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const cmpFrom = comparing ? byId.get(comparing) : undefined;
  const cmpTo = byId.get(headId);

  return (
    <div class={`hv${p.class ? ` ${p.class}` : ""}${cmpFrom ? " is-comparing" : ""}`}>
      <Canvas
        cards={keyed}
        wires={wires}
        renderCard={renderCard}
        selected={selected}
        onSelect={setSelected}
        measure
        onMeasure={(s) => setSizes(new Map(s))}
        apiRef={api}
        labels={CANVAS_LABELS}
      />
      {cmpFrom && cmpTo && cmpFrom.id !== cmpTo.id && <ComparePanel from={cmpFrom} to={cmpTo} now={now} onClose={() => setComparing(null)} />}
    </div>
  );
}
