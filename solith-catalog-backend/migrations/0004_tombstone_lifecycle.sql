-- Phase 3.2 Owner Follow-up Mission 1 — tombstone STATE ENGINE schema.
--
-- 0003 already added lifecycle_status/last_seen_in_sync_at to
-- discovery_catalog_entries (the canonical/merged view), but nothing tracked
-- per-PROVIDER presence, and nothing recorded when a provider's catalog
-- enumeration actually completed. Both are required to implement the real
-- rule: "only a SUCCESSFULLY COMPLETED authoritative provider sync may
-- contribute absence evidence" — a single partial/paginated batch must never
-- be treated as proof a game is gone.

-- Per-provider presence tracking. Mirrors discovery_catalog_entries'
-- lifecycle columns but scoped to ONE provider's own observations — the
-- discovery-level status is a DERIVED rollup across every linked provider
-- (see tombstone-lifecycle.ts), never written directly except by that
-- rollup, so a canonical game linked to two providers can never be degraded
-- just because ONE of them stopped listing it.
ALTER TABLE provider_catalog_records ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE provider_catalog_records ADD COLUMN last_seen_in_sync_at TEXT;
-- Records WHICH cycle last pushed this row into STALE/TOMBSTONED. Without
-- this, re-evaluating the SAME completed cycle a second time (a legitimate
-- retry — see evaluateSyncCycleCompletion) would see a row already sitting
-- at STALE (from that cycle's own first evaluation) and incorrectly treat
-- it as "already survived one full missed cycle", advancing it straight to
-- TOMBSTONED on every repeat evaluation of the identical boundary. A
-- TOMBSTONE transition is only valid when the existing STALE state came
-- from a DIFFERENT, earlier cycle than the one currently closing.
ALTER TABLE provider_catalog_records ADD COLUMN lifecycle_last_transitioned_by_cycle_id TEXT;

CREATE INDEX idx_provider_catalog_records_lifecycle ON provider_catalog_records (provider, lifecycle_status);

-- Tracks one "authoritative full catalog enumeration" per provider. A cycle
-- opens on the first batch that names it (`syncCycleId` in the ingest
-- contract) and closes only when a batch explicitly asserts `cycleComplete:
-- true` — the adapter/scheduler's job to set honestly, never inferred by
-- the server from batch count or timing. `started_at` is fixed at open time
-- (never overwritten by later batches in the same cycle) and is the exact
-- boundary used to decide "was this provider_catalog_records row observed
-- DURING this completed cycle, or is its absence real": any row whose
-- last_seen_in_sync_at predates started_at was not re-observed.
CREATE TABLE provider_sync_cycles (
  provider      TEXT NOT NULL,
  cycle_id      TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  PRIMARY KEY (provider, cycle_id)
);
