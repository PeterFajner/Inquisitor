// Signing in (speci's model). Building characters needs no account: they
// live in the browser. Signing in, or creating an account (a new passkey is
// a new account), saves them: the browser's characters go along with the
// sign-in (`importBody`) and the server moves them into the account
// (ImportResult maps their local ids to saved ids).
//
// Browsers without passkeys (some in-app browsers) never see any of this:
// the page marks <html class="no-passkeys"> before first paint, so CSS can
// hide everything that needs one.
//
// The ceremonies go through /api/v1/account/passkey (src/views/account.ts):
//   {step: "<mode>-options"} -> {options}
//   {step: "<mode>", response, import?} -> {ok, account, imported?, import_error?}
// The WebAuthn client is @passwordless-id/webauthn, loaded with import()
// (loadWebauthn) when the sign-in control is shown: Safari wants the tap's
// gesture still live when WebAuthn starts, so fetch the options and the
// library first, then call runPasskey from the tap.
import { API, type AccountInfo, type ImportBody, type ImportResult } from "../../shared/api.ts";
import { api } from "./api.ts";
import { store } from "./store.ts";

export const account = store<{ signedIn: boolean; publicId: string | null }>({ signedIn: false, publicId: null });

export const passkeysUsable = (): boolean => typeof window.PublicKeyCredential === "function" && !!navigator.credentials;

export type PasskeyMode = "sign-in" | "register" | "add";

// What the server sends for each mode (src/lib/passkeys.ts).
type RegisterOptions = {
  challenge: string;
  domain: string;
  user: { id: string; name: string; displayName: string };
  timeout: number;
  userVerification: "required";
  discoverable: "required";
  attestation: false;
  exclude: { id: string; transports: string[] }[];
};
type SignInOptions = { challenge: string; domain: string; timeout: number; userVerification: "required" };
export type PasskeyOptions = RegisterOptions | SignInOptions;

export type SignedIn = { account: AccountInfo; imported?: ImportResult; import_error?: string };

// Throws Error(<code>) when it doesn't work out.
export async function passkeyOptions(mode: PasskeyMode): Promise<PasskeyOptions> {
  const r = await api<{ options?: PasskeyOptions }>(`${API}/account/passkey`, { json: { step: `${mode}-options` } });
  if (!r.ok) throw new Error(r.error);
  if (!r.data.options) throw new Error("no_options");
  return r.data.options;
}

export const loadWebauthn = () => import("@passwordless-id/webauthn");

const fromBase64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// One ceremony with options fetched earlier. On success the account store
// says signed in. Throws Error(<code>): "passkey_rejected",
// "passkey_unknown", "network"..., or the browser's own error (cancelled).
export async function runPasskey(mode: PasskeyMode, options: PasskeyOptions, importBody?: ImportBody): Promise<SignedIn> {
  const { client } = await loadWebauthn();
  let response: unknown;
  if (mode === "sign-in") {
    response = await client.authenticate(options as SignInOptions);
  } else {
    const { exclude, ...o } = options as RegisterOptions;
    const json = await client.register({
      ...o,
      customProperties: { excludeCredentials: exclude.map((c) => ({ type: "public-key", id: fromBase64url(c.id), transports: c.transports })) },
    });
    // The library adds the user it was given; the server knows it already.
    const { user: _user, ...rest } = json;
    response = rest;
  }
  const out = await api<SignedIn & { ok?: boolean }>(`${API}/account/passkey`, {
    json: { step: mode, response, ...(importBody && mode !== "add" ? { import: importBody } : {}) },
  });
  if (!out.ok) throw new Error(out.error);
  account.set({ signedIn: out.data.account.signed_in, publicId: out.data.account.public_id });
  return out.data;
}

// Options, then the ceremony: for when there's no gesture to keep alive.
export async function signInWithPasskey(mode: PasskeyMode, importBody?: ImportBody): Promise<SignedIn> {
  return runPasskey(mode, await passkeyOptions(mode), importBody);
}

// The browser's characters into the signed-in account (after a sign-in
// that didn't carry them, or to retry).
export async function importCharacters(body: ImportBody): Promise<ImportResult> {
  const out = await api<ImportResult>(`${API}/import`, { json: body });
  if (!out.ok) throw new Error(out.error);
  return out.data;
}

// The session ended elsewhere (a 401 from a post): show it signed out.
export function markSignedOut(): void {
  if (account.get().signedIn) account.set({ signedIn: false, publicId: null });
}

export async function signOut(): Promise<boolean> {
  const out = await api(`${API}/account/sign-out`, { method: "POST" });
  if (out.ok) account.set({ signedIn: false, publicId: null });
  return out.ok;
}

// Deletes the account with its characters and warbands. The caller asks
// first (with an icon, not words).
export async function deleteAccount(): Promise<boolean> {
  const out = await api(`${API}/account/delete`, { method: "POST" });
  if (out.ok) account.set({ signedIn: false, publicId: null });
  return out.ok;
}
