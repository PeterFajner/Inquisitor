// An account's export settings (owner, November 2026): the format of the
// Download button ("docx" or "pdf") and, per character, the other characters
// downloaded with it (the button's "Include other characters"). Kept for the
// account, a visitor's too, so they follow the session, not the browser.
// GET answers the defaults without a session; a change needs an account
// (401 account_required: the browser gets a visitor and tries again).
import { all, get, NOW, run } from "./db.ts";
import { HttpError } from "./http.ts";
import type { Viewer } from "./accounts.ts";
import { requireAccount } from "./characters.ts";
import { EXPORT_FORMATS, type ExportFormat, type Settings } from "../shared/api.ts";

export const MAX_WITH = 100;

const invalid = (field: string): never => {
  throw new HttpError(400, `invalid:${field}`);
};
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

const DEFAULTS: Settings = { format: "docx", with: {} };

function stored(accountId: string): Settings {
  const row = get<{ settings: string }>(`SELECT settings FROM account_settings WHERE account_id = ?1`, [accountId]);
  if (!row) return { format: DEFAULTS.format, with: {} };
  try {
    const s = JSON.parse(row.settings) as Partial<Settings>;
    return { format: EXPORT_FORMATS.includes(s.format as ExportFormat) ? s.format! : DEFAULTS.format, with: isObject(s.with) ? (s.with as Settings["with"]) : {} };
  } catch {
    return { format: DEFAULTS.format, with: {} };
  }
}

function write(accountId: string, s: Settings): void {
  run(
    `INSERT INTO account_settings (account_id, settings) VALUES (?1, ?2)
      ON CONFLICT (account_id) DO UPDATE SET settings = excluded.settings, updated_at = ${NOW}`,
    [accountId, JSON.stringify(s)],
  );
}

const ownedIds = (accountId: string): Set<string> =>
  new Set(all<{ id: string }>(`SELECT id FROM characters WHERE owner_id = ?1`, [accountId]).map((r) => r.id));

/** The account's settings; `with` names only its own characters that are still there. */
export function getSettings(viewer: Viewer): Settings {
  if (!viewer.accountId) return { format: DEFAULTS.format, with: {} };
  const s = stored(viewer.accountId);
  const mine = ownedIds(viewer.accountId);
  const out: Settings["with"] = {};
  for (const [id, others] of Object.entries(s.with)) {
    if (!mine.has(id) || !Array.isArray(others)) continue;
    const kept = others.filter((o) => typeof o === "string" && o !== id && mine.has(o));
    if (kept.length) out[id] = kept;
  }
  return { format: s.format, with: out };
}

/** Changes the format and/or one character's others ({ format?, character_id?, with? }). */
export function updateSettings(viewer: Viewer, input: unknown): Settings {
  const accountId = requireAccount(viewer);
  const b = isObject(input) ? input : invalid("body");
  const s = stored(accountId);
  if (b.format !== undefined) s.format = EXPORT_FORMATS.includes(b.format as ExportFormat) ? (b.format as ExportFormat) : invalid("format");
  if (b.character_id !== undefined || b.with !== undefined) {
    const mine = ownedIds(accountId);
    const id = typeof b.character_id === "string" && mine.has(b.character_id) ? b.character_id : invalid("character_id");
    const others = Array.isArray(b.with) && b.with.length <= MAX_WITH ? b.with : invalid("with");
    const ids = [...new Set(others.map((o) => (typeof o === "string" && o !== id && mine.has(o) ? o : invalid("with"))))];
    if (ids.length) s.with[id] = ids;
    else delete s.with[id];
  }
  write(accountId, s);
  return getSettings(viewer);
}

/** A visitor signing in: its settings join the account's (the account's own win). Run inside a transaction. */
export function moveSettings(from: string, to: string): void {
  if (!get(`SELECT 1 AS x FROM account_settings WHERE account_id = ?1`, [from])) return;
  const a = stored(from);
  const had = get(`SELECT 1 AS x FROM account_settings WHERE account_id = ?1`, [to]);
  const b = stored(to);
  write(to, { format: had ? b.format : a.format, with: { ...a.with, ...b.with } });
}
