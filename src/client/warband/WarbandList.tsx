// The warbands in the builder's list column, under the characters: a new
// warband icon, then each warband (its name, and its characters' names).
import { Plus, Users } from "lucide-preact";
import type { Warband } from "../../shared/api.ts";
import { ICON, IconButton } from "../builder/Icon.tsx";
import { W } from "./labels.ts";
import "./warband.css";

type Props = {
  warbands: Warband[];
  current: string | null;
  /** id → the character's name, for the row's second line. */
  names: Map<string, string>;
  disabled?: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
};

export function WarbandList(p: Props) {
  return (
    <div class="wb-list" aria-label={W.warbands} role="group">
      <div class="wb-list-head">
        <IconButton label={W.newWarband} disabled={p.disabled} onClick={p.onCreate}>
          <span class="wb-new-icon">
            <Users size={ICON} />
            <Plus size={12} class="wb-new-plus" />
          </span>
        </IconButton>
      </div>
      <ul>
        {p.warbands.map((w) => (
          <li key={w.id}>
            <button type="button" class="char-row wb-row" aria-current={w.id === p.current ? "true" : undefined} onClick={() => p.onSelect(w.id)}>
              <span class="char-row-name">
                <Users size={14} class="wb-row-icon" aria-hidden="true" />
                {w.name || "–"}
              </span>
              <span class="char-row-tag">
                {w.character_ids
                  .map((id) => p.names.get(id))
                  .filter((n) => n !== undefined)
                  .map((n) => n || "–")
                  .join(", ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
