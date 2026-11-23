// One entry as a card ("chips in cards", option A of the contact sheet):
// its name, its stat table or profile, its sections with their effects as
// chips, the book's prose for what only matters in play, and the book's
// own wording behind the quote icon (marked stale once the entry is
// edited). Selected, it offers edit (signed in) and history.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { ArrowDown, ArrowUp, Coins, FilePenLine, History, Infinity as Unrestricted, Lock, Pencil, Play, Quote, Split, Tag, X } from "lucide-preact";
import type { EntryMeta } from "../../shared/api.ts";
import { STATS, type Archetype, type Effect, type Entry, type Item, type Table } from "../../shared/rules/schema.ts";
import { Chip, condText, Effects, EffectChip, Ic, KIND_ICON, KIND_LABEL } from "./chips/index.ts";
import { Arrow } from "./chips/ui.tsx";
import { cap, type Ctx } from "./ctx.ts";
import { Icon } from "./icon.tsx";
import { L } from "./labels.ts";

export type CardActions = {
  edit(key: string): void;
  history(key: string): void;
};

export type CardProps = {
  /** "<pack>:<kind>/<id>" */
  cardKey: string;
  entry: Entry;
  meta: EntryMeta | undefined;
  ctx: Ctx;
  selected: boolean;
  signedIn: boolean;
  editing?: boolean;
  flash?: boolean;
  /** At least this tall (px): its worked-out height (./sizes.ts), which its slot on the canvas has. */
  minHeight?: number;
  actions: CardActions;
};

export function Card(p: CardProps) {
  const { entry: e, meta } = p;
  const [quote, setQuote] = useState(false);
  const KindIcon = KIND_ICON[e.kind];
  return (
    <article class={`rc k-${e.kind}${p.flash ? " flash" : ""}${p.editing ? " editing" : ""}`} style={p.minHeight ? { minHeight: `${p.minHeight}px` } : undefined}>
      <header>
        <span class="rc-handle" role="img" aria-label={KIND_LABEL[e.kind]} title={KIND_LABEL[e.kind]}>
          <Icon icon={KindIcon} size={16} />
        </span>
        <h3 class="name">
          {e.name}
          {e.kind === "archetype" && e.gmApproval ? "*" : ""}
        </h3>
        {"group" in e && e.group && <span class="grp">{e.group}</span>}
        <span class="sp" />
        {e.points !== undefined && (
          <span class="meta" role="img" aria-label={`${L.points}: ${e.points}`} title={L.points}>
            <Icon icon={Coins} size={13} />
            {e.points}
          </span>
        )}
        <button
          type="button"
          class={`meta quote-btn${meta?.edited ? " stale" : ""}`}
          aria-label={meta?.edited ? `${L.source} (${L.stale})` : L.source}
          title={meta?.edited ? `${L.source} (${L.stale})` : L.source}
          aria-expanded={quote}
          onClick={(ev) => {
            ev.stopPropagation();
            setQuote(!quote);
          }}
        >
          <Icon icon={Quote} size={13} />
          {e.source.page}
          {meta?.edited && <Icon icon={FilePenLine} size={13} />}
        </button>
        {p.selected && (
          <span class="rc-actions">
            <button type="button" class="icon-btn icon-sm" aria-label={L.history} title={L.history} onClick={(ev) => (ev.stopPropagation(), p.actions.history(p.cardKey))}>
              <Icon icon={History} size={16} />
            </button>
            {p.signedIn && (
              <button type="button" class="icon-btn icon-sm" aria-label={L.edit} title={L.edit} onClick={(ev) => (ev.stopPropagation(), p.actions.edit(p.cardKey))}>
                <Icon icon={Pencil} size={16} />
              </button>
            )}
          </span>
        )}
      </header>
      {quote && (
        <div class="rc-quote" data-canvas-nodrag>
          <div class="rc-quote-head">
            <span class={`meta${meta?.edited ? " stale" : ""}`}>
              <Icon icon={Quote} size={13} />
              {e.source.page}
              {meta?.edited && <Ic icon={FilePenLine} label={L.stale} />}
            </span>
            <button type="button" class="icon-btn icon-sm" aria-label={L.close} title={L.close} onClick={(ev) => (ev.stopPropagation(), setQuote(false))}>
              <Icon icon={X} size={14} />
            </button>
          </div>
          <blockquote>{e.source.text ?? ""}</blockquote>
        </div>
      )}
      <div class="body">
        <Body e={e} ctx={p.ctx} />
      </div>
    </article>
  );
}

export function Body({ e, ctx }: { e: Entry; ctx: Ctx }): ComponentChildren {
  switch (e.kind) {
    case "archetype":
      return <ArchetypeBody e={e} ctx={ctx} />;
    case "table":
      return <TableBody e={e} ctx={ctx} />;
    case "item":
      return <ItemBody e={e} ctx={ctx} />;
    default:
      return (
        <>
          {e.kind === "power" && e.difficulty !== undefined && (
            <div class="flow">
              <Chip>
                <span class="k">Dif</span>
                <span class="v">{String(e.difficulty)}</span>
              </Chip>
            </div>
          )}
          {e.kind === "rule" && e.apply && (
            <div class="flow">
              <Chip>
                <Ic icon={Play} label={L.apply} />
                {e.apply !== true && (e.apply.after ?? e.apply.before) && (
                  <>
                    {e.apply.after ? <Ic icon={ArrowDown} label={L.after} /> : <Ic icon={ArrowUp} label={L.before} />}
                    <span class="v">{e.apply.after ?? e.apply.before}</span>
                  </>
                )}
              </Chip>
            </div>
          )}
          {e.text && <div class="text">{e.text}</div>}
          <OwnEffects effects={e.effects} text={e.text} ctx={ctx} />
        </>
      );
  }
}

// An entry's effects, leaving out gameplay prose that only repeats its text.
function OwnEffects({ effects, text, ctx }: { effects: Effect[] | undefined; text: string | undefined; ctx: Ctx }) {
  const shown = (effects ?? []).filter((x) => !(text && "prose" in x && x.kind === "gameplay" && text.includes(x.prose.trim())));
  return shown.length ? <Effects effects={shown} ctx={ctx} /> : null;
}

// "60+2D10" → ["60", "2D10"]
const parseStat = (v: unknown): [string, string] => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return ["max" in o ? `≤${String(o.max)}` : Object.values(o).join(" "), ""];
  }
  const m = String(v).match(/^(\d+)(?:\+(.+))?$/);
  return m ? [m[1], m[2] ?? ""] : [String(v ?? "–"), ""];
};

export function StatsGrid({ e }: { e: Archetype }) {
  const cols = STATS.filter((s) => e.subtypes.some((t) => t.stats[s] !== undefined));
  const dice = cols.map((c) => {
    const ds = new Set(e.subtypes.map((s) => parseStat(s.stats[c])[1]));
    return ds.size === 1 ? [...ds][0] : null;
  });
  const anyDice = dice.some((d) => d);
  return (
    <div class="rc-scroll">
      <table class="stats">
        <thead>
          <tr>
            <th>{e.subtypeDie ? String(e.subtypeDie) : ""}</th>
            {cols.map((c) => (
              <th>{c}</th>
            ))}
          </tr>
          {anyDice && (
            <tr class="d">
              <th />
              {dice.map((d) => (
                <th>{d ? `+${d}` : ""}</th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {e.subtypes.map((s) => (
            <tr>
              <th>
                {s.range && <span class="range">{fmtRange(s.range)} </span>}
                {s.name}
              </th>
              {cols.map((c, i) => {
                const [b, d] = parseStat(s.stats[c]);
                return <td>{`${b}${dice[i] === null && d ? `+${d}` : ""}`}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArchetypeBody({ e, ctx }: { e: Archetype; ctx: Ctx }) {
  return (
    <>
      <StatsGrid e={e} />
      {e.sections.map((s) => (
        <section class="sec">
          <h4>{s.name}</h4>
          <div class="sec-body">{s.effects.length ? <Effects effects={s.effects} ctx={ctx} /> : <span class="none">–</span>}</div>
        </section>
      ))}
    </>
  );
}

export const fmtRange = (r: [number, number] | undefined) => (r ? (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`) : "–");

function TableBody({ e, ctx }: { e: Table; ctx: Ctx }) {
  const cols = e.columns;
  return (
    <div class="rc-scroll">
      <table class="tbl">
        <thead>
          <tr>
            {cols ? cols.map((c) => <th>{cap(c)}</th>) : <th>{String(e.die)}</th>}
            <th class="eff" />
          </tr>
        </thead>
        <tbody>
          {e.rows.map((r) => (
            <tr>
              {cols ? (
                cols.map((c) => <td class={r.ranges?.[c] ? "" : "blank"}>{fmtRange(r.ranges?.[c])}</td>)
              ) : (
                <td>{fmtRange(r.range)}</td>
              )}
              <td class="eff">
                <div class="flow">
                  {r.effects.length ? r.effects.map((x) => <EffectChip e={x} ctx={ctx} />) : <span class="label">{r.label}</span>}
                  {r.qty &&
                    Object.entries(r.qty).map(([a, q]) => (
                      <span class="note">
                        {a} ×{String(q)}
                      </span>
                    ))}
                  {r.quality &&
                    Object.entries(r.quality).map(([a, q]) => (
                      <span class="note" title={L.quality}>
                        {a} <Arrow /> {q}
                      </span>
                    ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemBody({ e, ctx }: { e: Item; ctx: Ctx }) {
  const keys = e.profile ? Object.keys(e.profile) : [];
  return (
    <>
      <div class="flow">
        {e.category && <Chip>{e.category}</Chip>}
        {e.availability && <Chip class="avail">{e.availability}</Chip>}
        {e.product && <Chip>{e.product}</Chip>}
        {e.alien && <Chip>alien</Chip>}
        {e.unrestricted && (
          <Chip>
            <Ic icon={Unrestricted} label={L.unrestricted} />
          </Chip>
        )}
        {e.tags?.map((t) => (
          <Chip>
            <Ic icon={Tag} label={L.tags} />
            {cap(t.replace(/-/g, " "))}
          </Chip>
        ))}
        {e.requires && (
          <Chip>
            <Ic icon={Lock} label={L.requires} />
            {condText(e.requires, ctx)}
          </Chip>
        )}
        {e.availabilityWhen && (
          <Chip>
            <Ic icon={Split} label={L.if} />
            {condText(e.availabilityWhen.when, ctx)}
            <Arrow />
            <span class="v">{e.availabilityWhen.then ?? e.availability ?? "–"}</span> · <Ic icon={Split} label={L.otherwise} />
            <span class="v">{e.availabilityWhen.else === "gm" ? "GM" : e.availabilityWhen.else}</span>
          </Chip>
        )}
      </div>
      {keys.length > 0 && (
        <div class="rc-scroll">
          <table class="prof">
            <thead>
              <tr>
                {keys.map((k) => (
                  <th>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {keys.map((k) => (
                  <td>{e.profile![k]}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {e.profileWhen?.map((pw) => (
        <div class="flow">
          <Chip>
            <Ic icon={Split} label={L.if} />
            {condText(pw.when, ctx)}
            <Arrow />
            {Object.entries(pw.profile).map(([k, v], i) => (
              <>
                {i ? " · " : ""}
                <span class="k">{k}</span> <span class="v">{v}</span>
              </>
            ))}
          </Chip>
        </div>
      ))}
      {e.text && <div class="text">{e.text}</div>}
      <OwnEffects effects={e.effects} text={e.text} ctx={ctx} />
    </>
  );
}
