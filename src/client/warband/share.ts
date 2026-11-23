// Share links (/s/<token>, read-only). A saved character or warband gets
// its own link (the same one each time); one kept in this browser is sent
// as a snapshot (POST /api/v1/share: saved without an owner, read-only for
// good), remembered per version so sharing it again reuses the link.
import { API, type Character, type NewCharacter, type ShareSnapshot } from "../../shared/api.ts";
import { api } from "../lib/api.ts";
import { headVersion, localBackend, type ListRow } from "../lib/characters.ts";

const SNAPSHOTS = "inquisitor:snapshots:v1";

function remembered(key: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(SNAPSHOTS) || "{}") as Record<string, string>;
    return all[key] ?? null;
  } catch {
    return null;
  }
}
function remember(key: string, url: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(SNAPSHOTS) || "{}") as Record<string, string>;
    all[key] = url;
    localStorage.setItem(SNAPSHOTS, JSON.stringify(all));
  } catch {}
}

async function post(url: string, body?: unknown): Promise<string> {
  const r = await api<{ token: string; url: string }>(url, body === undefined ? { method: "POST" } : { json: body });
  if (!r.ok) throw new Error(r.error);
  return new URL(r.data.url, location.origin).href;
}

const snapshotOf = (row: { name: string; head: ListRow["head"] }): NewCharacter => ({
  name: row.name,
  record: row.head.record,
  rules_version: row.head.rules_version,
  // a snapshot has no source to name, so a duplicated head goes as a plain version
  kind: row.head.kind === "duplicate" ? "manual" : row.head.kind,
});

/** The character's share link (absolute). */
export async function shareCharacter(c: Character, local: boolean): Promise<string> {
  if (!local) return post(`${API}/characters/${encodeURIComponent(c.id)}/share`);
  const head = headVersion(c);
  const key = `c:${c.id}:${head.id}:${c.name}`;
  const have = remembered(key);
  if (have) return have;
  const url = await post(`${API}/share`, { character: snapshotOf({ name: c.name, head }) } satisfies ShareSnapshot);
  remember(key, url);
  return url;
}

/** The warband's share link (absolute); `members` are its characters in order. */
export async function shareWarband(id: string, name: string, members: ListRow[], local: boolean): Promise<string> {
  if (!local) return post(`${API}/warbands/${encodeURIComponent(id)}/share`);
  const key = `w:${id}:${name}:${members.map((m) => `${m.id}@${m.head.id}:${m.name}`).join(",")}`;
  const have = remembered(key);
  if (have) return have;
  // Local rows are summaries; the heads are what a snapshot needs.
  const heads = await Promise.all(members.map(async (m) => ({ name: m.name, head: headVersion(await localBackend.get(m.id)) })));
  const url = await post(`${API}/share`, { warband: { name, characters: heads.map(snapshotOf) } } satisfies ShareSnapshot);
  remember(key, url);
  return url;
}

/** Copies text to the clipboard; false when the browser won't. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
