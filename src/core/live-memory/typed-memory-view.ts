/**
 * Phase 2 P2-6 — Typed memory-view expansion.
 *
 * Builds directly on P2-5's `FieldInterpretation`/`decodeInterpretations`
 * (structure-model.ts / structure-interpretation.ts) rather than a second
 * typed-value vocabulary: a typed view reads a small, bounded window (the
 * largest supported scalar is 8 bytes) and reports EVERY plausible
 * interpretation at EVERY width the bytes support, side by side — the same
 * evidence-vs-truth discipline P2-5 already established (spec/mission §6:
 * "This is interpretation. It is not semantic inference.").
 *
 * Pure orchestration over `MemoryDriver`; no session/registry state lives
 * here — `LiveMemorySession` (live-memory-session.ts) is the only stateful
 * caller, matching mission §5's "do NOT create a second memory session
 * subsystem."
 */
import type { LiveProcessHandle, MemoryDriver } from './types.js';
import type { CandidateFieldWidth, FieldInterpretation } from './structure-model.js';
import { decodeInterpretations } from './structure-interpretation.js';

/** Every scalar width a typed view can decode — mirrors structure-model.ts's CANDIDATE_FIELD_WIDTHS, narrowest-first for display order. */
export const TYPED_VIEW_WIDTHS: readonly CandidateFieldWidth[] = [1, 2, 4, 8];

/** Widest supported scalar — bounds every typed-view read (spec §36 resource limits: memory-view bytes). */
export const MAX_TYPED_VIEW_LENGTH: CandidateFieldWidth = 8;

/** Bounds a single `readTypedValues` batch call (spec §36: no unbounded request size). */
export const MAX_TYPED_VIEW_BATCH = 32;

export interface TypedMemoryViewRequest {
  address: bigint;
  /** Bytes to read; must be one of TYPED_VIEW_WIDTHS. */
  length: CandidateFieldWidth;
}

/** Interpretations computed for each width <= the bytes actually read, keyed by width. */
export type TypedInterpretationsByWidth = Partial<Record<CandidateFieldWidth, FieldInterpretation[]>>;

export type TypedViewReadState = 'complete' | 'failed';

export interface TypedMemoryView {
  addressHex: string;
  /** Module the address falls inside, if any known module contains it — null is a truthful "not in a known module region," never a fabricated guess. */
  moduleName: string | null;
  requestedLength: CandidateFieldWidth;
  /** Bytes actually read; 0 when readState is 'failed'. */
  actualLength: number;
  /** Raw bytes as 0x-hex, or null when readState is 'failed'. */
  rawHex: string | null;
  readState: TypedViewReadState;
  reason?: string;
  interpretationsByWidth: TypedInterpretationsByWidth;
  readAt: string;
}

function findContainingModule(address: bigint, driver: MemoryDriver, handle: LiveProcessHandle): string | null {
  try {
    const modules = driver.getModules(handle);
    for (const mod of modules) {
      const end = mod.baseAddress + BigInt(mod.size);
      if (address >= mod.baseAddress && address < end) return mod.name;
    }
  } catch {
    // Module enumeration can fail independently of the read itself (e.g. the
    // process exits in the gap, same class of degrade-gracefully behavior
    // P2-5's discoverStructure already applies) — an honest "unknown", never
    // a thrown error that discards an otherwise-successful byte read.
  }
  return null;
}

function computeInterpretations(buffer: Buffer): TypedInterpretationsByWidth {
  const out: TypedInterpretationsByWidth = {};
  for (const width of TYPED_VIEW_WIDTHS) {
    if (buffer.length < width) continue;
    out[width] = decodeInterpretations(buffer, 0, width);
  }
  return out;
}

/** Reads one typed-view window from a live, attached process. */
export function readTypedMemoryView(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  request: TypedMemoryViewRequest,
): TypedMemoryView {
  const addressHex = `0x${request.address.toString(16)}`;
  const readAt = new Date().toISOString();

  let buffer: Buffer;
  try {
    buffer = driver.readBuffer(handle, request.address, request.length);
  } catch (err) {
    return {
      addressHex,
      moduleName: null,
      requestedLength: request.length,
      actualLength: 0,
      rawHex: null,
      readState: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      interpretationsByWidth: {},
      readAt,
    };
  }

  return {
    addressHex,
    moduleName: findContainingModule(request.address, driver, handle),
    requestedLength: request.length,
    actualLength: buffer.length,
    rawHex: `0x${buffer.toString('hex')}`,
    readState: 'complete',
    interpretationsByWidth: computeInterpretations(buffer),
    readAt,
  };
}

/** Batched typed-view reads — each request succeeds or fails independently (spec: no single bad address should hide the rest of a batch). */
export function readTypedMemoryViews(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  requests: TypedMemoryViewRequest[],
): TypedMemoryView[] {
  const bounded = requests.slice(0, MAX_TYPED_VIEW_BATCH);
  return bounded.map((request) => readTypedMemoryView(driver, handle, request));
}

/**
 * Recomputes every width's interpretations from bytes ALREADY read (spec §6:
 * "without rereading or mutating memory unnecessarily") — pure, no I/O. Used
 * to re-derive `interpretationsByWidth` from a previously captured
 * `rawHex` without a fresh live read; `refreshTypedValue` (LiveMemorySession)
 * is the live-reread counterpart.
 */
export function reinterpretRawHex(rawHex: string): TypedInterpretationsByWidth {
  const hex = rawHex.startsWith('0x') ? rawHex.slice(2) : rawHex;
  const buffer = Buffer.from(hex, 'hex');
  return computeInterpretations(buffer);
}
