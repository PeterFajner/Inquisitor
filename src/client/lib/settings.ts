// The account's export settings (GET/POST /api/v1/settings,
// src/lib/settings.ts): the Download button's format and, per character, the
// other characters downloaded with it. Kept on the server with the account
// (owner, November 2026), loaded once per account; a change shows at once
// and is sent (as a visitor if this browser has no account yet).
import { API, type ExportFormat, type Settings } from "../../shared/api.ts";
import { account } from "./account.ts";
import { api } from "./api.ts";
import { unwrap, withVisitor } from "./characters.ts";
import { store } from "./store.ts";

export const settings = store<Settings>({ format: "docx", with: {} });

let loadedFor: string | null | undefined;

/** Loads the account's settings (again after the account changes). */
export async function loadSettings(): Promise<void> {
  const who = account.get().publicId ?? "";
  if (loadedFor === who) return;
  loadedFor = who;
  const r = await api<{ settings: Settings }>(`${API}/settings`);
  if (r.ok) settings.set(r.data.settings);
}
account.subscribe(() => {
  if (loadedFor !== undefined && loadedFor !== (account.get().publicId ?? "")) void loadSettings();
});

// The page keeps what it shows (answers may come back out of order).
async function send(body: { format?: ExportFormat; character_id?: string; with?: string[] }): Promise<void> {
  try {
    unwrap(await withVisitor(() => api<{ settings: Settings }>(`${API}/settings`, { json: body })));
  } catch {
    // Kept as shown in this page; the next load has the server's.
  }
}

export function setFormat(format: ExportFormat): void {
  settings.set({ format });
  void send({ format });
}

/** The others downloaded with `characterId` (in the list's order). */
export function setWith(characterId: string, others: string[]): void {
  const next = { ...settings.get().with };
  if (others.length) next[characterId] = others;
  else delete next[characterId];
  settings.set({ with: next });
  void send({ character_id: characterId, with: others });
}
