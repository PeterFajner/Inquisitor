// /c/<id>/history: one of the viewer's characters as its version tree
// (src/client/history/HistoryView.tsx). Making a version the head saves
// here; opening one in the builder makes it the head first, so edits there
// branch from it; duplicating opens the new character in the builder.
// #v=<version id> selects and shows that version (source links use it).
import { ArrowLeft } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import type { Character, PageData } from "../../shared/api.ts";
import { ICON, IconButton } from "../builder/Icon.tsx";
import { SiteBar } from "../components/SiteBar.tsx";
import { HistoryView } from "../history/HistoryView.tsx";
import { H } from "../history/labels.ts";
import { findSource } from "../history/source.ts";
import { characters } from "../lib/characters.ts";
import { loadRules, type Rules } from "../lib/rules.ts";
import "../history/page.css";

const enc = encodeURIComponent;
const hashVersion = (): string | null => {
  const m = /^#v=(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
};

export function HistoryPage({ data }: { data: PageData }) {
  const [char, setChar] = useState<Character | null>(data.character ?? null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadRules().then(setRules, () => setRules(null));
  }, []);
  if (!char) return <main />;

  const setHead = async (versionId: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      await characters.setHead(char.id, versionId);
      const v = char.versions.find((x) => x.id === versionId);
      const name = v && typeof v.record.name === "string" ? v.record.name : char.name;
      if (name !== char.name) await characters.rename(char.id, name);
      setChar({ ...char, head_id: versionId, name });
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };

  const open = async (versionId: string) => {
    if (versionId === char.head_id || (await setHead(versionId))) location.assign(`/c/${enc(char.id)}`);
  };

  const duplicate = async (versionId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await characters.duplicate(char.id, versionId);
      location.assign(`/c/${enc(c.id)}`);
    } catch {
      setBusy(false);
    }
  };

  const sourceHref = async (versionId: string) => {
    const id = await findSource(characters, versionId, char.id);
    return id ? `/c/${enc(id)}/history#v=${enc(versionId)}` : null;
  };

  return (
    <div class="history-page" aria-busy={busy || !rules}>
      <SiteBar page="characters">
        <IconButton label={H.builder} href={`/c/${enc(char.id)}`}>
          <ArrowLeft size={ICON} />
        </IconButton>
        <h1 class="history-name">{char.name}</h1>
      </SiteBar>
      <main class="history-main">
        <HistoryView
          versions={char.versions}
          headId={char.head_id}
          rules={rules}
          busy={busy}
          focus={hashVersion()}
          onSetHead={char.mine ? (id) => void setHead(id) : undefined}
          onOpen={char.mine ? (id) => void open(id) : undefined}
          onDuplicate={char.mine ? duplicate : undefined}
          sourceHref={sourceHref}
        />
      </main>
    </div>
  );
}
