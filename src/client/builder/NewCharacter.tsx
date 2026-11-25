// A new character: the archetype and subtype by the book's names, then one
// of two icons: random (the book's method, built at once) or freeform (the
// engine's choices left open as pickers; stats set by overriding them).
import { Dices, PenLine, X } from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Compendium } from "../../shared/rules/compendium.ts";
import { ICON, IconButton } from "./Icon.tsx";
import { L, T } from "./labels.ts";

/** The archetype a new character always starts on. */
const DEFAULT = "inquisitor";

/** An archetype as one character ("Inquisitor", not the book's heading "Inquisitors"). */
export const archetypeName = (a: { name: string; characters?: string }): string => a.characters ?? a.name;
/** The archetype dropdowns' order: A–Z by the shown name, the articles' mixed in with the book's. */
export const byArchetypeName = (a: { name: string; characters?: string }, b: { name: string; characters?: string }): number =>
  archetypeName(a).localeCompare(archetypeName(b));

export function NewCharacter({
  c,
  onCreate,
  onClose,
  onPreview,
}: {
  c: Compendium;
  onCreate: (a: string, s: string, mode: "random" | "freeform") => void;
  onClose?: () => void;
  /** The archetype/subtype on show (to get its balance ready before the roll). */
  onPreview?: (a: string, s: string) => void;
}) {
  const archetypes = useMemo(() => [...c.archetypes.values()].sort(byArchetypeName), [c]);
  const [arch, setArch] = useState(() => archetypes.find((a) => a.id === DEFAULT)?.id ?? archetypes[0]?.id ?? "");
  const subs = c.archetypes.get(arch)?.subtypes ?? [];
  const [sub, setSub] = useState(subs[0]?.id ?? "");
  const subtype = subs.some((s) => s.id === sub) ? sub : subs[0]?.id ?? "";
  useEffect(() => {
    if (arch && subtype) onPreview?.(arch, subtype);
  }, [arch, subtype]);

  const go = (mode: "random" | "freeform") => onCreate(arch, subtype, mode);

  return (
    <section class="csec new-char" role="group" aria-label={L.newCharacter}>
      <h3 class="csec-title">
        <span>{T.occupation}</span>
        {onClose && (
          <IconButton label={L.close} onClick={onClose}>
            <X size={ICON} />
          </IconButton>
        )}
      </h3>
      <div class="occ">
        <div class="occ-row">
          <span class="occ-label">{T.archetype}</span>
          <select class="occ-select" aria-label={T.archetype} value={arch} onChange={(e) => setArch(e.currentTarget.value)}>
            {archetypes.map((a) => (
              <option value={a.id}>
                {archetypeName(a)}
                {a.gmApproval ? "*" : ""}
              </option>
            ))}
          </select>
        </div>
        {subs.length > 1 && (
          <div class="occ-row">
            <span class="occ-label">{T.subtype}</span>
            <select class="occ-select" aria-label={T.subtype} value={subtype} onChange={(e) => setSub(e.currentTarget.value)}>
              {subs.map((s) => (
                <option value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div class="new-char-go">
        <IconButton label={L.random} class="primary" onClick={() => go("random")}>
          <Dices size={ICON} />
        </IconButton>
        <IconButton label={L.freeform} onClick={() => go("freeform")}>
          <PenLine size={ICON} />
        </IconButton>
      </div>
    </section>
  );
}
