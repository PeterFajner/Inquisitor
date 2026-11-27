-- foreign_keys: off
-- Warbands go (owner, November 2026): a character's sheet is downloaded with
-- other characters picked beside its Download button instead
-- (account_settings below). Their share links go with them; a character's
-- stay. shares is rebuilt without warband_id.

DELETE FROM shares WHERE warband_id IS NOT NULL;
CREATE TABLE shares_new (
  token         TEXT PRIMARY KEY,
  character_id  TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO shares_new (token, character_id, created_at) SELECT token, character_id, created_at FROM shares;
DROP TABLE shares;
ALTER TABLE shares_new RENAME TO shares;
CREATE INDEX IF NOT EXISTS shares_character_idx ON shares (character_id);

DROP TABLE IF EXISTS warband_members;
DROP TABLE IF EXISTS warbands;

-- An account's export settings, kept for it (src/lib/settings.ts): the
-- format ("docx" or "pdf") and, per character, the others downloaded with it.
CREATE TABLE IF NOT EXISTS account_settings (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  settings    TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
