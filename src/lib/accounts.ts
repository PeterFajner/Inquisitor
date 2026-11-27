// Accounts (speci's model). An account is a random id; it stores no name,
// email, IP or device info. Characters and warbands live only on the server,
// so every browser that saves one has an account:
//
// - A visitor is an account with no passkeys. A browser gets one on its
//   first save (POST /api/v1/account/visitor, which the client calls when a
//   save answers 401 account_required), with the usual session cookie;
//   merely looking around makes none.
// - "Create account" while a visitor puts the new passkey on the visitor's
//   account: everything it saved stays, same ids, same public id.
// - "Sign in" while a visitor moves the visitor's characters
//   into the account signed into, and drops the visitor.
// - "Signed in" (the UI's account state, Viewer.passkey) means the account
//   has a passkey. Only such accounts edit the rules (src/views/rules.ts).
//
// The account id is never shown or sent anywhere but the WebAuthn user
// handle. What history shows as a version's author is the account's public
// id: a short hash of the id, so it can't be turned back into the id and
// isn't the session.
import { createHash, randomBytes } from "node:crypto";
import { all, get, NOW, run, transaction } from "./db.ts";
import { moveAccountData } from "./characters.ts";
import { moveSettings } from "./settings.ts";
import { HttpError, setCookie, type Ctx } from "./http.ts";
import {
  newChallenge,
  registerOptions,
  signInOptions as passkeySignInOptions,
  verifyNewPasskey,
  verifySignIn,
  type AuthenticationResponse,
  type NewPasskey,
  type RegisterOptionsJSON,
  type RegistrationResponse,
  type SignInOptionsJSON,
  type StoredPasskey,
} from "./passkeys.ts";

export type { AuthenticationResponse, RegistrationResponse };

export const SESSION_COOKIE = "inquisitor_session";
const SESSION_DAYS = 180;

// Who's asking: ids null without a session; passkey false for a visitor.
export type Viewer = { accountId: string | null; publicId: string | null; passkey: boolean };
export const ANONYMOUS: Viewer = { accountId: null, publicId: null, passkey: false };

// The site's origin; its hostname is the passkey RP ID, permanently
// inquisitor.pfaj.ca in production. Defaults to the dev server on its own port.
export function publicOrigin(): URL {
  return new URL(process.env.PUBLIC_ORIGIN || `http://localhost:${process.env.PORT || 3010}`);
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

// 10 base64url characters (60 bits) of SHA-256 over the account id.
export const publicIdOf = (accountId: string): string =>
  createHash("sha256").update(`inquisitor-account:${accountId}`).digest("base64url").slice(0, 10);

// ---------------------------------------------------------------------------
// Who's viewing
// ---------------------------------------------------------------------------

type WithViewer = Ctx & { viewer?: Viewer };

// The session's account (a visitor or one with passkeys), if the session
// cookie is valid. Cached per request. Notes the account as seen (at most
// once a day: accounts.last_seen_at, for a later cleanup of old visitors).
export function currentViewer(ctx: Ctx): Viewer {
  const c = ctx as WithViewer;
  if (c.viewer) return c.viewer;
  const token = ctx.cookies[SESSION_COOKIE];
  const row = token
    ? get<{ id: string; public_id: string; passkey: number; stale: number }>(
        `SELECT a.id, a.public_id,
                EXISTS (SELECT 1 FROM account_passkeys p WHERE p.account_id = a.id) AS passkey,
                (a.last_seen_at IS NULL OR a.last_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')) AS stale
           FROM account_sessions s JOIN accounts a ON a.id = s.account_id
          WHERE s.token_hash = ?1 AND s.expires_at > ${NOW}`,
        [hashToken(token)],
      )
    : undefined;
  if (row?.stale) run(`UPDATE accounts SET last_seen_at = ${NOW} WHERE id = ?1`, [row.id]);
  c.viewer = row ? { accountId: row.id, publicId: row.public_id, passkey: !!row.passkey } : ANONYMOUS;
  return c.viewer;
}

// ---------------------------------------------------------------------------
// Sessions and challenges
// ---------------------------------------------------------------------------

// A new session (and cookie) for the account; the browser's old session,
// if any, ends.
function startSession(ctx: Ctx, accountId: string, passkey: boolean): void {
  const old = ctx.cookies[SESSION_COOKIE];
  if (old) run(`DELETE FROM account_sessions WHERE token_hash = ?1`, [hashToken(old)]);
  const token = randomBytes(32).toString("base64url");
  run(
    `INSERT INTO account_sessions (token_hash, account_id, expires_at)
     VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${SESSION_DAYS} days'))`,
    [hashToken(token), accountId],
  );
  setCookie(ctx, SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 24 * 60 * 60 });
  (ctx as WithViewer).viewer = { accountId, publicId: publicIdOf(accountId), passkey };
}

// The session's account, or a new visitor (an account without passkeys)
// signed in now. The caller rate-limits (src/views/account.ts).
export function ensureVisitor(ctx: Ctx): Viewer {
  const v = currentViewer(ctx);
  if (v.accountId) return v;
  const id = randomBytes(16).toString("base64url");
  run(`INSERT INTO accounts (id, public_id, last_seen_at) VALUES (?1, ?2, ${NOW})`, [id, publicIdOf(id)]);
  startSession(ctx, id, false);
  return currentViewer(ctx);
}

export function signOut(ctx: Ctx): void {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token) run(`DELETE FROM account_sessions WHERE token_hash = ?1`, [hashToken(token)]);
  run(`DELETE FROM account_sessions WHERE expires_at <= ${NOW}`);
  setCookie(ctx, SESSION_COOKIE, "", { maxAge: 0 });
  (ctx as WithViewer).viewer = ANONYMOUS;
}

type Purpose = "register" | "add" | "sign-in";

/** Unused challenges kept at most (each lives five minutes). */
export const MAX_CHALLENGES = 2000;

function saveChallenge(challenge: string, purpose: Purpose, accountId: string | null = null, newAccountId: string | null = null): void {
  run(`DELETE FROM account_challenges WHERE expires_at <= ${NOW}`);
  const n = (get<{ n: number }>(`SELECT count(*) AS n FROM account_challenges`)?.n ?? 0);
  if (n >= MAX_CHALLENGES) throw new HttpError(503, "busy");
  run(
    `INSERT INTO account_challenges (challenge, purpose, account_id, new_account_id, expires_at)
     VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+5 minutes'))`,
    [challenge, purpose, accountId, newAccountId],
  );
}

// Single use.
const consumeChallenge =
  (purpose: Purpose, accountId: string | null = null) =>
  (challenge: string): boolean =>
    run(
      `DELETE FROM account_challenges WHERE challenge = ?1 AND purpose = ?2 AND account_id IS ?3 AND expires_at > ${NOW}`,
      [challenge, purpose, accountId],
    ).changes > 0;

// ---------------------------------------------------------------------------
// Passkey ceremonies
// ---------------------------------------------------------------------------

const rp = (isChallenge: (c: string) => boolean) => ({ origin: publicOrigin(), isChallenge });

function storePasskey(accountId: string, p: NewPasskey): void {
  run(
    `INSERT INTO account_passkeys (id, account_id, public_key, algorithm, counter, transports)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    [p.id, accountId, p.public_key, p.algorithm, p.counter, p.transports.length ? JSON.stringify(p.transports) : null],
  );
}

const USER = { name: "Inquisitor", displayName: "Inquisitor" };

// "Create account". The WebAuthn user id is the account id, carried through
// the challenge so the passkey and the account match. A visitor's own
// account gets the passkey (account_id names it in the challenge, so only
// that visitor's session can use it); anyone else gets a new account, its
// id generated now (no row exists until it succeeds).
export function createAccountOptions(viewer: Viewer): RegisterOptionsJSON {
  const visitor = viewer.accountId && !viewer.passkey ? viewer.accountId : null;
  const accountId = visitor ?? randomBytes(16).toString("base64url");
  const challenge = newChallenge();
  saveChallenge(challenge, "register", visitor, accountId);
  return registerOptions({ origin: publicOrigin(), challenge, user: { id: accountId, ...USER }, exclude: [] });
}

// Creates the account (or gives the visitor its first passkey) and signs it
// in; its id, or null when the passkey doesn't check out.
export async function createAccount(ctx: Ctx, response: RegistrationResponse): Promise<string | null> {
  const viewer = currentViewer(ctx);
  let target: { account_id: string | null; new_account_id: string } | undefined;
  const passkey = await verifyNewPasskey(
    response,
    rp((c) => {
      target = get<{ account_id: string | null; new_account_id: string }>(
        `DELETE FROM account_challenges
          WHERE challenge = ?1 AND purpose = 'register' AND expires_at > ${NOW}
         RETURNING account_id, new_account_id`,
        [c],
      );
      // A visitor's challenge works only from that visitor's session.
      return target !== undefined && (target.account_id === null || target.account_id === viewer.accountId);
    }),
  );
  if (!passkey || !target) return null;
  const id = target.new_account_id;
  const visitor = target.account_id;
  try {
    transaction(() => {
      if (visitor) {
        // Still a visitor (no passkey added meanwhile)?
        if (passkeyCount(visitor) > 0) throw new Error("not a visitor");
      } else {
        run(`INSERT INTO accounts (id, public_id, last_seen_at) VALUES (?1, ?2, ${NOW})`, [id, publicIdOf(id)]);
      }
      storePasskey(id, passkey);
    });
  } catch {
    return null; // e.g. a passkey id that's already registered
  }
  startSession(ctx, id, true);
  return id;
}

export function signInOptions(): SignInOptionsJSON {
  const challenge = newChallenge();
  saveChallenge(challenge, "sign-in");
  return passkeySignInOptions({ origin: publicOrigin(), challenge });
}

// Signs in; the account id, or null when the passkey isn't one we know or
// doesn't check out. A visitor signing in brings its characters and
// settings into the account, and the visitor account goes.
export async function signIn(ctx: Ctx, response: AuthenticationResponse): Promise<string | null> {
  const before = currentViewer(ctx);
  const stored = get<StoredPasskey & { account_id: string }>(
    `SELECT id, account_id, public_key, algorithm, counter, transports FROM account_passkeys WHERE id = ?1`,
    [String(response?.id ?? "")],
  );
  if (!stored) return null;
  const ok = await verifySignIn(response, stored, rp(consumeChallenge("sign-in")));
  if (!ok) return null;
  run(`UPDATE account_passkeys SET counter = ?2, last_used_at = ${NOW} WHERE id = ?1`, [stored.id, ok.counter]);
  const visitor = before.accountId && !before.passkey && before.accountId !== stored.account_id ? before.accountId : null;
  if (visitor) {
    transaction(() => {
      moveAccountData(visitor, stored.account_id);
      moveSettings(visitor, stored.account_id);
      run(`DELETE FROM accounts WHERE id = ?1`, [visitor]);
    });
  }
  startSession(ctx, stored.account_id, true);
  return stored.account_id;
}

// Another passkey for the signed-in account (a second device).
export function addPasskeyOptions(accountId: string): RegisterOptionsJSON {
  const challenge = newChallenge();
  saveChallenge(challenge, "add", accountId);
  const exclude = all<{ id: string; transports: string | null }>(`SELECT id, transports FROM account_passkeys WHERE account_id = ?1`, [accountId]);
  return registerOptions({ origin: publicOrigin(), challenge, user: { id: accountId, ...USER }, exclude });
}

export async function addPasskey(accountId: string, response: RegistrationResponse): Promise<boolean> {
  const passkey = await verifyNewPasskey(response, rp(consumeChallenge("add", accountId)));
  if (!passkey) return false;
  try {
    storePasskey(accountId, passkey);
    return true;
  } catch {
    return false; // already registered
  }
}

export const passkeyCount = (accountId: string): number =>
  get<{ n: number }>(`SELECT count(*) AS n FROM account_passkeys WHERE account_id = ?1`, [accountId])?.n ?? 0;

// Deletes the account with its passkeys, sessions, characters, settings and
// their share links (cascades). Ownerless share-only snapshots (from before
// visitors) stay: they were never the account's.
export function deleteAccount(ctx: Ctx, accountId: string): void {
  run(`DELETE FROM accounts WHERE id = ?1`, [accountId]);
  setCookie(ctx, SESSION_COOKIE, "", { maxAge: 0 });
  (ctx as WithViewer).viewer = ANONYMOUS;
}
