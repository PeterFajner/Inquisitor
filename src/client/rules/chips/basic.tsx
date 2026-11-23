// Chips for effects that hold no other effects: stats, grants, prose and
// the newer single-purpose types.
import type { ComponentChildren } from "preact";
import {
  ArrowUpCircle, Ban, Calculator, CircleSlash, Cpu, Crosshair, KeyRound, MessageSquareText, MinusCircle, RefreshCw, Scale,
  Shield, Swords, Tag, TriangleAlert, UserCog, UserPlus, Users, Zap,
} from "lucide-preact";
import type {
  AccessEffect, AlignmentEffect, ArmourEffect, AttributeEffect, CompanionEffect, DerivedEffect, ExclusiveEffect, GrantEffect,
  LocationEffect, ProseEffect, ReloadsEffect, RemoveEffect, RestrictEffect, StatEffect, StatFormula, UpgradeEffect, WarbandEffect,
  WeaponEffect,
} from "../../../shared/rules/schema.ts";
import { isNegative, signed, type Ctx, type RefKind } from "../ctx.ts";
import { L } from "../labels.ts";
import { KIND_ICON, KIND_LABEL } from "./kinds.ts";
import { register } from "./registry.tsx";
import { Arrow, Chip, Ic, joined, V } from "./ui.tsx";

const formula = (f: StatFormula): string =>
  `${f.stat}${f.times !== undefined ? ` × ${f.times}` : ""}${f.divide !== undefined ? ` / ${f.divide}` : ""}${f.add !== undefined ? ` ${signed(f.add)}` : ""}`;
const val = (v: unknown): string => (v && typeof v === "object" && "stat" in v ? `[${formula(v as StatFormula)}]` : String(v));

// --- stat ------------------------------------------------------------------
register("stat", {
  icon: Scale,
  label: L.stats,
  render(e: StatEffect, ctx) {
    const stats = e.stat === "all" ? "WS BS S T I Wp Sg Nv Ld" : ([] as string[]).concat(e.stat).join(" ");
    const name = ctx.statName && ctx.statName === stats ? null : <span>{stats}</span>;
    const parts = [];
    if (e.add !== undefined) {
      const neg = typeof e.add === "object" ? false : isNegative(e.add);
      parts.push(
        <Chip class={neg ? "bad" : "good"}>
          {name}
          <V>{typeof e.add === "object" ? `+[${formula(e.add)}]` : signed(e.add)}</V>
          {e.each && <Ic icon={RefreshCw} label={L.each} />}
        </Chip>,
      );
    }
    if (e.multiply !== undefined)
      parts.push(
        <Chip class={e.multiply < 1 ? "bad" : "good"}>
          {name}
          <V>×{e.multiply}</V>
        </Chip>,
      );
    if (e.set !== undefined)
      parts.push(
        <Chip>
          {name}
          <V>= {String(e.set)}</V>
        </Chip>,
      );
    if (e.max !== undefined)
      parts.push(
        <Chip class="bad">
          {name}
          <V>≤</V>
          <span>{String(e.max)}</span>
        </Chip>,
      );
    if (e.min !== undefined)
      parts.push(
        <Chip class="good">
          {name}
          <V>≥</V>
          <span>{String(e.min)}</span>
        </Chip>,
      );
    return <>{parts}</>;
  },
});

// --- grants ----------------------------------------------------------------
export function Ref({ kind, id, ctx, children }: { kind: RefKind; id: string; ctx: Ctx; children?: ComponentChildren }) {
  const known = ctx.names.has(kind, id);
  const inner = (
    <>
      <Ic icon={KIND_ICON[kind]} label={KIND_LABEL[kind]} />
      <span class={known ? undefined : "missing"}>{ctx.names.name(kind, id)}</span>
      {children}
    </>
  );
  if (ctx.go && known)
    return (
      <button type="button" class={`chip ref k-${kind}`} data-canvas-nodrag onClick={(ev) => (ev.stopPropagation(), ctx.go!(kind, id))}>
        {inner}
      </button>
    );
  return <span class={`chip ref k-${kind}`}>{inner}</span>;
}

for (const kind of ["talent", "exotic", "item", "mutation", "power"] as const) {
  register(kind, {
    icon: KIND_ICON[kind],
    label: KIND_LABEL[kind],
    render(e: GrantEffect & Record<string, unknown>, ctx) {
      const x = e as Record<string, unknown>;
      return (
        <Ref kind={kind} id={String(x[kind])} ctx={ctx}>
          {x.qty !== undefined && <V>×{String(x.qty)}</V>}
          {typeof x.quality === "string" && <span class="note">{x.quality}</span>}
          {x.implanted === true && <Ic icon={Cpu} label={L.implanted} />}
          {typeof x.reloads === "number" && (
            <span class="sub">
              <Ic icon={RefreshCw} label={L.reloads} />
              {x.reloads}
            </span>
          )}
          {Array.isArray(x.alterations) && x.alterations.map((a) => <span class="note">{ctx.names.name("item", String(a))}</span>)}
          {typeof x.note === "string" && <span class="note">{x.note}</span>}
        </Ref>
      );
    },
  });
}

// --- alignment -------------------------------------------------------------
register("alignment", {
  icon: Scale,
  label: L.alignment,
  render: (e: AlignmentEffect) => (
    <Chip>
      <Ic icon={Scale} label={L.alignment} />
      <span>{e.alignment.join(" · ")}</span>
    </Chip>
  ),
});

// --- prose -----------------------------------------------------------------
register("prose", {
  icon: MessageSquareText,
  label: L.prose,
  block: (e: ProseEffect) => e.kind !== "gm",
  render: (e: ProseEffect) =>
    e.kind === "gm" ? (
      <Chip class="gm">
        <Ic icon={UserCog} label={L.gm} />
        <span>{e.prose}</span>
      </Chip>
    ) : (
      <div class={`prose ${e.kind}`}>
        {e.kind === "unfit" ? <Ic icon={TriangleAlert} label={e.proposal ? `${L.unfit}: ${e.proposal}` : L.unfit} /> : <Ic icon={MessageSquareText} label={L.gameplay} />}
        <span>{e.prose}</span>
      </div>
    ),
});

// --- armour ----------------------------------------------------------------
const locs = (l: ArmourEffect["armour"]["locations"]) => (l === undefined ? "" : ([] as string[]).concat(l as string | string[]).join(" · "));
register("armour", {
  icon: Shield,
  label: L.armour,
  render(e: ArmourEffect, ctx) {
    const a = e.armour;
    return (
      <Chip class={a.add !== undefined && a.av === undefined && a.as === undefined ? (isNegative(a.add) ? "bad" : "good") : undefined}>
        <Ic icon={Shield} label={L.armour} />
        {a.as && <span>{ctx.names.name("item", a.as)}</span>}
        {a.av !== undefined && <V>{String(a.av)}</V>}
        {a.add !== undefined && <V>{signed(a.add)}</V>}
        {a.field !== undefined && (
          <span class="sub">
            <Ic icon={Zap} label={L.armour} />
            {String(a.field)}
          </span>
        )}
        {a.locations !== undefined && <span class="note">{a.choose ? `${a.choose} × ` : ""}{locs(a.locations)}</span>}
      </Chip>
    );
  },
});

// --- restrict / exclusive ------------------------------------------------------
const POOL_NAME: Record<string, string> = { talent: "Talents", exotic: "Exotic Abilities", item: "Equipment", mutation: "Mutations", power: "Psychic Powers" };
export const poolName = (p: string) => POOL_NAME[p] ?? p;
/** A name filters match (an id, group, tag…): an entry's book name when it is one. */
export const nameish = (x: string, ctx?: Ctx): string => {
  if (!ctx) return x;
  for (const k of ["item", "talent", "exotic", "mutation", "power"] as const) if (ctx.names.has(k, x)) return ctx.names.name(k, x);
  return x;
};
const scope = (s: { pool: string; group?: string[]; category?: string[]; tag?: string[] }) =>
  [...(s.group ?? []), ...(s.category ?? []), ...(s.tag ?? [])].join(" · ") || poolName(s.pool);

register("restrict", {
  icon: Ban,
  label: L.restrict,
  render: (e: RestrictEffect, ctx) => {
    const r = e.restrict;
    const nm = (l: string[]) => l.map((x) => nameish(x, ctx)).join(" · ");
    return (
      <Chip class="restrict">
        <Ic icon={Ban} label={L.restrict} />
        <span>{scope(r)}</span>
        {r.only && (
          <>
            <Arrow />
            <span title={L.only}>{nm(r.only)}</span>
          </>
        )}
        {r.except && (
          <span class="note">
            <Ic icon={Ban} label={L.except} size={12} />
            {nm(r.except)}
          </span>
        )}
        {r.maxAV !== undefined && <V>≤{r.maxAV}</V>}
        {r.alien === false && (
          <span class="note">
            <Ic icon={Ban} label={L.not} size={12} />
            alien
          </span>
        )}
      </Chip>
    );
  },
});
register("exclusive", {
  icon: CircleSlash,
  label: L.exclusive,
  render: (e: ExclusiveEffect) => (
    <Chip>
      <Ic icon={CircleSlash} label={L.exclusive} />
      <span>{scope(e.exclusive)}</span>
    </Chip>
  ),
});

// --- derived / attribute ---------------------------------------------------------
register("derived", {
  icon: Calculator,
  label: L.derived,
  render(e: DerivedEffect) {
    const names = ([] as string[]).concat(e.derived);
    const neg = e.add !== undefined && isNegative(e.add);
    return (
      <Chip class={e.add !== undefined ? (neg ? "bad" : "good") : undefined}>
        <span>{names.join(" ")}</span>
        {e.add !== undefined && <V>{signed(e.add)}</V>}
        {e.set !== undefined && <V>= {([] as (number | string)[]).concat(e.set).join(" · ")}</V>}
        {e.counts &&
          Object.entries(e.counts).map(([s, n]) => (
            <span class="sub">
              <Ic icon={Calculator} label={L.derived} />
              {s} {signed(n as number)}
            </span>
          ))}
      </Chip>
    );
  },
});
register("attribute", {
  icon: Tag,
  label: L.attribute,
  render: (e: AttributeEffect) => (
    <Chip class={e.add !== undefined ? (typeof e.add !== "object" && isNegative(e.add) ? "bad" : "good") : undefined}>
      <span>{e.attribute}</span>
      {e.set !== undefined && <V>= {val(e.set)}</V>}
      {e.add !== undefined && <V>{typeof e.add === "object" ? `+${val(e.add)}` : signed(e.add)}</V>}
    </Chip>
  ),
});

// --- remove / reloads / upgrade --------------------------------------------------
register("remove", {
  icon: MinusCircle,
  label: L.removeEffect,
  render: (e: RemoveEffect, ctx) => (
    <Chip class="bad">
      <Ic icon={MinusCircle} label={L.removeEffect} />
      {joined(
        Object.entries(e.remove).flatMap(([k, ids]) => (ids ?? []).map((id) => <span>{ctx.names.name(k as RefKind, id)}</span>)),
      )}
    </Chip>
  ),
});
register("reloads", {
  icon: RefreshCw,
  label: L.reloads,
  render: (e: ReloadsEffect) => (
    <Chip class="good">
      <Ic icon={RefreshCw} label={L.reloads} />
      {e.reloads.add !== undefined && <V>{signed(e.reloads.add)}</V>}
      {e.reloads.multiply !== undefined && <V>×{e.reloads.multiply}</V>}
    </Chip>
  ),
});
register("upgrade", {
  icon: ArrowUpCircle,
  label: L.upgrade,
  render: (e: UpgradeEffect) => (
    <Chip class="good">
      <Ic icon={ArrowUpCircle} label={L.upgrade} />
      <V>+{e.upgrade}</V>
    </Chip>
  ),
});

// --- weapon ------------------------------------------------------------------
register("weapon", {
  icon: Swords,
  label: L.weapon,
  render: (e: WeaponEffect) => (
    <Chip class="weapon">
      <Ic icon={Swords} label={L.weapon} />
      {e.weapon.name && <span class="lead">{e.weapon.name}</span>}
      {e.weapon.qty !== undefined && <V>×{e.weapon.qty}</V>}
      {Object.entries(e.weapon.profile).map(([k, v]) => (
        <span class="kv">
          <span class="k">{k}</span> {v}
        </span>
      ))}
    </Chip>
  ),
});

// --- access / psyker / companion / warband / location ---------------------------
register("access", {
  icon: KeyRound,
  label: L.access,
  render: (e: AccessEffect) => (
    <Chip class="good">
      <Ic icon={KeyRound} label={L.access} />
      <span>{e.access.group.join(" · ")}</span>
    </Chip>
  ),
});
register("psyker", {
  icon: Zap,
  label: L.psyker,
  render: () => (
    <Chip>
      <Ic icon={Zap} label={L.psyker} />
      <span>Psyker</span>
    </Chip>
  ),
});
register("companion", {
  icon: UserPlus,
  label: L.companion,
  render: (e: CompanionEffect, ctx) => (
    <Ref kind="archetype" id={e.companion.archetype} ctx={ctx}>
      <Ic icon={UserPlus} label={L.companion} />
      {e.companion.subtype && <span class="note">{e.companion.subtype}</span>}
      {e.companion.option && <span class="note">{e.companion.option}</span>}
    </Ref>
  ),
});
register("warband", {
  icon: Users,
  label: L.warband,
  render: (e: WarbandEffect, ctx) => (
    <Chip>
      <Ic icon={Users} label={L.warband} />
      <V>≤{e.warband.max}</V>
      <span>{e.warband.archetype.map((a) => ctx.names.name("archetype", a)).join(" · ")}</span>
    </Chip>
  ),
});
register("location", {
  icon: Crosshair,
  label: L.location,
  render: (e: LocationEffect) => (
    <Chip>
      <Ic icon={Crosshair} label={L.location} />
      {"add" in e.location ? (
        <V>+ {e.location.add}</V>
      ) : (
        <>
          {e.location.random && <Ic icon={RefreshCw} label={L.random} />}
          <span>{e.location.from.join(" · ")}</span>
        </>
      )}
    </Chip>
  ),
});
