import type {
  LifecycleState,
  LifecycleStateSnapshot,
  MonitorConfig,
  ObservationTimeline,
  ProcessIdentity,
  EvidenceBundle,
} from './lifecycle/types.js';
import { evaluateEvidence } from './lifecycle/evaluator.js';
import { createTimeline, recordTransition, clearTimeline, exportTimeline } from './lifecycle/timeline.js';
import { observeProcess } from './observers/process-observer.js';
import { observeLocalEndpoints } from './observers/endpoint-observer.js';
import { observeMarkerFile } from './observers/marker-observer.js';

const MIN_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_DURATION_MS = 3600 * 1000; // 1 hour

export interface MonitorStatus {
  state: LifecycleState;
  snapshot: LifecycleStateSnapshot | null;
  config: MonitorConfig | null;
  isRunning: boolean;
  startedAt: string | null;
  timelineEntryCount: number;
}

/** Singleton session monitor. Only one game can be monitored at a time. */
class SessionMonitorService {
  private state: LifecycleState = 'idle';
  private snapshot: LifecycleStateSnapshot | null = null;
  private config: MonitorConfig | null = null;
  private timeline: ObservationTimeline | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private previousIdentity: ProcessIdentity | null = null;
  private startedAt: string | null = null;

  start(config: MonitorConfig): { success: boolean; error?: string } {
    if (this.pollTimer) {
      return { success: false, error: 'Monitor already running. Stop it first.' };
    }

    if (!config.executableName) {
      return { success: false, error: 'executableName is required' };
    }

    this.config = { ...config };
    this.timeline = createTimeline();
    this.previousIdentity = null;
    this.startedAt = new Date().toISOString();
    this.state = 'game_not_running';
    this.snapshot = null;

    const interval = Math.max(
      MIN_POLL_INTERVAL_MS,
      config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    );
    const maxDuration = config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

    this.pollTimer = setInterval(() => this.poll(), interval);

    this.timeoutTimer = setTimeout(() => {
      this.stop('max_duration_reached');
    }, maxDuration);

    // Run an initial poll immediately
    this.poll();

    return { success: true };
  }

  stop(reason = 'user_stopped'): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    const prev = this.state;
    this.state = 'stopped';

    if (this.timeline && prev !== 'stopped') {
      this.timeline = recordTransition(
        this.timeline,
        prev,
        'stopped',
        reason,
        this.previousIdentity,
        { availability: 'unavailable', listeners: [], connections: [], observedAt: new Date().toISOString() },
        { availability: 'unavailable', markerPresent: false, markerPath: '', observedAt: new Date().toISOString() }
      );
    }
  }

  clearTimeline(): void {
    if (this.timeline) {
      this.timeline = clearTimeline(this.timeline);
    }
  }

  getStatus(): MonitorStatus {
    return {
      state: this.state,
      snapshot: this.snapshot,
      config: this.config,
      isRunning: this.pollTimer !== null,
      startedAt: this.startedAt,
      timelineEntryCount: this.timeline?.entries.length ?? 0,
    };
  }

  exportDiagnostics(): object {
    return {
      resourceForgeVersion: '1.0.0',
      platform: process.platform,
      featureFlag: 'v2SessionMonitorEnabled',
      configuredGame: this.config
        ? { gameId: this.config.gameId, executableName: this.config.executableName }
        : null,
      currentState: this.state,
      isRunning: this.pollTimer !== null,
      startedAt: this.startedAt,
      observersAvailable: {
        process: true,
        localEndpoints: process.platform === 'win32' || process.platform === 'linux',
        markerFile: !!this.config?.markerFilePath,
      },
      isMockMode: false,
      timeline: this.timeline ? exportTimeline(this.timeline) : null,
    };
  }

  private poll(): void {
    if (!this.config) return;

    const now = new Date().toISOString();

    // Run all observers
    const processResult = observeProcess(this.config.executableName);
    const endpointResult = observeLocalEndpoints();
    const markerResult = this.config.markerFilePath
      ? observeMarkerFile(this.config.markerFilePath)
      : { availability: 'unavailable' as const, markerPresent: false, markerPath: '', observedAt: now };

    const bundle: EvidenceBundle = {
      process: processResult,
      endpoints: endpointResult,
      marker: markerResult,
      collectedAt: now,
    };

    const newSnapshot = evaluateEvidence(bundle, this.state, this.previousIdentity);

    if (newSnapshot.state !== this.state) {
      this.timeline = recordTransition(
        this.timeline ?? createTimeline(),
        this.state,
        newSnapshot.state,
        newSnapshot.evidenceSummary,
        newSnapshot.gameIdentity,
        endpointResult,
        markerResult
      );
      this.state = newSnapshot.state;
    }

    this.snapshot = newSnapshot;
    this.previousIdentity = newSnapshot.gameIdentity;
  }
}

// Module-level singleton — one monitor per main process
let _instance: SessionMonitorService | null = null;

export function getSessionMonitor(): SessionMonitorService {
  if (!_instance) {
    _instance = new SessionMonitorService();
  }
  return _instance;
}

/** Reset for testing only. */
export function _resetMonitorForTesting(): void {
  if (_instance) {
    _instance.stop('test_reset');
  }
  _instance = null;
}
