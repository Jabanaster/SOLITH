/**
 * SOLITH Phase 3.2 Mission 20 — provider ingest scheduler CONTRACT ONLY.
 *
 * ============================================================================
 * No scheduler runs. No cron trigger is registered anywhere (grep this repo
 * and solith-catalog-backend/wrangler.jsonc — there is no `triggers.crons`
 * entry). This file defines the shape a future scheduler would implement:
 * one independent job per provider, each with its own rate limiting/backoff
 * and failure isolation, matching the isolation already proven at the ingest
 * endpoint (tests/backend-ingest-e2e.test.ts step 16 — an Epic failure
 * cannot touch Steam's provider_sync_status row). Per the owner's explicit
 * Phase 3.2 instruction: "Do NOT deploy cron yet."
 * ============================================================================
 */
/**
 * Mirrors solith-catalog-backend/src/ingest-schema.ts's KNOWN_PROVIDERS —
 * duplicated rather than imported across the package boundary, same
 * deliberate-manual-sync rationale as solith-catalog-backend/src/shared/
 * (a separate Worker package with its own build; see that dir's README.md).
 */
export type SchedulableProvider = 'steam' | 'gog' | 'epic' | 'ubisoft' | 'ea' | 'xbox' | 'battlenet';

/** One provider's independent sync job. Never shares state/backoff/rate-limit budget with another provider's job. */
export interface ProviderSyncJobConfig {
  provider: SchedulableProvider;
  /** Minimum wall-clock time between two successful runs of THIS provider's job. */
  minIntervalMs: number;
  /** Hard ceiling on records fetched from the provider in one job run, independent of the ingest endpoint's own MAX_RECORDS_PER_BATCH — a job may span many ingest batches. */
  maxRecordsPerRun: number;
  /** Exponential backoff applied to consecutive failures of THIS provider only — never escalated by another provider's failures. */
  backoff: ProviderSyncBackoffConfig;
}

export interface ProviderSyncBackoffConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  /** Multiplier applied per consecutive failure, capped at maxDelayMs. */
  multiplier: number;
  /** Consecutive failures after which the job is marked DEGRADED (still retried, but a human-visible signal) rather than silently retried forever. */
  degradedAfterConsecutiveFailures: number;
}

export type ProviderSyncJobOutcome =
  | { status: 'success'; recordsFetched: number; batchesSubmitted: number }
  | { status: 'failure'; errorCode: string; errorSummary: string; consecutiveFailures: number }
  | { status: 'skipped-rate-limited'; nextEligibleAt: string }
  | { status: 'skipped-backoff'; nextEligibleAt: string };

/**
 * A scheduler implementation runs each configured job independently
 * (Promise.allSettled-style, matching sync-orchestrator.ts's existing
 * per-provider try/catch isolation) and reports one outcome per provider —
 * never a single combined outcome that could obscure which provider failed.
 */
export interface ProviderSyncScheduler {
  jobs: ProviderSyncJobConfig[];
  /** Runs every configured job's due providers once. Returns one outcome per provider actually attempted this tick. */
  runDueJobs(now: Date): Promise<Map<SchedulableProvider, ProviderSyncJobOutcome>>;
}
