// Rule packs as layers, the canvas's books filter: show or hide each pack's
// cards (the layout closes up around them), each article with the mark its
// cards carry; choose the pack new entries go into, and (signed in) make a
// new pack, optionally building on others.
import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Eye, EyeOff, Layers, Pencil, Plus } from "lucide-preact";
import type { Pack } from "../../shared/rules/schema.ts";
import { kebab } from "./edit/blank.ts";
import { L } from "./labels.ts";
import { newPack } from "./model.ts";

type Props = {
  packs: Pack[];
  hidden: Set<string>;
  onToggle: (id: string) => void;
  active: string;
  onActive: (id: string) => void;
  signedIn: boolean;
};

export function PacksMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", out, true);
    return () => document.removeEventListener("pointerdown", out, true);
  }, [open]);
  return (
    <div class="menu-wrap" ref={ref}>
      <button type="button" class="icon-btn" aria-label={L.packs} title={L.packs} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Layers size={20} aria-hidden="true" />
      </button>
      {open && (
        <div class="menu packs-menu" role="dialog" aria-label={L.packs} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <ul class="packs">
            {p.packs.map((pk) => {
              const shown = !p.hidden.has(pk.id);
              return (
                <li class={shown ? undefined : "off"}>
                  <button type="button" class="icon-btn icon-sm" aria-label={`${L.show}: ${pk.name}`} title={L.show} aria-pressed={shown} onClick={() => p.onToggle(pk.id)}>
                    {shown ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
                  </button>
                  {p.signedIn && (
                    <button type="button" class="icon-btn icon-sm" aria-label={`${L.activePack}: ${pk.name}`} title={L.activePack} aria-pressed={p.active === pk.id} onClick={() => p.onActive(pk.id)}>
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                  )}
                  <span class="pack-name">{pk.name}</span>
                </li>
              );
            })}
          </ul>
          {p.signedIn && <NewPack packs={p.packs} onDone={(id) => p.onActive(id)} />}
        </div>
      )}
    </div>
  );
}

function NewPack({ packs, onDone }: { packs: Pack[]; onDone: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [ext, setExt] = useState<string[]>(packs[0] ? [packs[0].id] : []);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const theId = id || kebab(name);
  if (!open)
    return (
      <button type="button" class="icon-btn icon-sm" aria-label={L.newPack} title={L.newPack} onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" />
      </button>
    );
  const create = async () => {
    if (!theId || !name.trim()) return;
    setBusy(true);
    const r = await newPack(theId, name.trim(), ext);
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setName("");
      setId("");
      onDone(theId);
    } else setFailed(r.error);
  };
  return (
    <form
      class={`new-pack${failed ? " failed" : ""}`}
      aria-label={L.newPack}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <input class="in grow" aria-label={L.packName} value={name} onInput={(e) => (setName((e.currentTarget as HTMLInputElement).value), setFailed(null))} />
      <input class="in mono" aria-label={L.packId} title={failed ?? L.packId} aria-invalid={!!failed} placeholder={kebab(name)} value={id} onInput={(e) => (setId((e.currentTarget as HTMLInputElement).value), setFailed(null))} />
      <div class="tgs" role="group" aria-label={L.packExtends}>
        {packs.map((pk) => (
          <button
            type="button"
            class="tg txt"
            aria-pressed={ext.includes(pk.id)}
            title={L.packExtends}
            onClick={() => setExt(ext.includes(pk.id) ? ext.filter((x) => x !== pk.id) : [...ext, pk.id])}
          >
            {pk.id}
          </button>
        ))}
      </div>
      <button type="submit" class="icon-btn icon-sm" aria-label={L.newPack} title={L.newPack} disabled={busy || !theId || !name.trim()}>
        <Check size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
