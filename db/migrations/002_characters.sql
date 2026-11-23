-- Characters, each a tree of versions (branching history: nothing is ever
-- lost), and warbands, ordered lists of characters. src/lib/characters.ts.
--
-- A character with no owner was shared from a browser that wasn't signed in:
-- it is read-only, reachable only through its share link.

CREATE TABLE IF NOT EXISTS characters (
  id          TEXT PRIMARY KEY,                -- random, base64url
  owner_id    TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  head_id     TEXT,                            -- the current version (a character_versions id of this character)
  import_key  TEXT,                            -- the browser's own id, when imported (makes import idempotent)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS characters_owner_idx ON characters (owner_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS characters_import_idx ON characters (owner_id, import_key) WHERE import_key IS NOT NULL;

-- One version: a whole character record (JSON, opaque to the server beyond
-- its shape), the rules version it was built against, and what kind of edit
-- made it. parent_id is null only for a character's first version. A
-- 'duplicate' first version names the version it was copied from
-- (source_id; not a foreign key, the source may be deleted later).
CREATE TABLE IF NOT EXISTS character_versions (
  id             TEXT PRIMARY KEY,
  character_id   TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  parent_id      TEXT REFERENCES character_versions(id) ON DELETE CASCADE,
  record         TEXT NOT NULL,
  rules_version  TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('roll', 'choice', 'override', 'reroll', 'luna', 'manual', 'import', 'duplicate')),
  author         TEXT,                         -- accounts.public_id of the editor; null when anonymous
  source_id      TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS character_versions_character_idx ON character_versions (character_id, created_at);
CREATE INDEX IF NOT EXISTS character_versions_parent_idx ON character_versions (parent_id);

CREATE TABLE IF NOT EXISTS warbands (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  import_key  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS warbands_owner_idx ON warbands (owner_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS warbands_import_idx ON warbands (owner_id, import_key) WHERE import_key IS NOT NULL;

-- A warband's characters, in order. Deleting a character takes it out.
CREATE TABLE IF NOT EXISTS warband_members (
  warband_id    TEXT NOT NULL REFERENCES warbands(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  character_id  TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (warband_id, position)
);
CREATE INDEX IF NOT EXISTS warband_members_character_idx ON warband_members (character_id);

-- Read-only links (/s/<token>) to a character or a warband. They show it as
-- it is now (its head), not a snapshot.
CREATE TABLE IF NOT EXISTS shares (
  token         TEXT PRIMARY KEY,
  character_id  TEXT REFERENCES characters(id) ON DELETE CASCADE,
  warband_id    TEXT REFERENCES warbands(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((character_id IS NULL) <> (warband_id IS NULL))
);
CREATE INDEX IF NOT EXISTS shares_character_idx ON shares (character_id);
CREATE INDEX IF NOT EXISTS shares_warband_idx ON shares (warband_id);
