// The rules changed since this version was built: what updating changes, in
// the book's terms (stats from → to, things gained and lost, options, table
// results, new rolls and choices), applied as a new version with the check.
import { ArrowRight, Check, Dices, Minus, PenLine, Plus, X } from "lucide-preact";
import type { CharacterDiff } from "../../shared/engine/diff.ts";
import { ICON, ICON_SM, IconButton } from "./Icon.tsx";
import { L } from "./labels.ts";

export function RulesUpdate({ d, onApply, onClose }: { d: CharacterDiff; onApply: () => void; onClose: () => void }) {
  const qty = (n?: number) => (n && n > 1 ? ` ×${n}` : "");
  return (
    <section class="rules-update" aria-label={L.update}>
      <ul class="diff">
        {d.stats.map((s) => (
          <li>
            <b>{s.stat}</b> {s.from} <ArrowRight size={12} aria-hidden="true" /> {s.to}
          </li>
        ))}
        {d.alignment && (
          <li>
            {d.alignment.from ?? "–"} <ArrowRight size={12} aria-hidden="true" /> {d.alignment.to ?? "–"}
          </li>
        )}
        {[...d.gained.map((t) => ({ name: t.name + qty(t.qty), on: true })), ...d.options.gained.map((o) => ({ name: o.name, on: true })), ...d.rolls.gained.map((r) => ({ name: r, on: true }))].map((t) => (
          <li class="gain">
            <Plus size={ICON_SM} aria-label={L.gained} /> {t.name}
          </li>
        ))}
        {[...d.lost.map((t) => ({ name: t.name + qty(t.qty) })), ...d.options.lost.map((o) => ({ name: o.name })), ...d.rolls.lost.map((r) => ({ name: r }))].map((t) => (
          <li class="loss">
            <Minus size={ICON_SM} aria-label={L.lost} /> {t.name}
          </li>
        ))}
        {d.needsRolling.map((n) => (
          <li>
            <Dices size={ICON_SM} aria-label={L.reroll} /> {n.label}
          </li>
        ))}
        {d.pending.map((p) => (
          <li>
            <PenLine size={ICON_SM} aria-label={L.change} /> {p.label}
          </li>
        ))}
      </ul>
      <div class="rules-update-ctl">
        <IconButton label={L.apply} class="primary" onClick={onApply}>
          <Check size={ICON} />
        </IconButton>
        <IconButton label={L.cancel} onClick={onClose}>
          <X size={ICON} />
        </IconButton>
      </div>
    </section>
  );
}
