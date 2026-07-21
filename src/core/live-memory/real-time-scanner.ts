import { nativeMemoryDriver } from './native-memory-driver.js';
import type { LiveProcessHandle, LiveValueType, MemoryDriver } from './types.js';

export type RealtimeScannerStopReason = 'user_stopped' | 'isolated' | 'stalled' | 'error';

export interface RealtimeScannerCandidate {
  address: string;
  value: number;
}

export interface RealtimeScannerConfig {
  handle: LiveProcessHandle;
  candidates: RealtimeScannerCandidate[];
  dataType: LiveValueType;
  pollIntervalMs: number;
  driver?: MemoryDriver;
  epsilon?: number;
  onCandidateUpdate: (candidates: RealtimeScannerCandidate[]) => void;
  onIsolated?: (candidate: RealtimeScannerCandidate) => void;
  onStalled?: () => void;
  onError: (error: string) => void;
}

/**
 * Real-time scanner that continuously polls candidate addresses and
 * auto-narrows when it detects value changes in-game.
 *
 * Used for live discovery: as the user changes values in-game, the scanner
 * automatically reads each candidate and removes those that no longer match
 * the expected pattern (i.e., were not modified by the user's in-game action).
 */
export class RealtimeScanner {
  private intervalId: NodeJS.Timeout | null = null;
  private lastValues: Map<string, number> = new Map();
  private config: RealtimeScannerConfig;
  private isRunning = false;
  private stoppedReason: RealtimeScannerStopReason | null = null;
  private hasBaseline = false;

  constructor(config: RealtimeScannerConfig) {
    this.config = { ...config, candidates: [...config.candidates] };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stoppedReason = null;
    this.hasBaseline = false;

    // Initial read to establish baseline
    this.pollOnce();

    // Poll every N milliseconds
    this.intervalId = setInterval(() => this.pollOnce(), this.config.pollIntervalMs);
  }

  stop(reason: RealtimeScannerStopReason = 'user_stopped'): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.stoppedReason = reason;
    this.lastValues.clear();
    this.hasBaseline = false;
  }

  /**
   * Executes one read-only polling pass. Exposed for tests and for future
   * worker-thread orchestration where the scheduler owns the loop.
   */
  pollOnce(): void {
    try {
      const readable: RealtimeScannerCandidate[] = [];
      const changed: RealtimeScannerCandidate[] = [];
      const driver = this.config.driver ?? nativeMemoryDriver;

      for (const candidate of this.config.candidates) {
        try {
          const addr = BigInt(candidate.address);
          const value = driver.readMemory(
            this.config.handle,
            addr,
            this.config.dataType,
          );

          const next = { address: candidate.address, value };
          readable.push(next);

          const previous = this.lastValues.get(candidate.address);
          if (this.hasBaseline && previous !== undefined && !this.valuesEqual(previous, value)) {
            changed.push(next);
          }
        } catch {
          // Address became unreadable, skip it
        }
      }

      if (readable.length === 0 && this.config.candidates.length > 0) {
        this.config.onError('All candidates became unreadable');
        this.config.onStalled?.();
        this.stop('stalled');
        return;
      }

      const nextCandidates = changed.length > 0 ? changed : readable;
      this.config.candidates = nextCandidates;
      this.lastValues.clear();
      for (const candidate of nextCandidates) {
        this.lastValues.set(candidate.address, candidate.value);
      }
      this.hasBaseline = true;

      if (nextCandidates.length > 0) {
        this.config.onCandidateUpdate(nextCandidates);
      }

      if (changed.length > 0 && nextCandidates.length === 1) {
        this.config.onIsolated?.(nextCandidates[0]);
        this.stop('isolated');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.config.onError(message);
      this.stop('error');
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getStopReason(): RealtimeScannerStopReason | null {
    return this.stoppedReason;
  }

  private valuesEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= (this.config.epsilon ?? 0);
  }
}
