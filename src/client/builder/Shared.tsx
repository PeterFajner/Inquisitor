// A share link (/s/<token>): the character's sheet and what built it,
// read-only; a warband's characters one after another. The bar's second row
// has the exports and an icon that copies a character into the viewer's own
// (a visitor's, if need be).
import { CopyPlus } from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Character as ApiCharacter, Shared as SharedData } from "../../shared/api.ts";
import { SiteBar } from "../components/SiteBar.tsx";
import { duplicateShared, headVersion } from "../lib/characters.ts";
import { loadRules, type Rules } from "../lib/rules.ts";
import { BalanceLabel, usePinnedRules } from "./Builder.tsx";
import { CharacterView } from "./CharacterView.tsx";
import { ICON, IconButton } from "./Icon.tsx";
import { L } from "./labels.ts";
import * as ops from "./ops.ts";
import { ExportButtons } from "../export/ExportButtons.tsx";
import { useBuiltMembers, useWarnings, Warnings } from "../warband/WarbandView.tsx";
import "./builder.css";

function ReadOnly({ rules, character }: { rules: Rules; character: ApiCharacter }) {
  const head = headVersion(character);
  const record = useMemo(() => ops.engineRecord(head.record), [head]);
  const shown = usePinnedRules(rules, head.rules_version) ?? rules;
  const built = useMemo(() => {
    if (!record) return null;
    try {
      return ops.view(shown.compendium, record);
    } catch {
      return null;
    }
  }, [shown, record]);
  if (!record || !built) return null;
  return (
    <section class="shared-char">
      <div class="balance-line">
        <BalanceLabel rules={shown} built={built} />
      </div>
      <CharacterView c={shown.compendium} record={record} built={built} />
    </section>
  );
}

export function SharedView({ share }: { share: SharedData }) {
  const [rules, setRules] = useState<Rules | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadRules().then(setRules, () => {});
  }, []);
  const characters = share.kind === "character" ? [share.character] : share.characters;
  // A warband's rows, for its warnings and the exports.
  const rows = useMemo(
    () => characters.map((c) => ({ id: c.id, name: c.name, head: headVersion(c), updated_at: c.updated_at })),
    [share.token],
  );
  const builtMembers = useBuiltMembers(share.kind === "warband" ? rules : null, rows);
  const warnings = useWarnings(rules, builtMembers);

  const mine = async () => {
    if (share.kind !== "character" || busy) return;
    setBusy(true);
    try {
      const c = await duplicateShared(share.token, share.character.head_id);
      location.assign(`/c/${encodeURIComponent(c.id)}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div class="builder shared" aria-busy={busy || !rules}>
      <SiteBar page={null}>
        <span class="site-scroll">
          <span class="site-group">
            <ExportButtons disabled={!rules || !rows.length} caption rows={() => rows} name={share.kind === "warband" ? share.warband.name : undefined} />
          </span>
          {share.kind === "character" && (
            <span class="site-group">
              <IconButton label={L.mine} disabled={busy} onClick={mine}>
                <CopyPlus size={ICON} />
              </IconButton>
            </span>
          )}
        </span>
      </SiteBar>
      <main class="builder-main">
        {share.kind === "warband" && share.warband.name && <h2 class="wb-name">{share.warband.name}</h2>}
        {share.kind === "warband" && <Warnings warnings={warnings} names={new Map(rows.map((r) => [r.id, r.name]))} />}
        {rules && characters.map((c) => <ReadOnly rules={rules} character={c} />)}
      </main>
    </div>
  );
}
