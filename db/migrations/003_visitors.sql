-- Visitors (November 2026): characters and warbands no longer live in the
-- browser. Every browser that saves something gets an account; one with no
-- passkeys is a visitor (src/lib/accounts.ts). A visitor is an ordinary
-- accounts row: nothing marks it but having no account_passkeys.
--
-- last_seen_at: when a session of the account was last used (updated at most
-- once a day), so a later cleanup can find visitors nobody comes back to.
-- Accounts from before this migration count as seen now.

ALTER TABLE accounts ADD COLUMN last_seen_at TEXT;
UPDATE accounts SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
CREATE INDEX IF NOT EXISTS accounts_last_seen_idx ON accounts (last_seen_at);
