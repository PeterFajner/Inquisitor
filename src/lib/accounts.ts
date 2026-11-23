// Accounts (speci's model). An account is a random id with passkeys; it
// stores no name, email, IP or device info. Building characters needs no
// account (they live in the browser); saving them does. Signing in (or
// creating an account) moves the browser's characters into the account
// (importBrowser in characters.ts, sent with the sign-in).
//
// The account id is never shown or sent anywhere but the WebAuthn user
// handle. What history shows as a version's author is the account's public
// id: a short hash of the id, so it can't be turned back into the id and
// isn't the session.
import { createHash, randomBytes } from "node:crypto";
import { all, get, NOW, run, transaction } from "./db.ts";
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

// Who's asking: both null when signed out.
export type Viewer = { accountId: string | null; publicId: string | null };
export const ANONYMOUS: Viewer = { accountId: null, publicId: null };

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

// The signed-in account, if the session cookie is valid. Cached per request.
export function currentViewer(ctx: Ctx): Viewer {
  const c = ctx as WithViewer;
  if (c.viewer) return c.viewer;
  const token = ctx.cookies[SESSION_COOKIE];
  const row = token
    ? get<{ id: string; public_id: string }>(
        `SELECT a.id, a.public_id FROM account_sessions s JOIN accounts a ON a.id = s.account_id
          WHERE s.token_hash = ?1 AND s.expires_at > ${NOW}`,
        [hashToken(token)],
      )
    : undefined;
  c.viewer = row ? { accountId: row.id, publicId: row.public_id } : ANONYMOUS;
  return c.viewer;
}

// ---------------------------------------------------------------------------
// Sessions and challenges
// ---------------------------------------------------------------------------

function startSession(ctx: Ctx, accountId: string): void {
  const token = randomBytes(32).toString("base64url");
  run(
    `INSERT INTO account_sessions (token_hash, account_id, expires_at)
     VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${SESSION_DAYS} days'))`,
    [hashToken(token), accountId],
  );
  setCookie(ctx, SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 24 * 60 * 60 });
  (ctx as WithViewer).viewer = { accountId, publicId: publicIdOf(accountId) };
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

// A new account: the WebAuthn user id is the account id, generated now and
// carried through the challenge so the passkey and the account match.
export function createAccountOptions(): RegisterOptionsJSON {
  const accountId = randomBytes(16).toString("base64url");
  const challenge = newChallenge();
  // The account row doesn't exist yet; its id waits with the challenge.
  saveChallenge(challenge, "register", null, accountId);
  return registerOptions({ origin: publicOrigin(), challenge, user: { id: accountId, ...USER }, exclude: [] });
}

// Creates the account and signs it in; its id, or null when the passkey
// doesn't check out.
export async function createAccount(ctx: Ctx, response: RegistrationResponse): Promise<string | null> {
  let accountId: string | undefined;
  const passkey = await verifyNewPasskey(
    response,
    rp((c) => {
      accountId = get<{ new_account_id: string }>(
        `DELETE FROM account_challenges
          WHERE challenge = ?1 AND purpose = 'register' AND expires_at > ${NOW}
         RETURNING new_account_id`,
        [c],
      )?.new_account_id;
      return accountId !== undefined;
    }),
  );
  if (!passkey || !accountId) return null;
  const id = accountId;
  try {
    transaction(() => {
      run(`INSERT INTO accounts (id, public_id) VALUES (?1, ?2)`, [id, publicIdOf(id)]);
      storePasskey(id, passkey);
    });
  } catch {
    return null; // e.g. a passkey id that's already registered
  }
  startSession(ctx, id);
  return id;
}

export function signInOptions(): SignInOptionsJSON {
  const challenge = newChallenge();
  saveChallenge(challenge, "sign-in");
  return passkeySignInOptions({ origin: publicOrigin(), challenge });
}

// Signs in; the account id, or null when the passkey isn't one we know or
// doesn't check out.
export async function signIn(ctx: Ctx, response: AuthenticationResponse): Promise<string | null> {
  const stored = get<StoredPasskey & { account_id: string }>(
    `SELECT id, account_id, public_key, algorithm, counter, transports FROM account_passkeys WHERE id = ?1`,
    [String(response?.id ?? "")],
  );
  if (!stored) return null;
  const ok = await verifySignIn(response, stored, rp(consumeChallenge("sign-in")));
  if (!ok) return null;
  run(`UPDATE account_passkeys SET counter = ?2, last_used_at = ${NOW} WHERE id = ?1`, [stored.id, ok.counter]);
  startSession(ctx, stored.account_id);
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

// Deletes the account with its passkeys, sessions, characters, warbands and
// their share links (cascades). Characters it shared signed out stay: they
// were never the account's.
export function deleteAccount(ctx: Ctx, accountId: string): void {
  run(`DELETE FROM accounts WHERE id = ?1`, [accountId]);
  setCookie(ctx, SESSION_COOKIE, "", { maxAge: 0 });
  (ctx as WithViewer).viewer = ANONYMOUS;
}
