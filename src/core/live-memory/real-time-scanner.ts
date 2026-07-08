import { nativeMemoryDriver } from './native-memory-driver.js';
import type { LiveProcessHandle, LiveValueType } from './types.js';

export interface RealtimeScannerConfig {
  handle: LiveProcessHandle;
  candidates: { address: string; value: number }[];
  dataType: LiveValueType;
  pollIntervalMs: number;
  onCandidateUpdate: (candidates: { address: string; value: number }[]) => void;
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

  constructor(config: RealtimeScannerConfig) {
    this.config = config;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initial read to establish baseline
    this.poll();

    // Poll every N milliseconds
    this.intervalId = setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.lastValues.clear();
  }

  private poll(): void {
    try {
      const updated: { address: string; value: number }[] = [];

      for (const candidate of this.config.candidates) {
        try {
          const addr = BigInt(candidate.address);
          const value = nativeMemoryDriver.readMemory(
            this.config.handle,
            addr,
            this.config.dataType,
          );
          updated.push({ address: candidate.address, value });
          this.lastValues.set(candidate.address, value);
        } catch {
          // Address became unreadable, skip it
        }
      }

      if (updated.length > 0) {
        this.config.onCandidateUpdate(updated);
      } else if (updated.length === 0 && this.config.candidates.length > 0) {
        this.config.onError('All candidates became unreadable');
        this.stop();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.config.onError(message);
      this.stop();
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
