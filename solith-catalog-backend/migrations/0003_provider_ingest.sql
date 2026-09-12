-- Phase 3.2: backend provider-ingest write path schema.
--
-- Mirrors (translated to D1/SQL) the client-side shapes in
-- src/core/provider-catalog/types.ts (ProviderGameRecord),
-- src/core/canonical-games/provider-link-store.ts (CanonicalProviderLink),
-- src/core/canonical-games/provider-link-candidate-store.ts
-- (CanonicalProviderLinkCandidate) in the main SOLITH repo. Field names use
-- snake_case (D1/SQL convention here) with JSON projection to camelCase at
-- the API boundary, matching this backend's existing convention for
-- discovery_catalog_entries.

-- Raw per-provider catalog observations — never a second source of truth
-- for canonical identity. One row per (provider, provider_game_id).
-- `raw_revision` is an opaque provider-supplied change marker (never
-- interpreted for ordering — see Mission 6 disclosure: only
-- `last_updated`, generated server-side at ingest time, guards against
-- rollback, exactly matching the main repo's client-side store.ts fix).
CREATE TABLE provider_catalog_records (
  provider          TEXT NOT NULL,
  provider_game_id  TEXT NOT NULL,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'game',
  store_url         TEXT,
  release_date      TEXT,
  developer         TEXT,
  publisher         TEXT,
  genres_json       TEXT NOT NULL DEFAULT '[]',
  tags_json         TEXT NOT NULL DEFAULT '[]',
  rating            REAL,
  rating_source     TEXT,
  popularity_rank   INTEGER,
  popularity_source TEXT,
  last_updated      TEXT NOT NULL,
  raw_revision      TEXT,
  PRIMARY KEY (provider, provider_game_id)
);

CREATE INDEX idx_provider_catalog_records_title ON provider_catalog_records (title);

-- Authoritative cross-provider identity links: EXACT/HIGH ONLY. One applied
-- link per (provider, provider_game_id) — never a second source of truth,
-- never written by anything but the ingest pipeline's post-write matching
-- step (Mission 9).
CREATE TABLE canonical_provider_links (
  provider           TEXT NOT NULL,
  provider_game_id   TEXT NOT NULL,
  canonical_game_id  TEXT NOT NULL,
  confidence         TEXT NOT NULL,
  evidence_json      TEXT NOT NULL DEFAULT '[]',
  linked_at          TEXT NOT NULL,
  PRIMARY KEY (provider, provider_game_id)
);

CREATE INDEX idx_canonical_provider_links_canonical ON canonical_provider_links (canonical_game_id);
CREATE INDEX idx_canonical_provider_links_confidence ON canonical_provider_links (confidence);

-- POSSIBLE/AMBIGUOUS candidates — advisory-only, NEVER read as an applied
-- link. Multiple rows per (provider, provider_game_id), one per candidate,
-- so no candidate relationship is ever collapsed/lost (mirrors the main
-- repo's Mission 7 P3 fix).
CREATE TABLE canonical_provider_link_candidates (
  provider                     TEXT NOT NULL,
  provider_game_id             TEXT NOT NULL,
  candidate_canonical_game_id  TEXT NOT NULL,
  confidence                   TEXT NOT NULL,
  evidence_json                TEXT NOT NULL DEFAULT '[]',
  observed_at                  TEXT NOT NULL,
  PRIMARY KEY (provider, provider_game_id, candidate_canonical_game_id)
);

CREATE INDEX idx_link_candidates_record ON canonical_provider_link_candidates (provider, provider_game_id);
CREATE INDEX idx_link_candidates_confidence ON canonical_provider_link_candidates (confidence);

-- Per-provider sync status (Mission 11). No secret/token material — desktop
-- clients may read this table via a read-only status endpoint.
CREATE TABLE provider_sync_status (
  provider           TEXT PRIMARY KEY,
  last_attempt_at    TEXT,
  last_success_at    TEXT,
  last_revision      TEXT,
  last_record_count  INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'UNKNOWN',
  error_code         TEXT,
  error_summary      TEXT
);

-- Idempotency ledger (Mission 7): records a `sync_id` once fully applied so
-- a byte-identical resubmission of the same batch can be recognized and
-- answered without re-applying writes or double-counting sync status.
CREATE TABLE ingest_batch_log (
  provider       TEXT NOT NULL,
  sync_id        TEXT NOT NULL,
  applied_at     TEXT NOT NULL,
  record_count   INTEGER NOT NULL,
  batch_hash     TEXT NOT NULL,
  PRIMARY KEY (provider, sync_id)
);

-- Tombstone model (Mission 10): discovery_catalog_entries gains an explicit
-- lifecycle status. Never removed merely because one sync omitted a row —
-- only explicit provider-supplied removal evidence sets TOMBSTONED.
ALTER TABLE discovery_catalog_entries ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE discovery_catalog_entries ADD COLUMN last_seen_in_sync_at TEXT;

CREATE INDEX idx_discovery_catalog_entries_lifecycle ON discovery_catalog_entries (lifecycle_status);
