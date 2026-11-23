// A software passkey authenticator for tests: real P-256 keys and
// signatures, with the authenticator data and client data built the way a
// browser does, as @passwordless-id/webauthn's client would send them.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

export const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

export const UP = 0x01;
export const UV = 0x04;
const AT = 0x40;

// Just enough CBOR for an attestation object and a COSE key: unsigned and
// negative integers, byte and text strings, maps.
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cbor(x: Cbor): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(n, 1);
    return b;
  };
  if (typeof x === "number") return x >= 0 ? head(0, x) : head(1, -1 - x);
  if (typeof x === "string") return Buffer.concat([head(3, Buffer.byteLength(x)), Buffer.from(x)]);
  if (x instanceof Uint8Array) return Buffer.concat([head(2, x.length), Buffer.from(x)]);
  return Buffer.concat([head(5, x.size), ...[...x].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

export class SoftAuthenticator {
  key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  credId = randomBytes(16);
  counter = 0;
  rpId: string;
  origin: string;

  constructor(origin: string) {
    this.origin = origin;
    this.rpId = new URL(origin).hostname;
  }

  cosePublicKey(): Buffer {
    const jwk = this.key.publicKey.export({ format: "jwk" });
    return cbor(
      new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
  }

  authData(opts: { rpId?: string; flags: number; counter: number; attested?: boolean }): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(opts.counter);
    const parts: Buffer[] = [sha256(opts.rpId ?? this.rpId), Buffer.from([opts.flags]), counter];
    if (opts.attested) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(this.credId.length);
      parts.push(Buffer.alloc(16), len, this.credId, this.cosePublicKey());
    }
    return Buffer.concat(parts);
  }

  register(o: { challenge: string; origin?: string; rpId?: string; flags?: number; type?: string }) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: o.type ?? "webauthn.create", challenge: o.challenge, origin: o.origin ?? this.origin, crossOrigin: false }),
    );
    const authData = this.authData({ rpId: o.rpId, flags: o.flags ?? UP | UV | AT, counter: 0, attested: true });
    return {
      id: b64(this.credId),
      rawId: b64(this.credId),
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientDataJSON),
        attestationObject: b64(cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))),
        authenticatorData: b64(authData),
        publicKey: b64(this.key.publicKey.export({ format: "der", type: "spki" })),
        publicKeyAlgorithm: -7,
        transports: ["internal" as const],
      },
    };
  }

  authenticate(o: { challenge: string; origin?: string; rpId?: string; flags?: number; counter?: number; signWith?: KeyObject; tamper?: boolean }) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: o.challenge, origin: o.origin ?? this.origin, crossOrigin: false }),
    );
    this.counter = o.counter ?? this.counter + 1;
    const authData = this.authData({ rpId: o.rpId, flags: o.flags ?? UP | UV, counter: this.counter });
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), o.signWith ?? this.key.privateKey);
    if (o.tamper) signature[signature.length - 1] ^= 0x01;
    return {
      id: b64(this.credId),
      rawId: b64(this.credId),
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: b64(Buffer.from("user")),
      },
    };
  }
}
