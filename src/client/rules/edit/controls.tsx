// The editor's controls: no captions, only values. What a control is for
// is its icon's aria-label and tooltip (../labels.ts); everything it shows
// is data (dice, numbers, the book's names).
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Plus, Search, X } from "lucide-preact";
import { DICE_RE } from "../../../shared/rules/schema.ts";
import type { Names, RefKind } from "../ctx.ts";
import { KIND_ICON, KIND_LABEL } from "../chips/kinds.ts";
import type { IconType } from "../chips/ui.tsx";
import { L } from "../labels.ts";

/** A field: its icon (named by aria-label/tooltip), then the control. */
export function Fld(p: { icon: IconType; label: string; invalid?: boolean; wide?: boolean; children: ComponentChildren }) {
  const I = p.icon;
  return (
    <div class={`fld${p.invalid ? " invalid" : ""}${p.wide ? " wide" : ""}`}>
      <span class="fld-ic" role="img" aria-label={p.label} title={p.label}>
        <I size={14} aria-hidden="true" />
      </span>
      {p.children}
    </div>
  );
}

const asText = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** A text input that only hands over values that parse; what doesn't parse stays typed (and marked). */
function Parsed(p: { value: unknown; onValue: (v: never) => void; label: string; parse: (s: string) => { ok: true; v: unknown } | { ok: false }; inputMode?: string; class?: string; size?: number }) {
  const [t, setT] = useState(asText(p.value));
  const [bad, setBad] = useState(false);
  const last = useRef(p.value);
  useEffect(() => {
    if (JSON.stringify(last.current) !== JSON.stringify(p.value)) {
      last.current = p.value;
      setT(asText(p.value));
      setBad(false);
    }
  }, [p.value]);
  return (
    <input
      class={`in${bad ? " bad" : ""}${p.class ? ` ${p.class}` : ""}`}
      aria-label={p.label}
      title={p.label}
      aria-invalid={bad || undefined}
      inputMode={p.inputMode as "text"}
      size={p.size}
      value={t}
      spellcheck={false}
      autocomplete="off"
      onInput={(e) => {
        const s = (e.currentTarget as HTMLInputElement).value;
        setT(s);
        const r = p.parse(s.trim());
        setBad(!r.ok);
        if (r.ok) {
          last.current = r.v;
          p.onValue(r.v as never);
        }
      }}
    />
  );
}

type ValueProps<T> = { value: T | undefined; set: (v: T | undefined) => void; label: string; req?: boolean };

export function DiceInput(p: ValueProps<number | string>) {
  return (
    <Parsed
      onValue={p.set}
      value={p.value}
      label={p.label}
      size={8}
      parse={(s) => {
        if (!s) return p.req ? { ok: false } : { ok: true, v: undefined };
        const t = s.replace(/\s+/g, "").replace(/−/g, "-").replace(/d/g, "D");
        if (/^[+-]?\d+$/.test(t)) return { ok: true, v: Number(t) };
        return DICE_RE.test(t) ? { ok: true, v: t } : { ok: false };
      }}
    />
  );
}

export function NumInput(p: ValueProps<number> & { int?: boolean }) {
  return (
    <Parsed
      onValue={p.set}
      value={p.value}
      label={p.label}
      size={5}
      inputMode={p.int ? "numeric" : "decimal"}
      parse={(s) => {
        if (!s) return p.req ? { ok: false } : { ok: true, v: undefined };
        const n = Number(s.replace(/−/g, "-"));
        if (!Number.isFinite(n) || (p.int && !Number.isInteger(n))) return { ok: false };
        return { ok: true, v: n };
      }}
    />
  );
}

/** A number, or "average" (a stat's cap). */
export function CapInput(p: ValueProps<number | string>) {
  return (
    <Parsed
      onValue={p.set}
      value={p.value}
      label={p.label}
      size={8}
      parse={(s) => {
        if (!s) return { ok: true, v: undefined };
        if (s === "average") return { ok: true, v: s };
        const n = Number(s);
        return Number.isInteger(n) ? { ok: true, v: n } : { ok: false };
      }}
    />
  );
}

export function TextInput(p: ValueProps<string> & { class?: string }) {
  return (
    <input
      class={`in grow${p.class ? ` ${p.class}` : ""}`}
      aria-label={p.label}
      title={p.label}
      value={p.value ?? ""}
      onInput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        p.set(v === "" && !p.req ? undefined : v);
      }}
    />
  );
}

export function LongText(p: ValueProps<string>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight + 2}px`;
  };
  useEffect(fit, [p.value]);
  return (
    <textarea
      ref={ref}
      class="in grow long"
      aria-label={p.label}
      title={p.label}
      rows={2}
      value={p.value ?? ""}
      onInput={(e) => {
        const v = (e.currentTarget as HTMLTextAreaElement).value;
        p.set(v === "" && !p.req ? undefined : v);
        fit();
      }}
    />
  );
}

export function BoolToggle(p: ValueProps<boolean> & { icon: IconType; literal?: boolean }) {
  const I = p.icon;
  return (
    <button
      type="button"
      class="tg"
      aria-label={p.label}
      title={p.label}
      aria-pressed={!!p.value}
      onClick={() => p.set(p.value ? (p.literal ? false : undefined) : true)}
    >
      <I size={14} aria-hidden="true" />
    </button>
  );
}

/** One of a list: a select of data words (or, with icons, icon toggles). */
export function EnumSelect(p: ValueProps<string> & { of: readonly string[]; show?: Record<string, string>; icons?: Record<string, IconType> }) {
  if (p.icons)
    return (
      <span class="tgs">
        {p.of.map((o) => {
          const I = p.icons![o];
          return (
            <button type="button" class="tg" aria-label={`${p.label}: ${o}`} title={`${p.label}: ${o}`} aria-pressed={p.value === o} onClick={() => p.set(o)}>
              {I ? <I size={14} aria-hidden="true" /> : o}
            </button>
          );
        })}
      </span>
    );
  return (
    <select class="in" aria-label={p.label} title={p.label} value={p.value ?? ""} onChange={(e) => p.set((e.currentTarget as HTMLSelectElement).value || undefined)}>
      {!p.req && <option value="" />}
      {p.of.map((o) => (
        <option value={o}>{p.show?.[o] ?? o}</option>
      ))}
    </select>
  );
}

/** Several of a list, as toggles (alignments, availabilities, stats…). */
export function EnumsToggle(p: ValueProps<string[] | string> & { of: readonly string[]; show?: Record<string, string>; single?: boolean }) {
  const cur = p.value === undefined ? [] : Array.isArray(p.value) ? p.value : [p.value];
  return (
    <span class="tgs">
      {p.of.map((o) => {
        const on = cur.includes(o);
        return (
          <button
            type="button"
            class="tg txt"
            aria-pressed={on}
            onClick={() => {
              const next = on ? cur.filter((x) => x !== o) : p.of.filter((x) => x === o || cur.includes(x));
              p.set(next.length === 0 ? undefined : p.single && next.length === 1 ? next[0] : next);
            }}
          >
            {p.show?.[o] ?? o}
          </button>
        );
      })}
    </span>
  );
}

/** stat: one stat, several, or "all". */
export function StatsToggle(p: ValueProps<string | string[]> & { of: readonly string[] }) {
  const all = p.value === "all";
  const cur = all ? [...p.of] : p.value === undefined ? [] : Array.isArray(p.value) ? p.value : [p.value];
  return (
    <span class="tgs">
      {p.of.map((o) => {
        const on = cur.includes(o);
        return (
          <button
            type="button"
            class="tg txt"
            aria-pressed={on}
            onClick={() => {
              const next = on ? cur.filter((x) => x !== o) : p.of.filter((x) => x === o || cur.includes(x));
              p.set(next.length === 0 ? undefined : next.length === p.of.length ? "all" : next.length === 1 ? next[0] : next);
            }}
          >
            {o}
          </button>
        );
      })}
    </span>
  );
}

/** Comma-separated names. */
export function StringsInput(p: ValueProps<string[]>) {
  return (
    <Parsed
      onValue={p.set}
      value={p.value?.join(", ")}
      label={p.label}
      class="grow"
      parse={(s) => {
        const l = s.split(",").map((x) => x.trim()).filter(Boolean);
        return { ok: true, v: l.length ? l : undefined };
      }}
    />
  );
}

/** Any value as JSON (the fallback for complex or unknown fields). */
export function JsonInput(p: ValueProps<unknown>) {
  const fmt = (v: unknown) => (v === undefined ? "" : JSON.stringify(v));
  const [t, setT] = useState(fmt(p.value));
  const [bad, setBad] = useState(false);
  const last = useRef(fmt(p.value));
  useEffect(() => {
    const f = fmt(p.value);
    if (f !== last.current) {
      last.current = f;
      setT(f);
      setBad(false);
    }
  }, [p.value]);
  return (
    <textarea
      class={`in grow mono${bad ? " bad" : ""}`}
      aria-label={p.label}
      title={p.label}
      aria-invalid={bad || undefined}
      rows={1}
      spellcheck={false}
      value={t}
      onInput={(e) => {
        const s = (e.currentTarget as HTMLTextAreaElement).value;
        setT(s);
        if (!s.trim()) {
          setBad(!!p.req);
          if (!p.req) {
            last.current = "";
            p.set(undefined);
          }
          return;
        }
        try {
          const v = JSON.parse(s);
          setBad(false);
          last.current = fmt(v);
          p.set(v);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}

/** Column → value pairs (an item's or weapon's profile). */
export function RecordEditor(p: ValueProps<Record<string, string>>) {
  const rows = Object.entries(p.value ?? {});
  const put = (list: [string, string][]) => p.set(Object.fromEntries(list));
  return (
    <div class="rec">
      {rows.map(([k, v], i) => (
        <div class="rec-row">
          <input
            class="in rec-k"
            aria-label={`${p.label}: ${L.label}`}
            value={k}
            onInput={(e) => put(rows.map((r, j) => (j === i ? [(e.currentTarget as HTMLInputElement).value, r[1]] : r)))}
          />
          <input
            class="in grow"
            aria-label={`${p.label}: ${L.value}`}
            value={v}
            onInput={(e) => put(rows.map((r, j) => (j === i ? [r[0], (e.currentTarget as HTMLInputElement).value] : r)))}
          />
          <button type="button" class="icon-btn icon-xs" aria-label={L.take} title={L.take} onClick={() => put(rows.filter((_, j) => j !== i))}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" class="icon-btn icon-xs" aria-label={L.addColumn} title={L.addColumn} onClick={() => put([...rows, ["", ""]])}>
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pickers: existing entries by their book name
// ---------------------------------------------------------------------------

export function Picker(p: { kind: RefKind; names: Names; onPick: (id: string) => void; onClose: () => void; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const list = p.names.list(p.kind);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    const l = list.filter(([id, n]) => !p.exclude?.includes(id) && (!s || n.toLowerCase().includes(s) || id.includes(s)));
    return l.slice(0, 60);
  }, [q, list]);
  useEffect(() => {
    const out = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) p.onClose();
    };
    document.addEventListener("pointerdown", out, true);
    return () => document.removeEventListener("pointerdown", out, true);
  }, []);
  const I = KIND_ICON[p.kind];
  return (
    <div class="picker" ref={ref} role="dialog" aria-label={KIND_LABEL[p.kind]} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), p.onClose())}>
      <div class="picker-q">
        <Search size={14} aria-hidden="true" />
        <input class="in grow" aria-label={L.search} value={q} autoFocus onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </div>
      <ul class="picker-list" role="listbox" aria-label={KIND_LABEL[p.kind]}>
        {hits.map(([id, n]) => (
          <li>
            <button type="button" role="option" class="picker-item" onClick={() => (p.onPick(id), p.onClose())}>
              <I size={13} aria-hidden="true" />
              <span>{n}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RefPicker(p: ValueProps<string> & { kind: RefKind; names: Names }) {
  const [open, setOpen] = useState(false);
  const I = KIND_ICON[p.kind];
  const known = p.value && p.names.has(p.kind, p.value);
  return (
    <span class="pick-wrap">
      <button type="button" class={`refbtn${p.value && !known ? " bad" : ""}`} aria-label={p.label} title={p.label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <I size={13} aria-hidden="true" />
        <span>{p.value ? p.names.name(p.kind, p.value) : ""}</span>
        <Search class="dim" size={12} aria-hidden="true" />
      </button>
      {open && <Picker kind={p.kind} names={p.names} onPick={(id) => p.set(id)} onClose={() => setOpen(false)} />}
    </span>
  );
}

export function RefsPicker(p: ValueProps<string[]> & { kind: RefKind; names: Names }) {
  const [open, setOpen] = useState(false);
  const cur = p.value ?? [];
  const I = KIND_ICON[p.kind];
  return (
    <span class="pick-wrap tgs">
      {cur.map((id) => (
        <span class={`refbtn${p.names.has(p.kind, id) ? "" : " bad"}`}>
          <I size={13} aria-hidden="true" />
          <span>{p.names.name(p.kind, id)}</span>
          <button type="button" class="x" aria-label={L.take} title={L.take} onClick={() => p.set(cur.length > 1 ? cur.filter((x) => x !== id) : undefined)}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" class="icon-btn icon-xs" aria-label={`${L.add}: ${p.label}`} title={`${L.add}: ${p.label}`} onClick={() => setOpen(!open)}>
        <Plus size={14} aria-hidden="true" />
      </button>
      {open && <Picker kind={p.kind} names={p.names} exclude={cur} onPick={(id) => p.set([...cur, id])} onClose={() => setOpen(false)} />}
    </span>
  );
}
