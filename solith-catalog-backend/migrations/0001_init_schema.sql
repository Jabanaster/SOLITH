-- Phase 2 Part B: read-only discovery-catalog / trainer-coverage / trainer-
-- artifact sync schema. Mirrors (translated to D1/SQL) the CLIENT-side
-- shapes in src/core/discovery-catalog/types.ts (DiscoveryCatalogEntry) and
-- src/core/trainer-catalog/coverage-index.ts (TrainerCoverageRecord) in the
-- main SOLITH repo, plus a server-side revision ledger and an
-- immutable-by-hash artifact blob table.
--
-- Least-privilege note: this D1 database is scoped to ONLY these four
-- tables. It is a separate database (separate binding, separate
-- database_id) from solith-hub-backend's `definitions` table — that table
-- belongs to a different feature (untrusted Community Definition Hub
-- submissions) with a different trust model and must not share storage or
-- a binding with this read-only catalog/trainer-coverage/artifact backend.

-- One row per discovered game. `revision` is the server-side monotonic
-- counter value in effect the moment this row was last written — used to
-- answer "what changed since revision N" without relying on wall-clock time.
CREATE TABLE discovery_catalog_entries (
  solith_game_id     TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  normalized_title   TEXT NOT NULL,
  aliases_json       TEXT NOT NULL DEFAULT '[]',
  provider_ids_json  TEXT NOT NULL DEFAULT '{}',
  type               TEXT NOT NULL DEFAULT '',
  release_date       TEXT,
  release_year       INTEGER,
  genres_json        TEXT NOT NULL DEFAULT '[]',
  tags_json          TEXT NOT NULL DEFAULT '[]',
  trainer_available  INTEGER NOT NULL DEFAULT 0,
  ct_available       INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL,
  revision           INTEGER NOT NULL
);

CREATE INDEX idx_discovery_catalog_entries_revision ON discovery_catalog_entries (revision);
CREATE INDEX idx_discovery_catalog_entries_trainer_available ON discovery_catalog_entries (trainer_available);

-- Tombstones for deleted catalog entries, so a delta sync since revision N
-- can report `deletedSolithGameIds` without the row itself still existing.
CREATE TABLE deleted_catalog_entries (
  solith_game_id TEXT PRIMARY KEY,
  deleted_at     TEXT NOT NULL,
  revision       INTEGER NOT NULL
);

CREATE INDEX idx_deleted_catalog_entries_revision ON deleted_catalog_entries (revision);

-- One row per game's trainer-coverage projection — mirrors
-- TrainerCoverageRecord. `artifact_hash`, when present, is a foreign
-- reference (by value, not FK constraint, since a coverage row may name a
-- hash that has not been uploaded to `artifacts` yet) into the artifacts
-- table's immutable hash namespace.
CREATE TABLE trainer_coverage (
  game_id             TEXT PRIMARY KEY,
  trainer_available   INTEGER NOT NULL DEFAULT 0,
  trainer_id          TEXT,
  trainer_version     TEXT,
  game_build_hint     TEXT,
  cheat_count         INTEGER NOT NULL DEFAULT 0,
  trust_state         TEXT NOT NULL,
  artifact_hash       TEXT,
  artifact_size_bytes INTEGER,
  last_updated        TEXT NOT NULL,
  author              TEXT,
  source              TEXT,
  revision            INTEGER NOT NULL
);

CREATE INDEX idx_trainer_coverage_revision ON trainer_coverage (revision);

-- Server-side revision ledger. Exactly one row (id = 'global'). Both
-- counters are monotonically non-decreasing by construction: every write
-- path that touches catalog/coverage data reads this row, computes
-- `next = current + 1`, writes the data row with `revision = next`, then
-- writes this row back with `next` — never with a caller-supplied value.
-- There is no code path anywhere in src/index.ts that sets these columns to
-- anything other than "current value from this same row, plus one".
CREATE TABLE sync_state (
  id                TEXT PRIMARY KEY,
  catalog_revision  INTEGER NOT NULL,
  trainer_revision  INTEGER NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Immutable, content-addressed trainer artifact storage. `artifact_hash` is
-- the ONLY key (64 lowercase hex chars, enforced at the application layer
-- via zod before any lookup ever reaches this table) — there is no separate
-- mutable numeric/UUID id a client can use to address a row. `sha256`
-- duplicates the primary key value in a plain column so the read path can
-- verify (SELECT sha256(blob) at serve time, see src/index.ts) that stored
-- bytes still match their own key before ever serving them, instead of
-- trusting the primary key blindly.
--
-- D1 BLOB column chosen over R2 for this proof-of-architecture phase: R2
-- has its own miniflare local emulation, but adding a second binding/service
-- for a phase whose explicit goal is "prove the read-only sync architecture
-- works against a real Workers runtime + real local D1" would add
-- incidental complexity (a second local emulation surface, a second set of
-- least-privilege bindings to justify) without changing what the phase is
-- actually trying to demonstrate. A D1 BLOB column keeps the whole backend
-- on ONE binding. R2 remains the right choice for a production artifact
-- store at real scale (D1 has practical per-row and per-database size
-- limits) — that migration is future work, not required by this task.
CREATE TABLE artifacts (
  artifact_hash TEXT PRIMARY KEY,
  size_bytes    INTEGER NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  blob          BLOB NOT NULL,
  created_at    TEXT NOT NULL
);

INSERT INTO sync_state (id, catalog_revision, trainer_revision, updated_at)
VALUES ('global', 0, 0, '1970-01-01T00:00:00.000Z');
