/**
 * Phase 2 P2-7 — Value/type inference.
 *
 * Strictly separate from decoding (P2-5/P2-6): a byte sequence being
 * decodable as float/int is never sufficient to call it a "likely" type —
 * per mission §11/§12, inference requires independent EVIDENCE (value
 * stability, monotonicity, bounded fluctuation, repeated snapshots,
 * pointer-destination validity, string validity), reusing P2-5's own
 * evidence-vs-truth vocabulary (`FieldConfidence`) rather than inventing a
 * second one. This module never assigns a semantic field name — only a
 * behavior candidate ("looks like a monotonic counter") plus its evidence.
 *
 * Input is an ordered series of `StructureSnapshot`s of the SAME
 * `DiscoveredStructure` (P2-5's existing capture/compare primitives) — no
 * new capture mechanism, per mission §13 "leverage P2-5 snapshots/diff."
 */
import type { CandidateFieldWidth, DiscoveredField, DiscoveredStructure, FieldConfidence, StructureSnapshot } from './structure-model.js';
import { classifyStringCandidate } from './structure-interpretation.js';

export type FieldBehaviorCandidate =
  | 'stable'
  | 'monotonic_increasing'
  | 'monotonic_decreasing'
  | 'bounded_float'
  | 'pointer_stable'
  | 'string_like'
  | 'volatile_unknown';

export interface FieldBehaviorEvidence {
  behavior: FieldBehaviorCandidate;
  confidence: FieldConfidence;
}

export interface FieldInferenceEvidence {
  /** How many readable snapshot observations of this field's bytes were actually used. */
  observationCount: number;
  /** Distinct raw-byte values observed, as a stability signal. */
  distinctByteValues: number;
  sampledAt: string[];
}

export interface FieldInferenceResult {
  offset: number;
  width: CandidateFieldWidth;
  /** Ranked, evidence-based candidates — empty when there is not yet enough evidence (never invented certainty, spec §11/§12). */
  candidates: FieldBehaviorEvidence[];
  evidence: FieldInferenceEvidence;
}

const MIN_OBSERVATIONS_FOR_ANY_CLAIM = 2;
const HIGH_CONFIDENCE_OBSERVATION_THRESHOLD = 5;

function extractFieldBytes(field: DiscoveredField, snapshot: StructureSnapshot, structureBaseOffset: number): Buffer | null {
  if (snapshot.completeness.state === 'failed' || snapshot.rawHex === null) return null;
  const windowBuffer = Buffer.from(snapshot.rawHex.replace(/^0x/, ''), 'hex');
  const start = field.offset - structureBaseOffset;
  if (start < 0 || start + field.width > windowBuffer.length) return null;
  return windowBuffer.subarray(start, start + field.width);
}

function decodeSignedInteger(buffer: Buffer, width: CandidateFieldWidth): bigint | null {
  switch (width) {
    case 1:
      return BigInt(buffer.readInt8(0));
    case 2:
      return BigInt(buffer.readInt16LE(0));
    case 4:
      return BigInt(buffer.readInt32LE(0));
    case 8:
      return buffer.readBigInt64LE(0);
  }
}

function decodeFloat(buffer: Buffer, width: CandidateFieldWidth): number | null {
  if (width === 4) return buffer.readFloatLE(0);
  if (width === 8) return buffer.readDoubleLE(0);
  return null;
}

function isStrictlyMonotonic(values: bigint[], direction: 'increasing' | 'decreasing'): boolean {
  if (values.length < 2) return false;
  let sawChange = false;
  for (let i = 1; i < values.length; i++) {
    const cmp = values[i] > values[i - 1] ? 1 : values[i] < values[i - 1] ? -1 : 0;
    if (cmp === 0) continue; // a repeated tick between two live snapshots is not a violation, just no new evidence
    if ((direction === 'increasing' && cmp < 0) || (direction === 'decreasing' && cmp > 0)) return false;
    sawChange = true;
  }
  return sawChange;
}

function confidenceForObservationCount(count: number): FieldConfidence {
  if (count >= HIGH_CONFIDENCE_OBSERVATION_THRESHOLD) return 'high';
  if (count >= MIN_OBSERVATIONS_FOR_ANY_CLAIM) return 'medium';
  return 'low';
}

/** Infers behavior candidates for one field across an ordered series of the same structure's snapshots. */
export function inferFieldBehavior(
  field: DiscoveredField,
  structureBaseOffset: number,
  orderedSnapshots: StructureSnapshot[],
): FieldInferenceResult {
  const observations: { buffer: Buffer; sampledAt: string }[] = [];
  for (const snapshot of orderedSnapshots) {
    const bytes = extractFieldBytes(field, snapshot, structureBaseOffset);
    if (bytes) observations.push({ buffer: Buffer.from(bytes), sampledAt: snapshot.capturedAt });
  }

  const distinctByteValues = new Set(observations.map((o) => o.buffer.toString('hex'))).size;
  const evidence: FieldInferenceEvidence = {
    observationCount: observations.length,
    distinctByteValues,
    sampledAt: observations.map((o) => o.sampledAt),
  };

  if (observations.length < MIN_OBSERVATIONS_FOR_ANY_CLAIM) {
    // Spec §11: decodable is not inferred — a single (or zero) observation earns no behavior claim at all.
    return { offset: field.offset, width: field.width, candidates: [], evidence };
  }

  const candidates: FieldBehaviorEvidence[] = [];
  const confidence = confidenceForObservationCount(observations.length);

  if (distinctByteValues === 1) {
    candidates.push({ behavior: 'stable', confidence });
    if (field.evidence.pointerCandidate.classified) {
      candidates.push({ behavior: 'pointer_stable', confidence: field.evidence.pointerCandidate.readable ? confidence : 'low' });
    }
    return { offset: field.offset, width: field.width, candidates, evidence };
  }

  const signedSeries = observations.map((o) => decodeSignedInteger(o.buffer, field.width));
  if (signedSeries.every((v): v is bigint => v !== null)) {
    const values = signedSeries as bigint[];
    if (isStrictlyMonotonic(values, 'increasing')) candidates.push({ behavior: 'monotonic_increasing', confidence });
    else if (isStrictlyMonotonic(values, 'decreasing')) candidates.push({ behavior: 'monotonic_decreasing', confidence });
  }

  if (candidates.length === 0 && (field.width === 4 || field.width === 8)) {
    const floatSeries = observations.map((o) => decodeFloat(o.buffer, field.width));
    if (floatSeries.every((v) => v !== null && Number.isFinite(v))) {
      candidates.push({ behavior: 'bounded_float', confidence: 'low' === confidence ? 'low' : 'medium' });
    }
  }

  const everyObservationLooksLikeString = observations.every(
    (o) => classifyStringCandidate(o.buffer, 0, field.width).classified,
  );
  if (everyObservationLooksLikeString) {
    candidates.push({ behavior: 'string_like', confidence });
  }

  if (candidates.length === 0) {
    candidates.push({ behavior: 'volatile_unknown', confidence: 'low' });
  }

  return { offset: field.offset, width: field.width, candidates, evidence };
}

/** Infers behavior candidates for every field of a discovered structure across its own snapshot history. */
export function inferStructureBehavior(structure: DiscoveredStructure, orderedSnapshots: StructureSnapshot[]): FieldInferenceResult[] {
  const baseOffset = 0; // DiscoveredField.offset is already window-relative, matching StructureSnapshot's own rawHex window.
  return structure.fields.map((field) => inferFieldBehavior(field, baseOffset, orderedSnapshots));
}
