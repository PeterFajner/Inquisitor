// Share links (/s/<token>, read-only): a character or warband gets its own
// link (the same one each time), showing it as it is now.
import { API } from "../../shared/api.ts";
import { api } from "../lib/api.ts";

async function post(url: string): Promise<string> {
  const r = await api<{ token: string; url: string }>(url, { method: "POST" });
  if (!r.ok) throw new Error(r.error);
  return new URL(r.data.url, location.origin).href;
}

/** The character's share link (absolute). */
export const shareCharacter = (id: string): Promise<string> => post(`${API}/characters/${encodeURIComponent(id)}/share`);

/** The warband's share link (absolute). */
export const shareWarband = (id: string): Promise<string> => post(`${API}/warbands/${encodeURIComponent(id)}/share`);

/** Copies text to the clipboard; false when the browser won't. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
