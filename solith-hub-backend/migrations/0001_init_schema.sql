CREATE TABLE IF NOT EXISTS definitions (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL,
  executable_hash TEXT NOT NULL,
  cert_level TEXT NOT NULL DEFAULT 'L0_Community'
    CHECK (cert_level IN ('L0_Community', 'L3_Certified')),
  definition_payload TEXT NOT NULL CHECK (json_valid(definition_payload)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_definitions_game_id
  ON definitions (game_id);

CREATE INDEX IF NOT EXISTS idx_definitions_updated_at
  ON definitions (updated_at);
