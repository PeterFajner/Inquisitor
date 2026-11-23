// Accounts: JSON endpoints only (the browser side is
// src/client/lib/account.ts).
//
// POST /api/v1/account/passkey, one ceremony in two steps:
//   {step: "<mode>-options"}                 -> {options}
//   {step: "<mode>", response, import?}      -> {ok: true, account, imported?} | {error}
// mode: "register" (a new passkey is a new account), "sign-in" (a passkey
// we know), "add" (another passkey for the signed-in account). `import`
// (ImportBody) moves the browser's characters into the account in the same
// request; `imported` maps their local ids to the saved ones.
import {
  addPasskey,
  addPasskeyOptions,
  createAccount,
  createAccountOptions,
  currentViewer,
  deleteAccount,
  passkeyCount,
  signIn,
  signInOptions,
  signOut,
  type AuthenticationResponse,
  type RegistrationResponse,
} from "../lib/accounts.ts";
import { importBrowser } from "../lib/characters.ts";
import { HttpError, readJson, sendJson, type Ctx, type Router } from "../lib/http.ts";
import { API, type AccountInfo, type ImportResult } from "../shared/api.ts";

// The import may carry every character the browser has.
export const IMPORT_LIMIT = 8 * 1024 * 1024;

export function accountInfo(ctx: Ctx): AccountInfo {
  const v = currentViewer(ctx);
  return { signed_in: v.accountId !== null, public_id: v.publicId };
}

// Signed in now: the reply, with the import done if one came along. A bad
// import doesn't undo the sign-in: it comes back as import_error (the
// code POST /api/v1/import would have answered) and nothing is imported.
function signedIn(ctx: Ctx, importBody: unknown): { ok: true; account: AccountInfo; imported?: ImportResult; import_error?: string } {
  const account = accountInfo(ctx);
  if (importBody === undefined) return { ok: true, account };
  try {
    return { ok: true, account, imported: importBrowser(currentViewer(ctx), importBody) };
  } catch (e) {
    if (e instanceof HttpError) return { ok: true, account, import_error: e.message };
    throw e;
  }
}

async function passkeyApi(ctx: Ctx): Promise<void> {
  const body = ((await readJson(ctx, IMPORT_LIMIT)) ?? {}) as { step?: string; response?: unknown; import?: unknown };
  const response = body.response && typeof body.response === "object" ? body.response : null;
  switch (body.step) {
    case "register-options":
      return sendJson(ctx, { options: createAccountOptions() });
    case "register":
      if (!response || !(await createAccount(ctx, response as RegistrationResponse))) return sendJson(ctx, { error: "passkey_rejected" }, 400);
      return sendJson(ctx, signedIn(ctx, body.import));
    case "sign-in-options":
      return sendJson(ctx, { options: signInOptions() });
    case "sign-in":
      if (!response || !(await signIn(ctx, response as AuthenticationResponse))) return sendJson(ctx, { error: "passkey_unknown" }, 400);
      return sendJson(ctx, signedIn(ctx, body.import));
    case "add-options":
    case "add": {
      const accountId = currentViewer(ctx).accountId;
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
    // {signed_in, public_id, passkeys} (passkeys: how many; 0 signed out).
    .get(`${API}/account`, (ctx) => {
      const v = currentViewer(ctx);
      sendJson(ctx, { ...accountInfo(ctx), passkeys: v.accountId ? passkeyCount(v.accountId) : 0 });
    })
    .post(`${API}/account/passkey`, passkeyApi)
    .post(`${API}/account/sign-out`, (ctx) => {
      signOut(ctx);
      sendJson(ctx, { ok: true });
    })
    // Deletes the account with its passkeys, sessions, characters and warbands.
    .post(`${API}/account/delete`, (ctx) => {
      const accountId = currentViewer(ctx).accountId;
      if (accountId) deleteAccount(ctx, accountId);
      sendJson(ctx, { ok: true });
    });
}
