// Editing effects: every chip of a list as an editable row (tap the chip to
// open its fields), with move / remove, and a palette of effect types to
// add one. Options of a pick, conditions and nested lists edit in place,
// indented under their chip.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  ArrowDown, ArrowUp, Ban, Coins, Dices, Hash, Layers, ListChecks, ListPlus, Package, Plus, Scale, Split, Trash2, TriangleAlert, UserRound,
  Users, X, Zap,
} from "lucide-preact";
import { ALIGNMENTS, AVAILABILITIES, STATS, type Condition, type Effect, type Option } from "../../../shared/rules/schema.ts";
import { cap, isOption, type Ctx, type Names, type RefKind } from "../ctx.ts";
import { EFFECT_TYPES, EffectChip, effectType, rendererOf } from "../chips/index.ts";
import { KIND_ICON, KIND_LABEL } from "../chips/kinds.ts";
import type { IconType } from "../chips/ui.tsx";
import { L } from "../labels.ts";
import { blankEffect, freshId } from "./blank.ts";
import {
  BoolToggle, CapInput, DiceInput, EnumSelect, EnumsToggle, Fld, JsonInput, LongText, NumInput, RecordEditor, RefPicker, RefsPicker,
  StatsToggle, StringsInput, TextInput,
} from "./controls.tsx";
import { EFFECT_FIELDS, type Field } from "./fields.ts";

export type Path = (string | number)[];
export const pathStr = (p: Path) => p.join(".");

export type Ed = {
  names: Names;
  /** The draft's context (its options and subtypes), for previews and conditions. */
  ctx: Ctx;
  set(path: Path, v: unknown): void;
  /** Schema problems by path ("sections.0.effects.1.talent"), with their messages. */
  issues: Map<string, string>;
  /** Ids used anywhere in the draft (new decisions get fresh ones). */
  used(): Set<string>;
  isOpen(p: string): boolean;
  toggle(p: string, open?: boolean): void;
};

export function getIn(o: unknown, path: Path): unknown {
  let x = o;
  for (const k of path) {
    if (x === null || x === undefined || typeof x !== "object") return undefined;
    x = (x as Record<string | number, unknown>)[k];
  }
  return x;
}

/** Immutable set; undefined removes an object key. */
export function setIn<T>(o: T, path: Path, v: unknown): T {
  if (!path.length) return v as T;
  const [k, ...rest] = path;
  if (Array.isArray(o)) {
    const a = [...o];
    a[k as number] = setIn(a[k as number], rest, v);
    return a as T;
  }
  const obj = { ...((o ?? {}) as Record<string, unknown>) };
  const next = setIn(obj[k as string], rest, v);
  if (next === undefined) delete obj[k as string];
  else obj[k as string] = next;
  return obj as T;
}

const problem = (ed: Ed, p: Path, exact = false): string | null => {
  const s = pathStr(p);
  for (const [k, m] of ed.issues) if (k === s || (!exact && k.startsWith(`${s}.`))) return m;
  return null;
};

function Tools(p: { onUp?: () => void; onDown?: () => void; onRemove: () => void; extra?: ComponentChildren }) {
  return (
    <span class="ed-tools">
      {p.extra}
      <button type="button" class="icon-btn icon-xs" aria-label={L.up} title={L.up} disabled={!p.onUp} onClick={p.onUp}>
        <ArrowUp size={14} aria-hidden="true" />
      </button>
      <button type="button" class="icon-btn icon-xs" aria-label={L.down} title={L.down} disabled={!p.onDown} onClick={p.onDown}>
        <ArrowDown size={14} aria-hidden="true" />
      </button>
      <button type="button" class="icon-btn icon-xs" aria-label={L.take} title={L.take} onClick={p.onRemove}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

const swap = <T,>(a: T[], i: number, j: number): T[] => {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
};

/** The palette: an icon per effect type. */
export function Palette(p: { onAdd: (type: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", out, true);
    return () => document.removeEventListener("pointerdown", out, true);
  }, [open]);
  return (
    <span class="pal-wrap" ref={ref}>
      <button type="button" class="icon-btn icon-xs add" aria-label={p.label ?? L.add} title={p.label ?? L.add} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus size={15} aria-hidden="true" />
      </button>
      {open && (
        <div class="palette" role="menu" aria-label={p.label ?? L.add} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          {EFFECT_TYPES.map((t) => {
            const r = rendererOf(t);
            const I = r?.icon ?? Plus;
            const label = r?.label ?? t;
            return (
              <button type="button" role="menuitem" class="icon-btn icon-sm" aria-label={label} title={label} onClick={() => (setOpen(false), p.onAdd(t))}>
                <I size={16} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

export function EffectList({ effects, path, ed }: { effects: Effect[] | undefined; path: Path; ed: Ed }) {
  const list = effects ?? [];
  const put = (l: Effect[]) => ed.set(path, l);
  return (
    <ol class="ed-effects">
      {list.map((e, i) => (
        <EffectEditor
          key={i}
          e={e}
          path={[...path, i]}
          ed={ed}
          onUp={i > 0 ? () => put(swap(list, i, i - 1)) : undefined}
          onDown={i < list.length - 1 ? () => put(swap(list, i, i + 1)) : undefined}
          onRemove={() => put(list.filter((_, j) => j !== i))}
        />
      ))}
      <li class="ed-add">
        <Palette
          onAdd={(t) => {
            put([...list, blankEffect(t, ed.used())]);
            ed.toggle(pathStr([...path, list.length]), true);
          }}
        />
      </li>
    </ol>
  );
}

function EffectEditor(p: { e: Effect; path: Path; ed: Ed; onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  const { e, path, ed } = p;
  const ps = pathStr(path);
  const open = ed.isOpen(ps);
  const bad = problem(ed, path);
  const type = effectType(e);
  const fields = EFFECT_FIELDS[type];
  return (
    <li class={`ed-effect${bad ? " invalid" : ""}${open ? " open" : ""}`}>
      <div class="ed-row">
        <button type="button" class="ed-chip" aria-expanded={open} aria-label={`${L.edit}: ${rendererOf(type)?.label ?? type}`} onClick={() => ed.toggle(ps)}>
          <span class="flow" aria-hidden="true">
            <EffectChip e={e} ctx={ed.ctx} />
          </span>
        </button>
        {bad && (
          <span class="bad-mark" role="img" aria-label={`${L.invalid}: ${bad}`} title={bad}>
            <TriangleAlert size={14} aria-hidden="true" />
          </span>
        )}
        <Tools onUp={p.onUp} onDown={p.onDown} onRemove={p.onRemove} />
      </div>
      {open && (
        <div class="ed-fields">
          {fields ? <Fields fields={fields} value={e} path={path} ed={ed} /> : <JsonInput value={e} label={L.unknown} req set={(v) => ed.set(path, v)} />}
        </div>
      )}
    </li>
  );
}

const BLOCK = new Set(["effects", "from", "cond", "long", "record", "json", "strings"]);

/** A set of fields: required and filled ones show; the rest wait behind their icon in the "+" row. */
export function Fields({ fields, value, path, ed }: { fields: Field[]; value: unknown; path: Path; ed: Ed }) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  const vis = fields.filter((f) => f.req || getIn(value, f.at) !== undefined || shown.has(pathStr(f.at)));
  const hidden = fields.filter((f) => !vis.includes(f));
  const inline = vis.filter((f) => !BLOCK.has(f.f.k));
  const blocks = vis.filter((f) => BLOCK.has(f.f.k));
  return (
    <>
      {inline.length > 0 && (
        <div class="fld-row">
          {inline.map((f) => (
            <FieldCtl f={f} value={value} path={path} ed={ed} />
          ))}
        </div>
      )}
      {blocks.map((f) => (
        <FieldCtl f={f} value={value} path={path} ed={ed} />
      ))}
      {hidden.length > 0 && (
        <div class="fld-more">
          <Plus class="dim" size={12} aria-hidden="true" />
          {hidden.map((f) => {
            const I = f.icon;
            return (
              <button type="button" class="icon-btn icon-xs" aria-label={`${L.add}: ${f.label}`} title={`${L.add}: ${f.label}`} onClick={() => setShown(new Set([...shown, pathStr(f.at)]))}>
                <I size={13} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function FieldCtl({ f, value, path, ed }: { f: Field; value: unknown; path: Path; ed: Ed }) {
  const at = [...path, ...f.at];
  const v = getIn(value, f.at);
  const set = (x: unknown) => ed.set(at, x);
  const bad = !!problem(ed, at);
  const common = { label: f.label, req: f.req };
  const k = f.f;
  let ctl: ComponentChildren;
  switch (k.k) {
    case "dice":
      ctl = <DiceInput {...common} value={v as string} set={set} />;
      break;
    case "int":
    case "num":
      ctl = <NumInput {...common} int={k.k === "int"} value={v as number} set={set} />;
      break;
    case "cap":
      ctl = <CapInput {...common} value={v as number} set={set} />;
      break;
    case "text":
      ctl = <TextInput {...common} value={v as string} set={set} />;
      break;
    case "long":
      ctl = <LongText {...common} value={v as string} set={set} />;
      break;
    case "enum":
      ctl = <EnumSelect {...common} of={k.of} show={k.show} icons={k.icons} value={v as string} set={set} />;
      break;
    case "enums":
      ctl = <EnumsToggle {...common} of={k.of} show={k.show} single={k.single ?? true} value={v as string[]} set={set} />;
      break;
    case "stats":
      ctl = <StatsToggle {...common} of={STATS} value={v as string[]} set={set} />;
      break;
    case "ref":
      ctl = <RefPicker {...common} kind={k.ref} names={ed.names} value={v as string} set={set} />;
      break;
    case "refs":
      ctl = <RefsPicker {...common} kind={k.ref} names={ed.names} value={v as string[]} set={set} />;
      break;
    case "bool":
      ctl = <BoolToggle {...common} icon={f.icon} value={v as boolean} set={set} />;
      break;
    case "strings":
      ctl = <StringsInput {...common} value={v as string[]} set={set} />;
      break;
    case "record":
      ctl = <RecordEditor {...common} value={v as Record<string, string>} set={set} />;
      break;
    case "json":
      ctl = <JsonInput {...common} value={v} set={set} />;
      break;
    case "pickN":
      ctl = <PickN {...common} value={v} set={set} />;
      break;
    case "chance":
      ctl = <ChanceInput {...common} value={v} set={set} />;
      break;
    case "column": {
      // a column by the weapon carried ({ owned, else }): kept as it is
      if (v && typeof v === "object") {
        const c = v as { owned: Record<string, string[]>; else?: string };
        ctl = <span class="ro">{Object.keys(c.owned).concat(c.else ?? []).map(cap).join(" / ")}</span>;
        break;
      }
      const table = getIn(value, ["roll"]);
      const cols = typeof table === "string" ? ed.names.columns(table) : [];
      ctl = <EnumSelect {...common} req={false} of={["$subtype", ...cols]} show={Object.fromEntries(cols.map((c) => [c, cap(c)]))} value={v as string} set={set} />;
      break;
    }
    case "effects":
      return (
        <div class={`fld-block${bad ? " invalid" : ""}`}>
          <span class="fld-ic" role="img" aria-label={f.label} title={f.label}>
            <f.icon size={14} aria-hidden="true" />
          </span>
          <EffectList effects={v as Effect[]} path={at} ed={ed} />
        </div>
      );
    case "from":
      return (
        <div class={`fld-block${bad ? " invalid" : ""}`}>
          <span class="fld-ic" role="img" aria-label={f.label} title={f.label}>
            <f.icon size={14} aria-hidden="true" />
          </span>
          <FromEditor items={(v as (Option | Effect)[]) ?? []} path={at} ed={ed} />
        </div>
      );
    case "cond":
      return (
        <div class={`fld-block${bad ? " invalid" : ""}`}>
          <span class="fld-ic" role="img" aria-label={f.label} title={f.label}>
            <f.icon size={14} aria-hidden="true" />
          </span>
          <CondEditor value={v as Condition | undefined} path={at} ed={ed} />
        </div>
      );
  }
  return (
    <Fld icon={f.icon} label={f.label} invalid={bad} wide={BLOCK.has(k.k)}>
      {ctl}
    </Fld>
  );
}

// "1", "D3", "∞" (any), "≤3" (up to 3)
function PickN(p: { value: unknown; set: (v: unknown) => void; label: string }) {
  const fmt = (v: unknown) => (v === "any" ? "∞" : v && typeof v === "object" ? `≤${(v as { max: number }).max}` : v === undefined ? "" : String(v));
  const [t, setT] = useState(fmt(p.value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (fmt(p.value) !== t && !bad) setT(fmt(p.value));
  }, [p.value]);
  return (
    <input
      class={`in${bad ? " bad" : ""}`}
      size={5}
      aria-label={p.label}
      value={t}
      onInput={(e) => {
        const s = (e.currentTarget as HTMLInputElement).value.trim();
        setT(s);
        let v: unknown = undefined;
        if (s === "∞" || s === "any") v = "any";
        else if (/^(≤|<=)\s*\d+$/.test(s)) v = { max: Number(s.replace(/\D/g, "")) };
        else if (/^\d+$/.test(s)) v = Number(s);
        else if (/^[+-]?(\d*D\d+|\d+)([+-](\d*D\d+|\d+))*$/i.test(s)) v = s.toUpperCase();
        setBad(v === undefined);
        if (v !== undefined) p.set(v);
      }}
    />
  );
}

// "50" (percent) or "D6: 5, 6" (a die and its results)
function ChanceInput(p: { value: unknown; set: (v: unknown) => void; label: string }) {
  const fmt = (v: unknown) => (v && typeof v === "object" ? `${(v as { die: string }).die}: ${(v as { on: number[] }).on.join(", ")}` : v === undefined ? "" : String(v));
  const [t, setT] = useState(fmt(p.value));
  const [bad, setBad] = useState(false);
  return (
    <input
      class={`in${bad ? " bad" : ""}`}
      size={9}
      aria-label={p.label}
      value={t}
      onInput={(e) => {
        const s = (e.currentTarget as HTMLInputElement).value.trim();
        setT(s);
        let v: unknown = undefined;
        const m = s.match(/^(\d*D\d+)\s*:\s*([\d,\s]+)$/i);
        if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 0 && Number(s) <= 100) v = Number(s);
        else if (m) {
          const on = m[2].split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n));
          if (on.length) v = { die: m[1].toUpperCase(), on };
        }
        setBad(v === undefined);
        if (v !== undefined) p.set(v);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// A pick's options
// ---------------------------------------------------------------------------

function FromEditor({ items, path, ed }: { items: (Option | Effect)[]; path: Path; ed: Ed }) {
  const put = (l: (Option | Effect)[]) => ed.set(path, l);
  return (
    <ol class="ed-effects ed-from">
      {items.map((o, i) => {
        const tools = {
          onUp: i > 0 ? () => put(swap(items, i, i - 1)) : undefined,
          onDown: i < items.length - 1 ? () => put(swap(items, i, i + 1)) : undefined,
          onRemove: () => put(items.filter((_, j) => j !== i)),
        };
        return isOption(o) ? <OptionEditor key={i} o={o} path={[...path, i]} ed={ed} {...tools} /> : <EffectEditor key={i} e={o} path={[...path, i]} ed={ed} {...tools} />;
      })}
      <li class="ed-add">
        <button
          type="button"
          class="icon-btn icon-xs add"
          aria-label={L.addOption}
          title={L.addOption}
          onClick={() => {
            put([...items, { id: freshId("option", ed.used()), name: "" }]);
            ed.toggle(pathStr([...path, items.length]), true);
          }}
        >
          <ListPlus size={15} aria-hidden="true" />
        </button>
        <Palette
          onAdd={(t) => {
            put([...items, blankEffect(t, ed.used())]);
            ed.toggle(pathStr([...path, items.length]), true);
          }}
        />
      </li>
    </ol>
  );
}

const OPTION_FIELDS: Field[] = [
  { at: ["text"], f: { k: "long" }, label: L.text, icon: ListChecks },
  { at: ["when"], f: { k: "cond" }, label: L.if, icon: Split },
  { at: ["effects"], f: { k: "effects" }, label: L.effects, icon: ListChecks },
  { at: ["id"], f: { k: "text" }, label: L.id, icon: Hash, req: true },
];

function OptionEditor(p: { o: Option; path: Path; ed: Ed; onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  const { o, path, ed } = p;
  const ps = pathStr(path);
  const open = ed.isOpen(ps);
  const bad = problem(ed, path);
  return (
    <li class={`ed-effect ed-option${bad ? " invalid" : ""}${open ? " open" : ""}`}>
      <div class="ed-row">
        <button type="button" class="ed-open" aria-label={L.edit} title={L.edit} aria-expanded={open} onClick={() => ed.toggle(ps)}>
          <ListChecks size={14} aria-hidden="true" />
        </button>
        <input class="in grow opt-name" aria-label={L.name} value={o.name} onInput={(e) => ed.set([...path, "name"], (e.currentTarget as HTMLInputElement).value)} />
        {bad && (
          <span class="bad-mark" role="img" aria-label={`${L.invalid}: ${bad}`} title={bad}>
            <TriangleAlert size={14} aria-hidden="true" />
          </span>
        )}
        <Tools onUp={p.onUp} onDown={p.onDown} onRemove={p.onRemove} />
      </div>
      {!open && o.effects && o.effects.length > 0 && (
        <div class="flow ed-preview" aria-hidden="true">
          {o.effects.map((x) => (
            <EffectChip e={x} ctx={ed.ctx} />
          ))}
        </div>
      )}
      {open && (
        <div class="ed-fields">
          <Fields fields={OPTION_FIELDS} value={o} path={path} ed={ed} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const COND_TYPES: { k: string; icon: IconType; label: string; blank: () => Condition }[] = [
  { k: "alignment", icon: Scale, label: L.alignment, blank: () => ({ alignment: ["Radical"] }) },
  { k: "subtype", icon: Users, label: L.subtype, blank: () => ({ subtype: [] as string[] }) as unknown as Condition },
  { k: "option", icon: ListChecks, label: L.pick, blank: () => ({ option: [] as string[] }) as unknown as Condition },
  { k: "archetype", icon: UserRound, label: L.kinds.archetype, blank: () => ({ archetype: [] as string[] }) as unknown as Condition },
  { k: "has", icon: Package, label: L.add2, blank: () => ({ has: { talent: "" } }) },
  { k: "not", icon: Ban, label: L.not, blank: () => ({ not: { alignment: ["Radical"] } }) },
  { k: "any", icon: Split, label: L.any, blank: () => ({ any: [{ alignment: ["Radical"] }] }) },
  { k: "all", icon: Layers, label: L.all, blank: () => ({ all: [{ alignment: ["Radical"] }] }) },
  { k: "stat", icon: Hash, label: L.stats, blank: () => ({ stat: "WS", above: 50 }) },
  { k: "rolled", icon: Dices, label: L.roll, blank: () => ({ rolled: [] as string[] }) as unknown as Condition },
  { k: "psyker", icon: Zap, label: L.psyker, blank: () => ({ psyker: true }) },
  { k: "generates", icon: Coins, label: L.availability, blank: () => ({ generates: ["Exotic"] }) },
];
const condType = (c: unknown) => (c && typeof c === "object" ? COND_TYPES.find((t) => t.k in c)?.k : undefined);

export function CondEditor({ value, path, ed }: { value: Condition | undefined; path: Path; ed: Ed }) {
  const t = condType(value);
  const c = (value ?? {}) as Record<string, unknown>;
  const set = (v: unknown) => ed.set(path, v);
  const sub = (k: string, v: unknown) => ed.set([...path, k], v);
  const [menu, setMenu] = useState(!t);
  const cur = COND_TYPES.find((x) => x.k === t);
  let body: ComponentChildren = null;
  switch (t) {
    case "alignment":
      body = <EnumsToggle label={L.alignment} of={ALIGNMENTS} value={c.alignment as string[]} set={(v) => sub("alignment", v ? ([] as string[]).concat(v) : undefined)} />;
      break;
    case "generates":
      body = <EnumsToggle label={L.availability} of={AVAILABILITIES} value={c.generates as string[]} set={(v) => sub("generates", v ? ([] as string[]).concat(v) : undefined)} />;
      break;
    case "subtype": {
      const ids = [...ed.ctx.subtypes.keys()];
      body = ids.length ? (
        <EnumsToggle label={L.subtype} of={ids} show={Object.fromEntries(ed.ctx.subtypes)} value={c.subtype as string[]} set={(v) => sub("subtype", v ? ([] as string[]).concat(v) : undefined)} />
      ) : (
        <StringsInput label={L.subtype} value={c.subtype as string[]} set={(v) => sub("subtype", v)} />
      );
      break;
    }
    case "option": {
      const ids = [...ed.ctx.options.keys()];
      body = <EnumsToggle label={L.pick} of={ids} show={Object.fromEntries(ed.ctx.options)} value={c.option as string[]} set={(v) => sub("option", v ? ([] as string[]).concat(v) : undefined)} />;
      break;
    }
    case "archetype":
      body = <RefsPicker label={L.kinds.archetype} kind="archetype" names={ed.names} value={c.archetype as string[]} set={(v) => sub("archetype", v)} />;
      break;
    case "rolled":
      body = <RefsPicker label={L.roll} kind="table" names={ed.names} value={c.rolled as string[]} set={(v) => sub("rolled", v)} />;
      break;
    case "has": {
      const h = (c.has ?? {}) as Record<string, string>;
      const kind = (Object.keys(h)[0] ?? "talent") as RefKind;
      body = (
        <span class="tgs">
          {(["talent", "exotic", "item", "mutation", "power"] as const).map((k) => {
            const I = KIND_ICON[k];
            return (
              <button type="button" class="tg" aria-label={KIND_LABEL[k]} title={KIND_LABEL[k]} aria-pressed={k === kind} onClick={() => sub("has", { [k]: "" })}>
                <I size={14} aria-hidden="true" />
              </button>
            );
          })}
          <RefPicker label={KIND_LABEL[kind]} kind={kind} names={ed.names} value={h[kind]} set={(v) => sub("has", { [kind]: v ?? "" })} />
        </span>
      );
      break;
    }
    case "not":
      body = <CondEditor value={c.not as Condition} path={[...path, "not"]} ed={ed} />;
      break;
    case "any":
    case "all": {
      const list = (c[t] as Condition[]) ?? [];
      body = (
        <ol class="cond-list">
          {list.map((x, i) => (
            <li>
              <CondEditor value={x} path={[...path, t, i]} ed={ed} />
              <button type="button" class="icon-btn icon-xs" aria-label={L.take} title={L.take} disabled={list.length < 2} onClick={() => sub(t, list.filter((_, j) => j !== i))}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <button type="button" class="icon-btn icon-xs add" aria-label={L.add} title={L.add} onClick={() => sub(t, [...list, { alignment: ["Radical"] }])}>
              <Plus size={14} aria-hidden="true" />
            </button>
          </li>
        </ol>
      );
      break;
    }
    case "stat":
      body = (
        <span class="fld-row">
          <EnumSelect label={L.stats} req of={STATS} value={c.stat as string} set={(v) => sub("stat", v)} />
          <Fld icon={ArrowUp} label={L.above}>
            <NumInput label={L.above} int value={c.above as number} set={(v) => sub("above", v)} />
          </Fld>
          <Fld icon={ArrowDown} label={L.below}>
            <NumInput label={L.below} int value={c.below as number} set={(v) => sub("below", v)} />
          </Fld>
        </span>
      );
      break;
    case "psyker":
      body = <BoolToggle label={L.psyker} icon={Zap} literal value={c.psyker as boolean} set={(v) => sub("psyker", !!v)} />;
      break;
    default:
      body = value ? <JsonInput label={L.if} value={value} set={set} /> : null;
  }
  return (
    <div class="cond-ed">
      <span class="pal-wrap">
        <button type="button" class="tg" aria-label={cur ? cur.label : L.if} title={cur ? cur.label : L.if} aria-expanded={menu} onClick={() => setMenu(!menu)}>
          {cur ? <cur.icon size={14} aria-hidden="true" /> : <Split size={14} aria-hidden="true" />}
        </button>
        {menu && (
          <div class="palette" role="menu">
            {COND_TYPES.map((x) => (
              <button type="button" role="menuitem" class="icon-btn icon-sm" aria-label={x.label} title={x.label} aria-pressed={x.k === t} onClick={() => (setMenu(false), set(x.blank()))}>
                <x.icon size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </span>
      <div class="cond-body">{body}</div>
    </div>
  );
}
