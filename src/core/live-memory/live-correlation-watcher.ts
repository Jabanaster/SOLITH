import { nativeMemoryDriver } from './native-memory-driver.js';
import type { LiveProcessHandle, LiveValueType, MemoryDriver } from './types.js';

export type CorrelationDirection = 'increased' | 'decreased' | 'changed' | 'unchanged';
export type CorrelationSource = 'auto-scan' | 'unknown-scan' | 'aob-candidate' | 'pointer-candidate' | 'manual';
export type CorrelationStrength = 'strong' | 'moderate' | 'weak' | 'noise' | 'unreadable';

export interface CorrelationCandidate {
  id?: string;
  address: string;
  value: number;
  dataType: LiveValueType;
  source?: CorrelationSource;
  scanMode?: string;
  label?: string;
}

export interface PlayerCorrelationEvent {
  id?: string;
  kind:
    | 'spent_resource'
    | 'gained_resource'
    | 'took_damage'
    | 'healed'
    | 'used_stamina'
    | 'recovered_stamina'
    | 'used_item'
    | 'collected_loot'
    | 'custom';
  label?: string;
  expectedDirection: CorrelationDirection;
  expectedDelta?: number;
  lookbackMs?: number;
  observedAt?: string;
}

export interface CorrelationCandidateState extends CorrelationCandidate {
  currentValue: number | null;
  lastValue: number | null;
  lastDelta: number | null;
  polls: number;
  readablePolls: number;
  changedPolls: number;
  increasedPolls: number;
  decreasedPolls: number;
  matchedEvents: number;
  contradictedEvents: number;
  exactDeltaMatches: number;
  recentDeltas: number[];
  recentValues: number[];
  unreadable: boolean;
  score: number;
  strength: CorrelationStrength;
  reasons: string[];
}

export interface CorrelationReport {
  candidates: CorrelationCandidateState[];
  strong: CorrelationCandidateState[];
  moderate: CorrelationCandidateState[];
  weak: CorrelationCandidateState[];
  noise: CorrelationCandidateState[];
  unreadable: CorrelationCandidateState[];
  totals: {
    candidates: number;
    polls: number;
    events: number;
    strong: number;
    moderate: number;
    weak: number;
    noise: number;
    unreadable: number;
  };
  readOnly: true;
  executable: false;
}

export interface LiveCorrelationWatcherConfig {
  handle: LiveProcessHandle;
  candidates: CorrelationCandidate[];
  pollIntervalMs?: number;
  epsilon?: number;
  eventLookbackMs?: number;
  deltaHistoryLimit?: number;
  driver?: MemoryDriver;
  now?: () => string;
  onReport?: (report: CorrelationReport) => void;
  onError?: (error: string) => void;
}

interface MutableCandidateState extends CorrelationCandidateState {
  baselineValue: number;
  deltaHistory: Array<{ delta: number; atMs: number; poll: number }>;
  valueHistory: Array<{ value: number; atMs: number; poll: number }>;
}

/**
 * Read-only live correlation watcher.
 *
 * This is deliberately not a write/freeze primitive. It keeps every candidate
 * tagged by type/source/mode, polls values over time, and lets callers record
 * lightweight player events ("spent gold", "took damage") to score which
 * candidates behaved like the visible game stat. The output is session-local
 * correlation evidence only; restart validation remains the L3 gate.
 */
export class LiveCorrelationWatcher {
  private readonly driver: MemoryDriver;
  private readonly handle: LiveProcessHandle;
  private readonly epsilon: number;
  private readonly pollIntervalMs: number;
  private readonly eventLookbackMs: number;
  private readonly deltaHistoryLimit: number;
  private readonly now: () => string;
  private readonly onReport?: (report: CorrelationReport) => void;
  private readonly onError?: (error: string) => void;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pollCount = 0;
  private eventCount = 0;
  private readonly states = new Map<string, MutableCandidateState>();

  constructor(config: LiveCorrelationWatcherConfig) {
    this.driver = config.driver ?? nativeMemoryDriver;
    this.handle = config.handle;
    this.epsilon = config.epsilon ?? 0.0001;
    this.pollIntervalMs = Math.max(50, config.pollIntervalMs ?? 250);
    this.eventLookbackMs = Math.max(50, config.eventLookbackMs ?? 1500);
    this.deltaHistoryLimit = Math.max(2, Math.min(64, config.deltaHistoryLimit ?? 12));
    this.now = config.now ?? (() => new Date().toISOString());
    this.onReport = config.onReport;
    this.onError = config.onError;

    for (const candidate of config.candidates) {
      const id = this.candidateId(candidate);
      this.states.set(id, {
        ...candidate,
        id,
        currentValue: candidate.value,
        lastValue: candidate.value,
        lastDelta: null,
        baselineValue: candidate.value,
        polls: 0,
        readablePolls: 0,
        changedPolls: 0,
        increasedPolls: 0,
        decreasedPolls: 0,
        matchedEvents: 0,
        contradictedEvents: 0,
        exactDeltaMatches: 0,
        recentDeltas: [],
        recentValues: [candidate.value],
        deltaHistory: [],
        valueHistory: [{ value: candidate.value, atMs: Date.now(), poll: 0 }],
        unreadable: false,
        score: 0,
        strength: 'weak',
        reasons: ['Awaiting observations'],
      });
    }
    this.recomputeScores();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.pollOnce();
    this.timer = setInterval(() => this.pollOnce(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  isActive(): boolean {
    return this.running;
  }

  pollOnce(): CorrelationReport {
    this.pollCount += 1;
    const polledAtMs = Date.now();

    for (const state of this.states.values()) {
      state.polls += 1;
      try {
        const nextValue = this.driver.readMemory(this.handle, BigInt(state.address), state.dataType);
        const previous = state.currentValue;
        state.lastValue = previous;
        state.currentValue = nextValue;
        state.value = nextValue;
        pushCapped(state.valueHistory, { value: nextValue, atMs: polledAtMs, poll: this.pollCount }, this.deltaHistoryLimit);
        state.recentValues = state.valueHistory.map((entry) => entry.value);
        state.readablePolls += 1;
        state.unreadable = false;

        if (previous != null) {
          const delta = nextValue - previous;
          state.lastDelta = delta;
          pushCapped(state.deltaHistory, { delta, atMs: polledAtMs, poll: this.pollCount }, this.deltaHistoryLimit);
          state.recentDeltas = state.deltaHistory.map((entry) => entry.delta);
          if (!this.valuesEqual(delta, 0)) {
            state.changedPolls += 1;
            if (delta > 0) state.increasedPolls += 1;
            if (delta < 0) state.decreasedPolls += 1;
          }
        }
      } catch (error) {
        state.currentValue = null;
        state.lastDelta = null;
        state.unreadable = true;
        this.onError?.(error instanceof Error ? error.message : String(error));
      }
    }

    return this.emitReport();
  }

  recordEvent(event: PlayerCorrelationEvent): CorrelationReport {
    this.eventCount += 1;
    const eventAtMs = parseObservedAtMs(event.observedAt) ?? Date.now();
    const lookbackMs = Math.max(50, event.lookbackMs ?? this.eventLookbackMs);

    for (const state of this.states.values()) {
      if (state.unreadable || state.deltaHistory.length === 0) continue;

      const recent = state.deltaHistory.filter((entry) => eventAtMs - entry.atMs <= lookbackMs);
      const window = recent.length > 0 ? recent : state.deltaHistory.slice(-1);
      const matching = window.find((entry) => eventMatchesDelta(event.expectedDirection, entry.delta, this.epsilon));
      const scoredDelta = matching?.delta ?? largestMeaningfulDelta(window.map((entry) => entry.delta), this.epsilon);
      if (scoredDelta == null) continue;

      if (matching) {
        state.matchedEvents += 1;
        if (
          event.expectedDelta != null &&
          Math.abs(Math.abs(matching.delta) - Math.abs(event.expectedDelta)) <= this.epsilon
        ) {
          state.exactDeltaMatches += 1;
        }
      } else {
        const direction = directionFromDelta(scoredDelta, this.epsilon);
        if (
          event.expectedDirection !== 'unchanged' ||
          (event.expectedDirection === 'unchanged' && direction !== 'unchanged')
        ) {
          state.contradictedEvents += 1;
        }
      }
    }

    void this.now(); // injectable clock exists for future artifact stamping; keeps constructor contract exercised.
    return this.emitReport();
  }

  getReport(): CorrelationReport {
    this.recomputeScores();
    return buildReport([...this.states.values()], this.pollCount, this.eventCount);
  }

  private emitReport(): CorrelationReport {
    const report = this.getReport();
    this.onReport?.(report);
    return report;
  }

  private recomputeScores(): void {
    for (const state of this.states.values()) {
      const { score, reasons } = scoreCandidate(state, this.eventCount);
      state.score = score;
      state.strength = classifyScore(score, state.unreadable);
      state.reasons = reasons;
    }
  }

  private valuesEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= this.epsilon;
  }

  private candidateId(candidate: CorrelationCandidate): string {
    return candidate.id ?? `${candidate.address}:${candidate.dataType}:${candidate.source ?? 'manual'}:${candidate.scanMode ?? 'any'}`;
  }
}

function pushCapped<T>(items: T[], item: T, maxItems: number): void {
  items.push(item);
  while (items.length > maxItems) items.shift();
}

function parseObservedAtMs(observedAt?: string): number | null {
  if (!observedAt) return null;
  const parsed = Date.parse(observedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function directionFromDelta(delta: number, epsilon: number): CorrelationDirection {
  if (Math.abs(delta) <= epsilon) return 'unchanged';
  return delta > 0 ? 'increased' : 'decreased';
}

function eventMatchesDelta(expected: CorrelationDirection, delta: number, epsilon: number): boolean {
  const direction = directionFromDelta(delta, epsilon);
  return expected === 'changed' ? direction !== 'unchanged' : direction === expected;
}

function largestMeaningfulDelta(deltas: number[], epsilon: number): number | null {
  const meaningful = deltas.filter((delta) => Math.abs(delta) > epsilon);
  if (meaningful.length === 0) return deltas.length > 0 ? deltas[deltas.length - 1] : null;
  return meaningful.reduce((best, delta) => (Math.abs(delta) > Math.abs(best) ? delta : best), meaningful[0]);
}

function scoreCandidate(state: CorrelationCandidateState, eventCount: number): { score: number; reasons: string[] } {
  if (state.unreadable || state.readablePolls === 0) {
    return { score: 0, reasons: ['Candidate became unreadable'] };
  }

  const reasons: string[] = [];
  let score = 20;
  const changeRatio = state.polls > 0 ? state.changedPolls / state.polls : 0;

  if (eventCount > 0) {
    const eventMatchRatio = state.matchedEvents / eventCount;
    const contradictionRatio = state.contradictedEvents / eventCount;
    score += Math.round(eventMatchRatio * 55);
    score -= Math.round(contradictionRatio * 45);
    if (state.matchedEvents > 0) reasons.push(`Matched ${state.matchedEvents}/${eventCount} declared event(s)`);
    if (state.contradictedEvents > 0) reasons.push(`Contradicted ${state.contradictedEvents}/${eventCount} declared event(s)`);
    if (state.matchedEvents > 0 && state.recentDeltas.length > 1) reasons.push('Matched via recent-delta lookback window');
  } else {
    reasons.push('No player event markers recorded yet');
  }

  if (state.exactDeltaMatches > 0) {
    score += Math.min(15, state.exactDeltaMatches * 5);
    reasons.push('Matched declared delta amount');
  }

  if (changeRatio === 0) {
    score -= 15;
    reasons.push('Never changed during watcher polls');
  } else if (changeRatio > 0.8) {
    score -= 25;
    reasons.push('Changed almost every poll; likely noise/timer/animation');
  } else if (changeRatio >= 0.05 && changeRatio <= 0.6) {
    score += 15;
    reasons.push('Changed intermittently, consistent with gameplay-driven state');
  } else {
    score += 5;
    reasons.push('Changed occasionally');
  }

  if (state.dataType === 'float' || state.dataType === 'double') {
    score += 5;
    reasons.push('Decimal type is plausible for bars/resources');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function classifyScore(score: number, unreadable: boolean): CorrelationStrength {
  if (unreadable) return 'unreadable';
  if (score >= 75) return 'strong';
  if (score >= 55) return 'moderate';
  if (score < 25) return 'noise';
  return 'weak';
}

function buildReport(states: CorrelationCandidateState[], polls: number, events: number): CorrelationReport {
  const sorted = states
    .map((state) => {
      const {
        baselineValue: _baselineValue,
        deltaHistory: _deltaHistory,
        valueHistory: _valueHistory,
        ...publicState
      } = state as MutableCandidateState;
      return { ...publicState };
    })
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const strong = sorted.filter((state) => state.strength === 'strong');
  const moderate = sorted.filter((state) => state.strength === 'moderate');
  const weak = sorted.filter((state) => state.strength === 'weak');
  const noise = sorted.filter((state) => state.strength === 'noise');
  const unreadable = sorted.filter((state) => state.strength === 'unreadable');

  return {
    candidates: sorted,
    strong,
    moderate,
    weak,
    noise,
    unreadable,
    totals: {
      candidates: sorted.length,
      polls,
      events,
      strong: strong.length,
      moderate: moderate.length,
      weak: weak.length,
      noise: noise.length,
      unreadable: unreadable.length,
    },
    readOnly: true,
    executable: false,
  };
}
