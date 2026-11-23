-- Accounts, signed in with passkeys (RP ID inquisitor.pfaj.ca, permanently).
-- An account is nothing but a random id: no name, email, IP or device info.
-- Its passkeys and sessions hang off it, and so do its characters and
-- warbands, which go when the account is deleted.

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,                -- random, also the WebAuthn user id; never shown
  public_id   TEXT NOT NULL UNIQUE,            -- short, derived from id (src/lib/accounts.ts); shown in history
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS account_passkeys (
  id            TEXT PRIMARY KEY,              -- WebAuthn credential id (base64url)
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,                 -- SPKI, base64url
  algorithm     TEXT NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                          -- JSON array, as the browser reported
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS account_passkeys_account_idx ON account_passkeys (account_id);

-- Looked up by the SHA-256 of the cookie value; the cookie itself is never stored.
CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash  TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions (account_id);

-- Outstanding WebAuthn challenges; single use and short-lived. account_id is
-- set when a signed-in account is adding another passkey; new_account_id is
-- the id a sign-up will get (no account row exists until it succeeds).
CREATE TABLE IF NOT EXISTS account_challenges (
  challenge       TEXT PRIMARY KEY,
  purpose         TEXT NOT NULL CHECK (purpose IN ('register', 'add', 'sign-in')),
  account_id      TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  new_account_id  TEXT,
  expires_at      TEXT NOT NULL
);
