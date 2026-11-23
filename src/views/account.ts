// Accounts: JSON endpoints only (the browser side is
// src/client/lib/account.ts).
//
// POST /api/v1/account/passkey, one ceremony in two steps:
//   {step: "<mode>-options"}       -> {options}
//   {step: "<mode>", response}     -> {ok: true, account} | {error}
// mode: "register" ("Create account": a new account, or a visitor's own
// account gets its first passkey), "sign-in" (a passkey we know; a
// visitor's characters and warbands move into that account), "add" (another
// passkey for an account that has one).
//
// POST /api/v1/account/visitor -> {ok: true, account}: the session's
// account, or a new visitor (an account with no passkeys) with a session
// cookie. The browser calls it when a save answers 401 account_required.
// nginx limits it per IP (deploy/nginx/inquisitor-app.inc); here, globally.
//
// AccountInfo.signed_in means the account has a passkey: a visitor is
// signed out as far as the page is concerned.
import {
  addPasskey,
  addPasskeyOptions,
  createAccount,
  createAccountOptions,
  currentViewer,
  deleteAccount,
  ensureVisitor,
  passkeyCount,
  signIn,
  signInOptions,
  signOut,
  type AuthenticationResponse,
  type RegistrationResponse,
} from "../lib/accounts.ts";
import { readJson, sendJson, SMALL_BODY, type Ctx, type Router } from "../lib/http.ts";
import { rateLimit, RateWindow } from "../lib/limits.ts";
import { API, type AccountInfo } from "../shared/api.ts";

// POST /api/v1/import may carry every character a browser kept. Parsing
// it takes several times its size in heap (the service has 48 MB), so it
// is capped, and large bodies are parsed one at a time (readJson).
export const IMPORT_LIMIT = 2 * 1024 * 1024;

// Global limits (nginx limits per IP in front): passkey options (each
// stores a challenge for five minutes), new accounts and new visitors.
export const passkeyOptionsWindow = new RateWindow(600, 10 * 60_000);
export const newAccountWindow = new RateWindow(60, 60 * 60_000);
export const newVisitorWindow = new RateWindow(600, 60 * 60_000);

// signed_in: the account has a passkey (a visitor's page shows "Sign in").
export function accountInfo(ctx: Ctx): AccountInfo {
  const v = currentViewer(ctx);
  return v.passkey ? { signed_in: true, public_id: v.publicId } : { signed_in: false, public_id: null };
}

const signedIn = (ctx: Ctx) => ({ ok: true as const, account: accountInfo(ctx) });

async function passkeyApi(ctx: Ctx): Promise<void> {
  const body = ((await readJson(ctx, SMALL_BODY)) ?? {}) as { step?: string; response?: unknown };
  const response = body.response && typeof body.response === "object" ? body.response : null;
  if (typeof body.step === "string" && body.step.endsWith("-options")) rateLimit(passkeyOptionsWindow);
  switch (body.step) {
    case "register-options":
      return sendJson(ctx, { options: createAccountOptions(currentViewer(ctx)) });
    case "register":
      rateLimit(newAccountWindow);
      if (!response || !(await createAccount(ctx, response as RegistrationResponse))) return sendJson(ctx, { error: "passkey_rejected" }, 400);
      return sendJson(ctx, signedIn(ctx));
    case "sign-in-options":
      return sendJson(ctx, { options: signInOptions() });
    case "sign-in":
      if (!response || !(await signIn(ctx, response as AuthenticationResponse))) return sendJson(ctx, { error: "passkey_unknown" }, 400);
      return sendJson(ctx, signedIn(ctx));
    case "add-options":
    case "add": {
      // Only an account with a passkey adds another (a visitor's first is "register").
      const v = currentViewer(ctx);
      const accountId = v.passkey ? v.accountId : null;
      if (!accountId) return sendJson(ctx, { error: "account_required", account: "required" }, 401);
      if (body.step === "add-options") return sendJson(ctx, { options: addPasskeyOptions(accountId) });
      if (!response || !(await addPasskey(accountId, response as RegistrationResponse))) return sendJson(ctx, { error: "passkey_rejected" }, 400);
      return sendJson(ctx, { ok: true, account: accountInfo(ctx) });
    }
    default:
      return sendJson(ctx, { error: "invalid:step" }, 400);
  }
}

export function accountRoutes(router: Router): void {
  router
    // {signed_in, public_id, passkeys} (passkeys: how many; 0 for a visitor or without a session).
    .get(`${API}/account`, (ctx) => {
      const v = currentViewer(ctx);
      sendJson(ctx, { ...accountInfo(ctx), passkeys: v.accountId ? passkeyCount(v.accountId) : 0 });
    })
    .post(`${API}/account/passkey`, passkeyApi)
    .post(`${API}/account/visitor`, (ctx) => {
      if (!currentViewer(ctx).accountId) {
        rateLimit(newVisitorWindow);
        ensureVisitor(ctx);
      }
      sendJson(ctx, { ok: true, account: accountInfo(ctx) });
    })
    .post(`${API}/account/sign-out`, (ctx) => {
      signOut(ctx);
      sendJson(ctx, { ok: true });
    })
    // Deletes the session's account (a visitor's too) with its passkeys, sessions, characters and warbands.
    .post(`${API}/account/delete`, (ctx) => {
      const accountId = currentViewer(ctx).accountId;
      if (accountId) deleteAccount(ctx, accountId);
      sendJson(ctx, { ok: true });
    });
}
