// Passkey verification (src/lib/passkeys.ts, @passwordless-id/webauthn),
// checked against a software authenticator (real P-256 keys and signatures
// built the way a browser does): valid responses pass, and each kind of
// tampering fails. speci's test also cross-checks @simplewebauthn/server;
// here the cases are the same, without the second library.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { verifyNewPasskey, verifySignIn, type StoredPasskey } from "../src/lib/passkeys.ts";
import { b64, SoftAuthenticator, UP, UV } from "./support/soft-authenticator.ts";

const ORIGIN = "https://inquisitor.pfaj.ca";
const rp = (c: string) => ({ origin: new URL(ORIGIN), isChallenge: (x: string) => x === c });

test("registration: valid and tampered responses", async (t) => {
  const cases: [string, (a: SoftAuthenticator, c: string) => ReturnType<SoftAuthenticator["register"]>, boolean][] = [
    ["valid", (a, c) => a.register({ challenge: c }), true],
    ["wrong origin", (a, c) => a.register({ challenge: c, origin: "https://speci.pfaj.ca" }), false],
    ["wrong RP ID", (a, c) => a.register({ challenge: c, rpId: "evil.example" }), false],
    ["unknown challenge", (a) => a.register({ challenge: b64(randomBytes(32)) }), false],
    ["no user verification", (a, c) => a.register({ challenge: c, flags: UP | 0x40 }), false],
    ["sign-in type at registration", (a, c) => a.register({ challenge: c, type: "webauthn.get" }), false],
  ];
  for (const [name, make, expected] of cases) {
    await t.test(name, async () => {
      const a = new SoftAuthenticator(ORIGIN);
      const c = b64(randomBytes(32));
      const out = await verifyNewPasskey(make(a, c), rp(c));
      assert.equal(out !== null, expected);
      if (expected) {
        assert.equal(out!.id, b64(a.credId));
        assert.equal(out!.algorithm, "ES256");
        assert.deepEqual(out!.transports, ["internal"]);
      }
    });
  }
});

test("sign-in: valid and tampered responses", async (t) => {
  const a = new SoftAuthenticator(ORIGIN);
  const c0 = b64(randomBytes(32));
  const reg = (await verifyNewPasskey(a.register({ challenge: c0 }), rp(c0)))!;
  const stored = (counter: number): StoredPasskey => ({ id: reg.id, public_key: reg.public_key, algorithm: reg.algorithm, counter, transports: null });
  const other = generateKeyPairSync("ec", { namedCurve: "P-256" });

  const cases: [string, (c: string) => ReturnType<SoftAuthenticator["authenticate"]>, number, boolean][] = [
    ["valid", (c) => a.authenticate({ challenge: c, counter: 1 }), 0, true],
    ["counter going up", (c) => a.authenticate({ challenge: c, counter: 6 }), 5, true],
    ["counter not going up (cloned key)", (c) => a.authenticate({ challenge: c, counter: 5 }), 5, false],
    ["wrong origin", (c) => a.authenticate({ challenge: c, origin: "https://evil.example" }), 0, false],
    ["wrong RP ID", (c) => a.authenticate({ challenge: c, rpId: "evil.example" }), 0, false],
    ["unknown challenge", () => a.authenticate({ challenge: b64(randomBytes(32)) }), 0, false],
    ["tampered signature", (c) => a.authenticate({ challenge: c, tamper: true }), 0, false],
    ["signed by another key", (c) => a.authenticate({ challenge: c, signWith: other.privateKey }), 0, false],
    ["no user presence", (c) => a.authenticate({ challenge: c, flags: UV }), 0, false],
    ["no user verification", (c) => a.authenticate({ challenge: c, flags: UP }), 0, false],
  ];
  for (const [name, make, counter, expected] of cases) {
    await t.test(name, async () => {
      const c = b64(randomBytes(32));
      const out = await verifySignIn(make(c), stored(counter), rp(c));
      assert.equal(out !== null, expected);
    });
  }
});

test("sign-in: a challenge can't be replayed", async () => {
  const a = new SoftAuthenticator(ORIGIN);
  const c0 = b64(randomBytes(32));
  const reg = (await verifyNewPasskey(a.register({ challenge: c0 }), rp(c0)))!;
  const open = new Set<string>();
  const c = b64(randomBytes(32));
  open.add(c);
  const relying = { origin: new URL(ORIGIN), isChallenge: (x: string) => open.delete(x) };
  const stored: StoredPasskey = { id: reg.id, public_key: reg.public_key, algorithm: reg.algorithm, counter: 0, transports: null };
  const resp = a.authenticate({ challenge: c });
  assert.ok(await verifySignIn(resp, stored, relying));
  assert.equal(await verifySignIn(resp, stored, relying), null);
});
