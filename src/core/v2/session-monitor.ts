import type {
  LifecycleState,
  LifecycleStateSnapshot,
  MonitorConfig,
  ObservationTimeline,
  ProcessIdentity,
  EvidenceBundle,
  ProcessObservationResult,
  EndpointObservationResult,
  SessionMarkerResult,
} from './lifecycle/types.js';
import { evaluateEvidence } from './lifecycle/evaluator.js';
import { createTimeline, recordTransition, clearTimeline, exportTimeline } from './lifecycle/timeline.js';
import { observeProcess as defaultObserveProcess } from './observers/process-observer.js';
import { observeLocalEndpoints as defaultObserveLocalEndpoints } from './observers/endpoint-observer.js';
import { observeMarkerFile } from './observers/marker-observer.js';

const MIN_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_DURATION_MS = 3600 * 1000; // 1 hour

// â”€â”€ Injectable interfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Observer functions injected into the monitor. Defaults use real OS calls. */
export interface ObserverSet {
  observeProcess: (name: string, signal?: AbortSignal) => Promise<ProcessObservationResult>;
  observeLocalEndpoints: (signal?: AbortSignal) => Promise<EndpointObservationResult>;
}

/**
 * Scheduler abstraction so tests can drive poll scheduling without real timers.
 * The real implementation uses setTimeout/clearTimeout.
 */
export interface PollScheduler {
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const DEFAULT_OBSERVERS: ObserverSet = {
  observeProcess: defaultObserveProcess,
  observeLocalEndpoints: defaultObserveLocalEndpoints,
};

const DEFAULT_SCHEDULER: PollScheduler = {
  schedule: (fn, delay) => setTimeout(fn, delay),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// â”€â”€ Public status type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface MonitorStatus {
  state: LifecycleState;
  snapshot: LifecycleStateSnapshot | null;
  config: MonitorConfig | null;
  isRunning: boolean;
  startedAt: string | null;
  timelineEntryCount: number;
}

// â”€â”€ SessionMonitorService â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Singleton session monitor. Only one game can be monitored at a time. */
class SessionMonitorService {
  private state: LifecycleState = 'idle';
  private snapshot: LifecycleStateSnapshot | null = null;
  private config: MonitorConfig | null = null;
  private timeline: ObservationTimeline | null = null;
  private pollTimer: unknown = null;       // handle for next scheduled poll (recursive setTimeout)
  private timeoutTimer: unknown = null;    // handle for max-duration cutoff
  private previousIdentity: ProcessIdentity | null = null;
  private startedAt: string | null = null;
  private isMonitoring = false;            // true from start() until stop()

  // Concurrency guards
  private pollInFlight = false;
  private generation = 0;

  // Cancellation: aborted on stop() / restart() to terminate child processes
  private abortController: AbortController | null = null;

  // Stored poll interval so recursive scheduling can re-use it
  private intervalMs = DEFAULT_POLL_INTERVAL_MS;

  // Injectable dependencies (replaced in tests via _inject* helpers)
  private observers: ObserverSet = { ...DEFAULT_OBSERVERS };
  private scheduler: PollScheduler = { ...DEFAULT_SCHEDULER };

  // â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  start(config: MonitorConfig): { success: boolean; error?: string } {
    if (this.isMonitoring) {
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
    this.isMonitoring = true;

    this.intervalMs = Math.max(MIN_POLL_INTERVAL_MS, config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    const maxDuration = config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;

    // New generation token: any in-flight poll from a prior run is now stale.
    this.generation += 1;
    // Clearing pollInFlight here allows an immediate restart to fire its initial
    // poll even when the previous generation's poll hasn't returned yet.
    this.pollInFlight = false;

    // Fresh abort controller for this monitoring run.
    this.abortController?.abort(); // belt-and-suspenders if somehow not cleared
    this.abortController = new AbortController();

    this.timeoutTimer = this.scheduler.schedule(() => {
      this.stop('max_duration_reached');
    }, maxDuration);

    // Fire initial poll immediately; subsequent polls are scheduled recursively
    // from inside poll() only after the previous one completes â€” guaranteeing
    // at most one poll in-flight and exactly one pending timer per generation.
    void this.poll(this.generation);

    return { success: true };
  }

  stop(reason = 'user_stopped'): void {
    // Increment generation first: any awaiting poll will see the mismatch and
    // discard its results without touching state or timeline.
    this.generation += 1;

    // Reset in-flight flag immediately so that a restart() called before the
    // old poll's promise resolves is not blocked.
    this.pollInFlight = false;

    // Abort active child processes (SIGTERM via AbortSignal in runCommand).
    this.abortController?.abort();
    this.abortController = null;

    this.isMonitoring = false;

    this.scheduler.cancel(this.pollTimer);
    this.pollTimer = null;

    this.scheduler.cancel(this.timeoutTimer);
    this.timeoutTimer = null;

    const prev = this.state;
    this.state = 'stopped';

    if (this.timeline && prev !== 'stopped') {
      const now = new Date().toISOString();
      this.timeline = recordTransition(
        this.timeline,
        prev,
        'stopped',
        reason,
        this.previousIdentity,
        { availability: 'unavailable', listeners: [], connections: [], observedAt: now },
        { availability: 'unavailable', markerPresent: false, markerPath: '', observedAt: now },
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
      isRunning: this.isMonitoring,
      startedAt: this.startedAt,
      timelineEntryCount: this.timeline?.entries.length ?? 0,
    };
  }

  exportDiagnostics(): object {
    return {
      solithVersion: '1.0.0',
      platform: process.platform,
      featureFlag: 'v2SessionMonitorEnabled',
      configuredGame: this.config
        ? { gameId: this.config.gameId, executableName: this.config.executableName }
        : null,
      currentState: this.state,
      isRunning: this.isMonitoring,
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

  // â”€â”€ Testing seams â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  _injectObservers(observers: ObserverSet): void {
    this.observers = observers;
  }

  _injectScheduler(scheduler: PollScheduler): void {
    this.scheduler = scheduler;
  }

  _resetDependencies(): void {
    this.observers = { ...DEFAULT_OBSERVERS };
    this.scheduler = { ...DEFAULT_SCHEDULER };
  }

  // â”€â”€ Private poll loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async poll(expectedGeneration: number): Promise<void> {
    // Guard 1: skip overlapping ticks (only one poll in-flight per generation).
    // Guard 2: discard ticks scheduled by a prior generation.
    if (this.pollInFlight || expectedGeneration !== this.generation) {
      return;
    }

    if (!this.config) return;

    this.pollInFlight = true;

    // Capture the signal at poll start. If stop() fires mid-await, the abort
    // signal will terminate the child processes; the generation check below
    // then discards the (normalized) results.
    const signal = this.abortController?.signal;

    try {
      const now = new Date().toISOString();

      // Run observers in parallel. Use allSettled so a single observer failure
      // does not erase the other's valid evidence.
      const [procSettled, epSettled] = await Promise.allSettled([
        this.observers.observeProcess(this.config.executableName, signal),
        this.observers.observeLocalEndpoints(signal),
      ]);

      // Discard results that arrived after stop() or restart().
      if (expectedGeneration !== this.generation) return;

      const processResult: ProcessObservationResult =
        procSettled.status === 'fulfilled'
          ? procSettled.value
          : { availability: 'error', identity: null, error: 'observer_rejected', observedAt: now };

      const endpointResult: EndpointObservationResult =
        epSettled.status === 'fulfilled'
          ? epSettled.value
          : { availability: 'unavailable', listeners: [], connections: [], observedAt: now };

      const markerResult: SessionMarkerResult = this.config.markerFilePath
        ? observeMarkerFile(this.config.markerFilePath)
        : { availability: 'unavailable', markerPresent: false, markerPath: '', observedAt: now };

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
          markerResult,
        );
        this.state = newSnapshot.state;
      }

      this.snapshot = newSnapshot;
      this.previousIdentity = newSnapshot.gameIdentity;
    } finally {
      this.pollInFlight = false;

      // Schedule the next poll only if this generation is still current.
      // This is the recursive-setTimeout pattern: exactly one poll in-flight
      // and exactly one pending timer exist at any point per generation.
      if (expectedGeneration === this.generation) {
        this.pollTimer = this.scheduler.schedule(
          () => { void this.poll(expectedGeneration); },
          this.intervalMs,
        );
      }
    }
  }
}

// â”€â”€ Module-level singleton â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _instance: SessionMonitorService | null = null;

export function getSessionMonitor(): SessionMonitorService {
  if (!_instance) {
    _instance = new SessionMonitorService();
  }
  return _instance;
}

/** Reset for testing only. Stops the current instance (if any) and clears it. */
export function _resetMonitorForTesting(): void {
  if (_instance) {
    _instance.stop('test_reset');
    _instance._resetDependencies();
  }
  _instance = null;
}

/**
 * Inject mock observers into the current singleton.
 * Must be called after getSessionMonitor() creates the instance and before start().
 */
export function _setObserversForTesting(observers: ObserverSet): void {
  if (_instance) _instance._injectObservers(observers);
}

/**
 * Inject a mock scheduler into the current singleton.
 * Must be called after getSessionMonitor() creates the instance and before start().
 */
export function _setSchedulerForTesting(scheduler: PollScheduler): void {
  if (_instance) _instance._injectScheduler(scheduler);
}
