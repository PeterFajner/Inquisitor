// Signing in (speci's model). Building characters needs no account: they
// live in the browser. Signing in, or creating an account (a new passkey is
// a new account), saves them: right after the sign-in the browser's
// characters (`importBody`) go to POST /api/v1/import, which moves them
// into the account (ImportResult maps their local ids to saved ids).
//
// Browsers without passkeys (some in-app browsers) never see any of this:
// the page marks <html class="no-passkeys"> before first paint, so CSS can
// hide everything that needs one.
//
// The ceremonies go through /api/v1/account/passkey (src/views/account.ts):
//   {step: "<mode>-options"} -> {options}
//   {step: "<mode>", response} -> {ok, account}
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
  const out = await api<SignedIn & { ok?: boolean }>(`${API}/account/passkey`, { json: { step: mode, response } });
  if (!out.ok) throw new Error(out.error);
  account.set({ signedIn: out.data.account.signed_in, publicId: out.data.account.public_id });
  // The browser's characters follow in their own request (the passkey
  // step takes small bodies only). A failed import doesn't undo the sign-in.
  if (!importBody || mode === "add") return out.data;
  try {
    return { ...out.data, imported: await importCharacters(importBody) };
  } catch (e) {
    return { ...out.data, import_error: e instanceof Error ? e.message : String(e) };
  }
}

// Options, then the ceremony: for when there's no gesture to keep alive.
export async function signInWithPasskey(mode: PasskeyMode, importBody?: ImportBody): Promise<SignedIn> {
  return runPasskey(mode, await passkeyOptions(mode), importBody);
}

// The browser's characters into the signed-in account (after a sign-in
// that didn't carry them, or to retry).
// The server parses one large body at a time ("busy"): try again shortly.
export async function importCharacters(body: ImportBody): Promise<ImportResult> {
  for (let attempt = 1; ; attempt++) {
    const out = await api<ImportResult>(`${API}/import`, { json: body });
    if (out.ok) return out.data;
    if (out.error !== "busy" || attempt >= 5) throw new Error(out.error);
    await new Promise((done) => setTimeout(done, 1500 * attempt));
  }
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
