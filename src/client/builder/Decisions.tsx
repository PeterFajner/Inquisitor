// The engine's log beside the sheet: every roll and choice in book order,
// nested under the decision that led to it, with its book label, the dice
// faces and the result. Each one can be rolled again; a choice can be
// changed. Open choices (freeform) come first, as pickers.
import { Check, Dices, PenLine, X } from "lucide-preact";
import { useMemo, useState } from "preact/hooks";
import type { CharacterRecord } from "../../shared/engine/record.ts";
import type { LogEntry, PendingChoice } from "../../shared/engine/build.ts";
import { ICON_SM, IconButton } from "./Icon.tsx";
import { L } from "./labels.ts";
import { Picker } from "./Picker.tsx";

type Edit = {
  reroll(key: string): void;
  /** Opens the options of a made choice (to change it). */
  change(key: string): void;
  choose(key: string, ids: string[]): void;
  randomFill(keys?: string[]): void;
};

function depths(log: LogEntry[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const e of log) d.set(e.key, e.parent && d.has(e.parent) ? d.get(e.parent)! + 1 : 0);
  return d;
}

function Faces({ faces, total }: { faces: number[]; total?: number }) {
  return (
    <span class="faces">
      {faces.map((f) => (
        <span class="face">{f}</span>
      ))}
      {total !== undefined && (faces.length > 1 || total !== faces[0]) && <span class="total">{total}</span>}
    </span>
  );
}

export function Decisions({ log, record, edit }: { log: LogEntry[]; record: CharacterRecord; edit?: Edit }) {
  const depth = useMemo(() => depths(log), [log]);
  return (
    <ol class="log">
      {log.map((e) => {
        const c = e.type === "choice" ? record.choices[e.key]?.[0] : undefined;
        const yesNo = c === "yes" || c === "no" ? c : null;
        const result = e.result.filter(Boolean).join(", ");
        return (
          <li class={`log-row${e.rerolled ? " rerolled" : ""}${e.forced ? " forced" : ""}`} style={{ "--depth": depth.get(e.key) ?? 0 }}>
            <span class="log-label">{e.label}</span>
            {e.faces && e.faces.length > 0 && <Faces faces={e.faces} total={e.total} />}
            {yesNo && (
              <span class="yn" role="img" aria-label={yesNo === "yes" ? L.yes : L.no} title={yesNo === "yes" ? L.yes : L.no}>
                {yesNo === "yes" ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
              </span>
            )}
            {result && !(e.type === "dice" && result === String(e.total)) && <span class="log-result">{result}</span>}
            {edit && (
              <span class="log-ctl">
                {e.type === "choice" && (
                  <IconButton small label={`${L.change}: ${e.label}`} onClick={() => edit.change(e.key)}>
                    <PenLine size={ICON_SM} />
                  </IconButton>
                )}
                <IconButton small label={`${L.reroll}: ${e.label}`} onClick={() => edit.reroll(e.key)}>
                  <Dices size={ICON_SM} />
                </IconButton>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Open choices: a short list as buttons, a long one (or several to pick)
 * in the picker; optional ones as yes/no. `hints` names what an optional
 * opens when its own label is empty (the options behind it).
 */
export function Pending({ pending, hints, edit }: { pending: PendingChoice[]; hints: Map<string, string>; edit: Edit }) {
  const [open, setOpen] = useState<PendingChoice | null>(null);
  if (!pending.length) return null;
  return (
    <div class="pending">
      <div class="pending-all">
        <IconButton label={L.randomFill} onClick={() => edit.randomFill()}>
          <Dices size={20} />
        </IconButton>
      </div>
      <ul>
        {pending.map((p) => {
          const inline = p.count === 1 && p.options.length <= 6 && p.kind !== "optional";
          const yes = p.options.find((o) => o.id === "yes")?.label || hints.get(p.key) || "";
          return (
            <li class="pending-row">
              <span class="pending-label">{p.label}</span>
              {p.kind === "optional" ? (
                <span class="pending-opts">
                  {yes && <span class="pending-hint">{yes}</span>}
                  <IconButton small label={yes ? `${L.yes}: ${yes}` : L.yes} onClick={() => edit.choose(p.key, ["yes"])}>
                    <Check size={ICON_SM} />
                  </IconButton>
                  <IconButton small label={yes ? `${L.no}: ${yes}` : L.no} onClick={() => edit.choose(p.key, ["no"])}>
                    <X size={ICON_SM} />
                  </IconButton>
                </span>
              ) : inline ? (
                <span class="pending-opts">
                  {p.options.map((o) => (
                    <button type="button" class="b-chip" onClick={() => edit.choose(p.key, [o.id])}>
                      {o.label}
                    </button>
                  ))}
                </span>
              ) : (
                <span class="pending-opts">
                  <IconButton small label={`${L.change}: ${p.label}`} onClick={() => setOpen(p)}>
                    <PenLine size={ICON_SM} />
                  </IconButton>
                </span>
              )}
              <IconButton small label={`${L.randomFill}: ${p.label}`} onClick={() => edit.randomFill([p.key])}>
                <Dices size={ICON_SM} />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {open && (
        <Picker
          label={open.label}
          options={open.options.map((o) => ({ id: o.id, label: o.label || "–" }))}
          count={open.count}
          chosen={open.chosen}
          onClose={() => setOpen(null)}
          onDone={(ids) => {
            setOpen(null);
            edit.choose(open.key, ids);
          }}
        />
      )}
    </div>
  );
}
