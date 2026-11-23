// A new character: the archetype and subtype by the book's names, then one
// of two icons: random (the book's method, built at once) or freeform (the
// engine's choices left open as pickers; stats set by overriding them).
import { Dices, PenLine, X } from "lucide-preact";
import { useMemo, useState } from "preact/hooks";
import type { Compendium } from "../../shared/rules/compendium.ts";
import { ICON, IconButton } from "./Icon.tsx";
import { L } from "./labels.ts";

const LAST = "inquisitor:new-archetype";

export function NewCharacter({ c, onCreate, onClose }: { c: Compendium; onCreate: (a: string, s: string, mode: "random" | "freeform") => void; onClose?: () => void }) {
  const archetypes = useMemo(
    () => [...c.archetypes.values()].sort((a, b) => a.source.page - b.source.page || a.name.localeCompare(b.name)),
    [c],
  );
  const [arch, setArch] = useState(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST);
    } catch {}
    return last && c.archetypes.has(last) ? last : archetypes[0]?.id ?? "";
  });
  const subs = c.archetypes.get(arch)?.subtypes ?? [];
  const [sub, setSub] = useState(subs[0]?.id ?? "");
  const subtype = subs.some((s) => s.id === sub) ? sub : subs[0]?.id ?? "";

  const go = (mode: "random" | "freeform") => {
    try {
      localStorage.setItem(LAST, arch);
    } catch {}
    onCreate(arch, subtype, mode);
  };

  return (
    <div class="new-char" role="group" aria-label={L.newCharacter}>
      <select aria-label={L.archetype} title={L.archetype} value={arch} onChange={(e) => setArch(e.currentTarget.value)}>
        {archetypes.map((a) => (
          <option value={a.id}>
            {a.name}
            {a.gmApproval ? "*" : ""}
          </option>
        ))}
      </select>
      {subs.length > 1 && (
        <select aria-label={L.subtype} title={L.subtype} value={subtype} onChange={(e) => setSub(e.currentTarget.value)}>
          {subs.map((s) => (
            <option value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      <span class="new-char-go">
        <IconButton label={L.random} class="primary" onClick={() => go("random")}>
          <Dices size={ICON} />
        </IconButton>
        <IconButton label={L.freeform} onClick={() => go("freeform")}>
          <PenLine size={ICON} />
        </IconButton>
        {onClose && (
          <IconButton label={L.close} onClick={onClose}>
            <X size={ICON} />
          </IconButton>
        )}
      </span>
    </div>
  );
}
