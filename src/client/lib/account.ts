// Accounts (speci's model). Everything saved lives on the server, in the
// session's account. A browser gets a visitor (an account without passkeys)
// on its first save (ensureVisitor; src/client/lib/characters.ts calls it
// when a save answers 401). "Create account" puts a passkey on that same
// account; "Sign in" brings the visitor's characters and warbands into the
// account signed into. `account.signedIn` means a passkey account: a
// visitor's page shows "Sign in" and "Create account".
//
// Browsers without passkeys (some in-app browsers) never see any of this:
// the page marks <html class="no-passkeys"> before first paint, so CSS can
// hide everything that needs one.
//
// The ceremonies go through /api/v1/account/passkey (src/views/account.ts):
//   {step: "<mode>-options"} -> {options}
//   {step: "<mode>", response} -> {ok, account}
// and a visitor is POST /api/v1/account/visitor.
// The WebAuthn client is @passwordless-id/webauthn, loaded with import()
// (loadWebauthn) when the sign-in control is shown: Safari wants the tap's
// gesture still live when WebAuthn starts, so fetch the options and the
// library first, then call runPasskey from the tap.
import { API, type AccountInfo } from "../../shared/api.ts";
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

export type SignedIn = { account: AccountInfo };

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
export async function runPasskey(mode: PasskeyMode, options: PasskeyOptions): Promise<SignedIn> {
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
  return out.data;
}

// Options, then the ceremony: for when there's no gesture to keep alive.
export async function signInWithPasskey(mode: PasskeyMode): Promise<SignedIn> {
  return runPasskey(mode, await passkeyOptions(mode));
}

// A session for this browser: its account if it has one, else a new
// visitor. One request at a time (two saves at once make one visitor).
let visitor: Promise<void> | null = null;
export function ensureVisitor(): Promise<void> {
  visitor ??= (async () => {
    try {
      const out = await api<SignedIn>(`${API}/account/visitor`, { method: "POST" });
      if (!out.ok) throw new Error(out.error);
    } finally {
      visitor = null;
    }
  })();
  return visitor;
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
