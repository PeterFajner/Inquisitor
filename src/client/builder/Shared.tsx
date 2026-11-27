// A share link (/s/<token>): the character and what built it, or its sheet
// (the Edit / Preview tabs), read-only. The bar's second row has the
// Download button and an icon that copies the character into the viewer's
// own (a visitor's, if need be).
import { CopyPlus } from "lucide-preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Character as ApiCharacter, Shared as SharedData } from "../../shared/api.ts";
import { SiteBar } from "../components/SiteBar.tsx";
import { duplicateShared, headVersion } from "../lib/characters.ts";
import { navigate } from "../lib/router.ts";
import { loadRules, type Rules } from "../lib/rules.ts";
import { BalanceLabel, usePinnedRules } from "./Builder.tsx";
import { CharacterView, Companions, useViewTab, ViewTabs, type ViewTab } from "./CharacterView.tsx";
import { ICON, IconButton } from "./Icon.tsx";
import { L } from "./labels.ts";
import * as ops from "./ops.ts";
import { DownloadButton } from "../export/DownloadButton.tsx";
import "./builder.css";

function ReadOnly({ rules, character, tab }: { rules: Rules; character: ApiCharacter; tab: ViewTab }) {
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
      <CharacterView c={shown.compendium} record={record} built={built} tab={tab} />
      <Companions c={shown.compendium} built={built} tab={tab} />
    </section>
  );
}

export function SharedView({ share }: { share: SharedData }) {
  const [rules, setRules] = useState<Rules | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useViewTab();
  useEffect(() => {
    void loadRules().then(setRules, () => {});
  }, []);
  const character = share.character;

  const mine = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await duplicateShared(share.token, character.head_id);
      await navigate(`/c/${encodeURIComponent(c.id)}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div class="builder shared" aria-busy={busy || !rules}>
      <SiteBar page={null}>
        <span class="site-scroll">
          <span class="site-group">
            <DownloadButton variant="bar" disabled={!rules} self={{ name: character.name, head: headVersion(character) }} />
          </span>
          <span class="site-group">
            <IconButton label={L.mine} disabled={busy} onClick={mine}>
              <CopyPlus size={ICON} />
            </IconButton>
          </span>
        </span>
      </SiteBar>
      <main class="builder-main">
        <ViewTabs tab={tab} onPick={setTab} />
        {rules && <ReadOnly rules={rules} character={character} tab={tab} />}
      </main>
    </div>
  );
}
