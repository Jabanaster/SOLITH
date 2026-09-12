/**
 * Phase 3.2 Owner Follow-up Mission 1 — tombstone STATE ENGINE.
 *
 * ============================================================================
 * The schema (0003/0004) only stores lifecycle state; this module is the
 * deterministic policy that decides how it transitions. Every rule below
 * traces to an explicit owner requirement:
 *
 * - omission from ONE sync must NEVER delete/tombstone a game
 * - provider outage must NEVER cause lifecycle degradation
 * - malformed/failed sync must NEVER cause lifecycle degradation
 * - only a SUCCESSFULLY COMPLETED authoritative provider sync may
 *   contribute absence evidence
 * - newly observed record -> ACTIVE
 * - observed again -> ACTIVE and refresh last_seen_in_sync_at
 * - absent after successful authoritative sync -> STALE
 * - repeated/aged absence -> TOMBSTONED
 * - reappearance of STALE/TOMBSTONED record -> ACTIVE
 * - tombstoning provider identity must NOT incorrectly destroy a canonical
 *   game still supported by another provider
 * - tombstoning must NOT destroy Community/trainer/user-local information
 * - no physical DELETE merely because a provider stopped listing something
 *
 * The first three rules are enforced structurally, not just by policy: this
 * module's evaluation function is invoked ONLY from applyIngestBatch's
 * `cycleComplete: true` path, which itself only runs after schema
 * validation and inside the same atomic `db.batch()` as a successfully
 * applied batch — a rejected/malformed/failed batch never reaches it, and a
 * batch that never claims completion never triggers it.
 * ============================================================================
 */

export type LifecycleStatus = 'ACTIVE' | 'STALE' | 'TOMBSTONED';

/**
 * Rolls up one canonical game's discovery-level status from every provider
 * currently linked to it. ACTIVE wins over everything (multi-provider
 * safety: one provider going stale/tombstoned can never degrade a game
 * still actively listed elsewhere). TOMBSTONED requires EVERY linked
 * provider to have independently reached TOMBSTONED. An empty list (no
 * linked providers at all) is treated as ACTIVE — that shape should not
 * occur in practice (a discovery entry always has at least one provider id
 * at creation) and defaulting to the least-destructive status is the safe
 * choice if it ever does.
 */
export function computeCanonicalLifecycleStatus(providerStatuses: LifecycleStatus[]): LifecycleStatus {
  if (providerStatuses.length === 0) return 'ACTIVE';
  if (providerStatuses.some((s) => s === 'ACTIVE')) return 'ACTIVE';
  if (providerStatuses.some((s) => s === 'STALE')) return 'STALE';
  return 'TOMBSTONED';
}

/**
 * Pure per-record transition decision for one provider_catalog_records row
 * being evaluated at the close of a completed sync cycle.
 *
 * @param current the row's lifecycle_status before this evaluation.
 * @param wasObservedThisCycle true when the row's last_seen_in_sync_at is
 *   >= the cycle's started_at (i.e. some batch in THIS cycle actually
 *   touched it) — the caller computes that from real timestamps.
 * @param staleWasSetByThisSameCycle true when `current === 'STALE'` AND the
 *   row's stored `lifecycle_last_transitioned_by_cycle_id` equals the cycle
 *   being evaluated right now — i.e. this row already went STALE as part of
 *   THIS cycle's own (possibly earlier, retried) evaluation, not an
 *   earlier, different completed cycle. Required for idempotency: without
 *   distinguishing this, re-running the evaluation for the same cycle
 *   boundary twice would see an already-STALE row and incorrectly advance
 *   it to TOMBSTONED on the second run, even though no NEW cycle has
 *   actually elapsed.
 */
export function nextLifecycleStatusOnCycleClose(
  current: LifecycleStatus,
  wasObservedThisCycle: boolean,
  staleWasSetByThisSameCycle: boolean,
): LifecycleStatus {
  if (wasObservedThisCycle) return 'ACTIVE'; // reappearance rule — also covers the common case of a still-present row.
  if (current === 'ACTIVE') return 'STALE'; // single (first) missed complete cycle.
  if (current === 'STALE') {
    // Re-evaluating the cycle that itself just set this row STALE is a
    // no-op, not a second miss — a genuine second miss requires a
    // DIFFERENT, later-closing cycle to find it still absent.
    return staleWasSetByThisSameCycle ? 'STALE' : 'TOMBSTONED';
  }
  return current; // already TOMBSTONED and still absent: stays TOMBSTONED (idempotent, no further degradation state exists).
}
