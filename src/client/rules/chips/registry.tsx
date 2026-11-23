// The chip registry: one renderer per effect type (docs/RULES-FORMAT.md,
// src/shared/rules/schema.ts), found by the effect's identifying key. An
// effect of a type nobody registered (a newer format) still renders, as the
// generic chip: its key's icon-less label and its values.
import type { ComponentChildren } from "preact";
import { Braces, CornerDownRight, Infinity as InfinityIcon, ListChecks, Split } from "lucide-preact";
import type { Effect } from "../../../shared/rules/schema.ts";
import { isOption, type Ctx } from "../ctx.ts";
import { L } from "../labels.ts";
import { condText } from "./condition.tsx";
import { Chip, Ic, type IconType } from "./ui.tsx";

// Identifying keys, in the schema's order (the first one present wins).
export const EFFECT_TYPES = [
  "stat", "talent", "exotic", "item", "mutation", "power", "pick", "optional", "chance", "roll", "when", "alignment", "gear",
  "powers", "prose", "armour", "restrict", "exclusive", "derived", "attribute", "wielded", "remove", "reloads", "trade",
  "upgrade", "bionics", "weapon", "access", "psyker", "companion", "warband", "location",
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

export function effectType(e: unknown): string {
  if (!e || typeof e !== "object") return "?";
  for (const t of EFFECT_TYPES) if (t in e) return t;
  return Object.keys(e).find((k) => k !== "id") ?? "?";
}

export type ChipRenderer = {
  /** The chip (inline). */
  render(e: never, ctx: Ctx): ComponentChildren;
  /** Its palette icon and label. */
  icon: IconType;
  label: string;
  /** Laid out as a block (its own line) rather than inline. */
  block?: (e: never) => boolean;
};

const registry = new Map<string, ChipRenderer>();

export function register(type: string, r: ChipRenderer): void {
  registry.set(type, r);
}

export const rendererOf = (type: string): ChipRenderer | undefined => registry.get(type);

/** One effect as a chip. */
export function EffectChip({ e, ctx }: { e: Effect; ctx: Ctx }) {
  const t = effectType(e);
  const r = registry.get(t);
  if (!r) return <Generic e={e} />;
  return <>{r.render(e as never, ctx)}</>;
}

// Any effect: its key and its plain values, as data.
function Generic({ e }: { e: unknown }) {
  const vals: string[] = [];
  const walk = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" || typeof v === "number") vals.push(String(v));
    else if (typeof v === "boolean") return;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object") Object.entries(v).forEach(([k, x]) => (k === "id" ? null : walk(x)));
  };
  walk(e);
  return (
    <Chip class="generic">
      <Ic icon={Braces} label={`${L.unknown}: ${effectType(e)}`} />
      <span>{vals.join(" ")}</span>
    </Chip>
  );
}

/**
 * A list of effects, laid out the way option A of the contact sheet does:
 * inline chips flow; conditions become rows (the condition, then its
 * effects); picks of named options become an indented list; prose is a
 * block of the book's text.
 */
export function Effects({ effects, ctx, depth = 0 }: { effects: Effect[]; ctx: Ctx; depth?: number }) {
  const out: ComponentChildren[] = [];
  let flow: ComponentChildren[] = [];
  const flush = () => {
    if (flow.length) out.push(<div class="flow" key={`f${out.length}`}>{flow}</div>);
    flow = [];
  };
  effects.forEach((e, i) => {
    if (e && typeof e === "object" && "when" in e && "then" in e) {
      flush();
      out.push(
        <div class="row" key={i}>
          <div class="cond">
            <Ic icon={Split} label={L.if} />
            <span>{condText(e.when, ctx)}</span>
          </div>
          <div class="sec-body">
            <Effects effects={e.then} ctx={ctx} depth={depth} />
          </div>
        </div>,
      );
      if (e.else)
        out.push(
          <div class="row" key={`${i}e`}>
            <div class="cond">
              <Ic icon={CornerDownRight} label={L.otherwise} />
            </div>
            <div class="sec-body">
              <Effects effects={e.else} ctx={ctx} depth={depth} />
            </div>
          </div>,
        );
    } else if (e && typeof e === "object" && "pick" in e && e.from && e.from.length && e.from.every(isOption) && depth < 3) {
      flush();
      out.push(
        <div class="opts" key={i}>
          <div class="pk">
            <Ic icon={ListChecks} label={L.pick} />
            <span>{pickCount(e.pick)}</span>
          </div>
          <div class="ol">
            {e.from.map((o) => {
              if (!isOption(o)) return null;
              const long = o.name.length > 24;
              const sub = { ...ctx, statName: o.name };
              return (
                <>
                  <div class={`on${long ? " long" : ""}`} title={o.text}>
                    {o.when && <span class="when-mark">{condText(o.when, ctx)}</span>}
                    {o.name}
                  </div>
                  <div class={`sec-body ob${long ? " long" : ""}`}>
                    {o.effects?.length ? <Effects effects={o.effects} ctx={sub} depth={depth + 1} /> : null}
                  </div>
                </>
              );
            })}
          </div>
        </div>,
      );
    } else {
      const r = registry.get(effectType(e));
      if (r?.block?.(e as never)) {
        flush();
        out.push(<EffectChip key={i} e={e} ctx={ctx} />);
      } else flow.push(<EffectChip key={i} e={e} ctx={ctx} />);
    }
  });
  flush();
  return <>{out}</>;
}

export function pickCount(p: unknown): ComponentChildren {
  if (p === "any") return <Ic icon={InfinityIcon} label={L.any} size={12} />;
  if (p && typeof p === "object" && "max" in p) return `≤${(p as { max: number }).max}`;
  return String(p);
}
