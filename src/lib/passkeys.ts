// Passkey (WebAuthn) ceremonies for accounts (speci's pattern).
//
// Verification is @passwordless-id/webauthn (~1 MB, no dependencies; it uses
// the platform's WebCrypto). Inquisitor asks for no attestation, so the
// checks that apply are those in WebAuthn §7.1/§7.2 that don't involve
// attestation certificates: challenge, origin, RP ID hash, user
// presence/verification flags, signature and counter (test/webauthn.test.ts).
// The browser side is the same library's client (src/client/lib/account.ts),
// which takes the options below as they are.
import { randomBytes } from "node:crypto";
import { server } from "@passwordless-id/webauthn";
import type { AuthenticationJSON, NamedAlgo, RegistrationJSON } from "@passwordless-id/webauthn/dist/esm/types.js";

export type RegistrationResponse = Omit<RegistrationJSON, "user">;
export type AuthenticationResponse = AuthenticationJSON;

const TIMEOUT_MS = 120_000;

/** The RP ID: PASSKEY_RP_ID (the origin's host or a parent of it, so a
 * preview at preview.inquisitor.pfaj.ca makes passkeys that keep working on
 * inquisitor.pfaj.ca), else the origin's hostname. */
export function rpId(origin: URL): string {
  const id = process.env.PASSKEY_RP_ID || origin.hostname;
  if (origin.hostname !== id && !origin.hostname.endsWith(`.${id}`)) throw new Error(`PASSKEY_RP_ID ${id} doesn't cover ${origin.hostname}`);
  return id;
}

export type Relying = {
  /** e.g. https://inquisitor.pfaj.ca; its hostname is the RP ID unless PASSKEY_RP_ID says otherwise (rpId). */
  origin: URL;
  /** Single-use challenge check: true once for a challenge we issued. */
  isChallenge: (challenge: string) => boolean | Promise<boolean>;
};

export type StoredPasskey = {
  id: string;
  public_key: string; // SPKI, base64url
  algorithm: NamedAlgo;
  counter: number;
  transports: string | null; // JSON array
};

export type NewPasskey = Omit<StoredPasskey, "transports"> & { transports: string[] };

export const newChallenge = (): string => randomBytes(32).toString("base64url");

// Options for the client's register() (@passwordless-id/webauthn
// RegisterOptions), plus `exclude`: passkeys the account already has, which
// the client passes on as excludeCredentials.
export type RegisterOptionsJSON = {
  challenge: string;
  domain: string;
  user: { id: string; name: string; displayName: string };
  timeout: number;
  userVerification: "required";
  discoverable: "required";
  attestation: false;
  exclude: { id: string; transports: string[] }[];
};
export type SignInOptionsJSON = { challenge: string; domain: string; timeout: number; userVerification: "required" };

export function registerOptions(o: {
  origin: URL;
  challenge: string;
  user: { id: string; name: string; displayName: string };
  exclude: { id: string; transports: string | null }[];
}): RegisterOptionsJSON {
  return {
    challenge: o.challenge,
    domain: rpId(o.origin),
    user: o.user,
    timeout: TIMEOUT_MS,
    userVerification: "required",
    discoverable: "required",
    attestation: false,
    exclude: o.exclude.map((c) => ({ id: c.id, transports: c.transports ? (JSON.parse(c.transports) as string[]) : [] })),
  };
}

// A discoverable passkey: no allow list, the browser offers what it has.
export function signInOptions(o: { origin: URL; challenge: string }): SignInOptionsJSON {
  return { challenge: o.challenge, domain: rpId(o.origin), timeout: TIMEOUT_MS, userVerification: "required" };
}

// Verifies a new passkey; null when anything doesn't check out.
export async function verifyNewPasskey(response: RegistrationResponse, rp: Relying): Promise<NewPasskey | null> {
  try {
    const info = await server.verifyRegistration(
      { ...response, user: { name: "inquisitor" } },
      { challenge: rp.isChallenge, origin: rp.origin.origin, domain: rpId(rp.origin), userVerified: true },
    );
    const { credential, authenticator } = info;
    if (!credential.publicKey || !credential.algorithm) return null;
    return {
      id: credential.id,
      public_key: credential.publicKey,
      algorithm: credential.algorithm,
      counter: authenticator.counter,
      transports: credential.transports ?? [],
    };
  } catch {
    return null;
  }
}

// Verifies a sign-in against the stored passkey; returns its new counter, or
// null when anything doesn't check out.
export async function verifySignIn(
  response: AuthenticationResponse,
  stored: StoredPasskey,
  rp: Relying,
): Promise<{ counter: number } | null> {
  try {
    const info = await server.verifyAuthentication(
      response,
      {
        id: stored.id,
        publicKey: stored.public_key,
        algorithm: stored.algorithm,
        transports: stored.transports ? JSON.parse(stored.transports) : [],
      },
      {
        challenge: rp.isChallenge,
        origin: rp.origin.origin,
        domain: rpId(rp.origin),
        userVerified: true,
        // Rejects a counter that didn't go up; 0 means the authenticator
        // doesn't count (most synced passkeys).
        counter: stored.counter,
      },
    );
    return { counter: info.counter };
  } catch {
    return null;
  }
}
