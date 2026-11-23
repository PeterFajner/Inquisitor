// Chips for effects that hold other effects or a roll: pick, may have,
// chance, roll, if, wielded, trade, and the generators (gear, powers,
// bionics).
import type { ComponentChildren } from "preact";
import { ArrowLeftRight, Brain, Infinity as InfinityIcon, CircleDashed, Cpu, CornerDownRight, Dices, Hand, ListChecks, Package, Percent, Split } from "lucide-preact";
import type {
  BionicsEffect, ChanceEffect, Condition, Effect, GearEffect, OptionalEffect, PickEffect, PickFilter, PowersEffect, RollEffect,
  TradeEffect, WhenEffect, WieldedEffect,
} from "../../../shared/rules/schema.ts";
import { cap, isOption, type Ctx } from "../ctx.ts";
import { L } from "../labels.ts";
import { nameish, poolName } from "./basic.tsx";
import { condText, Not } from "./condition.tsx";
import { EffectChip, pickCount, register } from "./registry.tsx";
import { Arrow, Chip, Group, Ic, joined, V } from "./ui.tsx";

const chips = (effects: Effect[] | undefined, ctx: Ctx) => (effects ?? []).map((x) => <EffectChip e={x} ctx={ctx} />);

const Else = () => (
  <span class="else">
    <Ic icon={CornerDownRight} label={L.otherwise} />
  </span>
);

export function filterText(f: PickFilter | undefined, ctx?: Ctx): ComponentChildren {
  if (!f) return "";
  const parts: ComponentChildren[] = [
    ...(f.group ?? []), ...(f.category ?? []), ...(f.tag ?? []).map((x) => nameish(x, ctx)), ...(f.discipline ?? []), ...(f.availability ?? []),
    f.maxDifficulty !== undefined ? `Dif ≤ ${f.maxDifficulty}` : "",
    ...(f.exclude ?? []).map((x) => <Not>{nameish(x, ctx)}</Not>),
  ].filter(Boolean);
  return parts.map((x, i) => (
    <>
      {i > 0 && " · "}
      {x}
    </>
  ));
}

register("pick", {
  icon: ListChecks,
  label: L.pick,
  render(e: PickEffect, ctx) {
    const lead = (
      <>
        <Ic icon={ListChecks} label={L.pick} />
        {pickCount(e.pick)}
        {e.qty !== undefined && <V>×{String(e.qty)}</V>}
      </>
    );
    if (e.pool)
      return (
        <Group lead={lead}>
          <Arrow />
          <span>{filterText(e.filter, ctx) || poolName(e.pool)}</span>
          {e.into && e.into !== "self" && <span class="note">{ctx.names.name("item", e.into)}</span>}
        </Group>
      );
    const from = e.from ?? [];
    return (
      <Group lead={lead}>
        <Arrow />
        {joined(
          from.map((o) =>
            isOption(o) ? (
              <span class="opt">
                <span class="lead">{o.name}</span>
                {chips(o.effects, { ...ctx, statName: o.name })}
              </span>
            ) : (
              <EffectChip e={o} ctx={ctx} />
            ),
          ),
        )}
      </Group>
    );
  },
});

register("optional", {
  icon: CircleDashed,
  label: L.optional,
  render: (e: OptionalEffect, ctx) => (
    <Group class="may" lead={<Ic icon={CircleDashed} label={L.optional} />}>
      {chips(e.optional, ctx)}
    </Group>
  ),
});

register("chance", {
  icon: Percent,
  label: L.chance,
  render(e: ChanceEffect, ctx) {
    const c = e.chance;
    return (
      <Group
        lead={
          <>
            <Ic icon={Percent} label={L.chance} />
            {typeof c === "number" ? `${c}%` : `${c.die}: ${c.on.join(", ")}`}
          </>
        }
      >
        <Arrow />
        {chips(e.then, ctx)}
        {e.else && (
          <>
            <Else />
            {chips(e.else, ctx)}
          </>
        )}
      </Group>
    );
  },
});

register("when", {
  icon: Split,
  label: L.if,
  render: (e: WhenEffect, ctx) => (
    <Group
      lead={
        <>
          <Ic icon={Split} label={L.if} />
          {condText(e.when as Condition, ctx)}
        </>
      }
    >
      <Arrow />
      {chips(e.then, ctx)}
      {e.else && (
        <>
          <Else />
          {chips(e.else, ctx)}
        </>
      )}
    </Group>
  ),
});

register("roll", {
  icon: Dices,
  label: L.roll,
  render(e: RollEffect, ctx) {
    const die = ctx.names.die(e.roll) ?? "D100";
    // (a column by the weapon carried: its columns, or-ed)
    const col =
      typeof e.column === "object"
        ? Object.keys(e.column.owned).concat(e.column.else ?? []).map((c) => cap(c.replace(/-/g, " "))).join(" / ")
        : e.column && e.column !== "$subtype"
          ? cap(e.column)
          : null;
    const inner = (
      <>
        {e.times !== undefined && <V>{String(e.times)}×</V>}
        <Ic icon={Dices} label={L.roll} />
        <span>{die}</span>
        <Arrow />
        <span class="tn">{ctx.names.name("table", e.roll)}</span>
        {col && <span class="note">{col}</span>}
        {e.qty !== undefined && <V>×{String(e.qty)}</V>}
      </>
    );
    if (ctx.go && ctx.names.has("table", e.roll))
      return (
        <button type="button" class="chip roll" data-canvas-nodrag onClick={(ev) => (ev.stopPropagation(), ctx.go!("table", e.roll))}>
          {inner}
        </button>
      );
    return <span class="chip roll">{inner}</span>;
  },
});

register("wielded", {
  icon: Hand,
  label: L.wielded,
  render: (e: WieldedEffect, ctx) => (
    <Group lead={<Ic icon={Hand} label={L.wielded} />}>{chips(e.wielded, ctx)}</Group>
  ),
});

register("trade", {
  icon: ArrowLeftRight,
  label: L.trade,
  render(e: TradeEffect, ctx) {
    const g = e.trade.give;
    const lose = g.lose ? ([] as string[]).concat(g.lose).map(poolName).join(" · ") : null;
    return (
      <Group
        lead={
          <>
            <Ic icon={ArrowLeftRight} label={L.trade} />
            {e.trade.times !== undefined && (e.trade.times === "any" ? <Ic icon={InfinityIcon} label={L.any} size={12} /> : `${e.trade.times}×`)}
          </>
        }
      >
        <Chip class="bad">
          {g.count !== undefined && <V>{g.count}</V>}
          {lose && <span>{lose}</span>}
          {g.downgrade !== undefined && <V>−{g.downgrade}</V>}
          {g.filter && <span class="note">{filterText(g.filter, ctx)}</span>}
        </Chip>
        <Arrow />
        {chips(e.trade.get, ctx)}
      </Group>
    );
  },
});

register("gear", {
  icon: Package,
  label: L.gear,
  render(e: GearEffect, ctx) {
    const g = e.gear;
    const down = typeof g.downgrade === "number" ? g.downgrade : g.downgrade?.steps;
    return (
      <Group
        lead={
          <>
            <Ic icon={Package} label={L.gear} />
            {String(g.count)}
          </>
        }
      >
        {g.availability && (
          <>
            <Arrow />
            <span>{g.availability.join(" · ")}</span>
          </>
        )}
        {down !== undefined && down !== 0 && (
          <Chip class="bad" title={typeof g.downgrade === "object" ? g.downgrade.only?.join(" · ") : undefined}>
            <V>−{down}</V>
          </Chip>
        )}
        {g.alien !== undefined && g.alien !== false && (
          <Chip>
            {typeof g.alien === "object" && (
              <>
                <Ic icon={Split} label={L.if} />
                <span>{condText(g.alien, ctx)}</span>
                <Arrow />
              </>
            )}
            <span>alien</span>
          </Chip>
        )}
        {g.exclude && <span class="note"><Not>{g.exclude.map((x) => nameish(x, ctx)).join(" · ")}</Not></span>}
        {g.require && <span class="note" title={L.require}>{g.require.map((r) => r.join(" / ")).join(" + ")}</span>}
      </Group>
    );
  },
});

register("powers", {
  icon: Brain,
  label: L.powers,
  render(e: PowersEffect) {
    const p = e.powers;
    return (
      <Group
        lead={
          <>
            <Ic icon={Brain} label={L.powers} />
            {String(p.count)}
          </>
        }
      >
        {p.maxDifficulty !== undefined && (
          <>
            <Arrow />
            <span>Dif ≤ {p.maxDifficulty}</span>
          </>
        )}
        {p.disciplines && <span>{p.disciplines.join(" · ")}</span>}
        {p.crossDisciplinePenalty ? (
          <Chip class="bad" title={L.crossDiscipline}>
            <V>
              {String(p.count)}−{p.crossDisciplinePenalty}
            </V>
          </Chip>
        ) : null}
      </Group>
    );
  },
});

register("bionics", {
  icon: Cpu,
  label: L.bionics,
  render(e: BionicsEffect, ctx) {
    const b = e.bionics;
    return (
      <Group
        lead={
          <>
            <Ic icon={Cpu} label={L.bionics} />
            {String(b.count)}
          </>
        }
      >
        <Arrow />
        <span>{ctx.names.name("table", b.table ?? "bionics-table")}</span>
        {b.quality && <span class="note">{b.quality}</span>}
        {b.upgrade !== undefined && (
          <Chip class="good">
            <V>{b.upgrade}%</V>
          </Chip>
        )}
      </Group>
    );
  },
});
