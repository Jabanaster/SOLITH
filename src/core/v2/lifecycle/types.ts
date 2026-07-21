/**
 * V2 Session Lifecycle Monitor — Domain Types
 *
 * Lifecycle state represents the combined understanding of game process state
 * and external session state. Game lifecycle and session lifecycle are
 * explicitly separate concerns.
 */

// ── Lifecycle States ────────────────────────────────────────────────────────

export type LifecycleState =
  | 'disabled'                    // Feature flag off
  | 'idle'                        // Feature enabled, not yet started
  | 'game_not_running'            // Monitoring active, game not detected
  | 'game_running'                // Game detected, no session evidence
  | 'observing'                   // Partial session evidence accumulating
  | 'external_session_observed'   // External trainer session detected (not RF-owned)
  | 'solith_session_connected' // Solith-owned authenticated session (future)
  | 'session_ended_game_running'  // Session markers gone, game still running
  | 'game_exited'                 // Game process gone
  | 'stale_evidence'              // Contradictory or outdated evidence
  | 'error'                       // Observer error
  | 'stopped';                    // Monitoring explicitly stopped

// ── Process Identity ─────────────────────────────────────────────────────────

/** Stable process identity — PID alone is not sufficient due to reuse. */
export interface ProcessIdentity {
  pid: number;
  name: string;
  /** ISO 8601 creation timestamp. Combined with pid to detect PID reuse. */
  startTime: string;
  /** Full executable path when obtainable without elevated access. */
  executablePath?: string;
  observedAt: string;
}

// ── Observation Results ──────────────────────────────────────────────────────

export type ObservationAvailability = 'available' | 'unavailable' | 'permission_denied' | 'error';

export interface ProcessObservationResult {
  availability: ObservationAvailability;
  identity: ProcessIdentity | null;
  error?: string;
  observedAt: string;
}

export interface LocalEndpoint {
  port: number;
  address: string;
  state: 'LISTENING' | 'ESTABLISHED';
  ownerPid?: number;
}

export interface EndpointObservationResult {
  availability: ObservationAvailability;
  listeners: LocalEndpoint[];
  connections: LocalEndpoint[];
  error?: string;
  observedAt: string;
}

export interface SessionMarkerResult {
  availability: ObservationAvailability;
  markerPresent: boolean;
  markerPath: string;
  parsedContent?: unknown;
  error?: string;
  observedAt: string;
}

// ── Evidence Bundle ──────────────────────────────────────────────────────────

/**
 * Snapshot of all available evidence at one observation cycle.
 * The evaluator combines these into a single LifecycleState.
 */
export interface EvidenceBundle {
  process: ProcessObservationResult;
  endpoints: EndpointObservationResult;
  marker: SessionMarkerResult;
  collectedAt: string;
}

// ── Evidence Confidence ──────────────────────────────────────────────────────

export type EvidenceConfidence =
  | 'verified'           // Multiple sources agree
  | 'observed'           // Single source, consistent
  | 'likely'             // Partial evidence, consistent
  | 'stale'              // Evidence present but outdated
  | 'contradictory'      // Sources disagree
  | 'unavailable';       // No evidence could be gathered

// ── State Snapshot ───────────────────────────────────────────────────────────

export interface LifecycleStateSnapshot {
  state: LifecycleState;
  confidence: EvidenceConfidence;
  gameIdentity: ProcessIdentity | null;
  externalSessionActive: boolean;
  /** Human-readable description of current evidence. */
  evidenceSummary: string;
  observedAt: string;
}

// ── Monitor Configuration ────────────────────────────────────────────────────

export interface MonitorConfig {
  gameId: string;
  /** Exact executable filename to watch (e.g. "guigubahuang.exe"). */
  executableName: string;
  /** Optional: path to an external session-marker file to observe. */
  markerFilePath?: string;
  /** Poll interval in milliseconds. Minimum 2000, default 3000. */
  pollIntervalMs?: number;
  /** Maximum polling duration in milliseconds. Default 3600000 (1h). */
  maxDurationMs?: number;
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export interface TimelineEntry {
  timestamp: string;
  previousState: LifecycleState;
  nextState: LifecycleState;
  reasonCode: string;
  gameProcessSummary: string;
  endpointSummary: string;
  markerSummary: string;
}

export interface ObservationTimeline {
  entries: TimelineEntry[];
  startedAt: string;
  /** Max entries retained. Oldest entries are dropped when exceeded. */
  maxEntries: number;
}
