/**
 * Phase 2 P2-5 — Structure Discovery data model.
 *
 * Scope: discover CANDIDATE field structure over a bounded byte region —
 * offsets, raw bytes, plausible interpretations, pointer/string candidates,
 * and unknown spans. This is deliberately NOT the typed-view subsystem
 * (P2-6) or value/type inference (P2-7): a field here carries several
 * plausible decodings side by side, never one chosen "the type".
 *
 * Every value is immutable once produced, matching pointer-map.ts's
 * convention. Addresses/offsets are `bigint`/`number` internally; IPC-facing
 * serialization (0x-hex strings) happens at the IPC boundary, not here.
 */

export type CandidateFieldWidth = 1 | 2 | 4 | 8;

/** A single plausible decoding of a field's raw bytes. Never a claim of semantic truth. */
export interface FieldInterpretation {
  kind: 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'i64' | 'f32' | 'f64' | 'pointer' | 'ascii' | 'utf16';
  /** Decoded value as a display string — numbers as decimal, pointers/bytes as 0x-hex. */
  value: string;
}

export type PointerCandidateEvidence =
  | { classified: false }
  | {
      classified: true;
      destinationAddress: string;
      destinationRegion: 'module' | 'heap_or_other_region' | null;
      destinationModuleName: string | null;
      readable: boolean;
    };

export type StringCandidateEvidence =
  | { classified: false }
  | { classified: true; encoding: 'ascii' | 'utf16'; text: string; printableRatio: number };

export interface FieldEvidence {
  pointerCandidate: PointerCandidateEvidence;
  stringCandidate: StringCandidateEvidence;
}

/**
 * Confidence is about EVIDENCE, not decode success — almost every 4-byte
 * span decodes successfully as int32/float (spec §11), so decode success
 * alone never earns more than 'low'. 'high'/'medium' require independently
 * checkable evidence (a live, readable pointer target; a high-printable-
 * ratio string) — never "resolved therefore correct" reasoning.
 */
export type FieldConfidence = 'low' | 'medium' | 'high';

/** A discovered field: a byte span within the structure's raw buffer, plus its evidence. */
export interface DiscoveredField {
  offset: number;
  width: CandidateFieldWidth;
  /** True when `offset % width !== 0` relative to the structure's own base — unaligned fields are supported, not required to be aligned. */
  aligned: boolean;
  confidence: FieldConfidence;
  /** Raw bytes for this field, as 0x-hex (e.g. "0xdeadbeef", big-endian display of the little-endian bytes read in order). */
  rawHex: string;
  interpretations: FieldInterpretation[];
  evidence: FieldEvidence;
}

/**
 * A byte range within the requested window that could not be read — spec
 * §13's partial-read truth requirement: never substitute zeros for unread
 * bytes, and never omit an unreadable range silently. Every OTHER byte in
 * the window is always attributed to some DiscoveredField (with 'low'
 * confidence when there is no independent evidence) — this is reserved
 * strictly for bytes that genuinely could not be read at all.
 */
export interface UnknownSpan {
  offset: number;
  length: number;
}

export type StructureReadCompleteness =
  | { state: 'complete' }
  | { state: 'complete_with_unreadable_spans' }
  | { state: 'failed'; reason: string };

/** One discovery result: the structure's identity, its fields, and truthful read completeness. */
export interface DiscoveredStructure {
  id: string;
  label: string;
  /** Absolute address the discovery was requested at, as 0x-hex. */
  baseAddressHex: string;
  /** Actual byte length inspected (after clamping to MAX_STRUCTURE_DISCOVERY_LENGTH). */
  length: number;
  /** True when the caller's requested length exceeded MAX_STRUCTURE_DISCOVERY_LENGTH and was clamped (spec §12) — never silent. */
  truncated: boolean;
  completeness: StructureReadCompleteness;
  fields: DiscoveredField[];
  unknownSpans: UnknownSpan[];
  createdAt: string;
}

export interface StructureDiscoveryRequest {
  label: string;
  /** Absolute address, 0x-hex or decimal string — parsed by the caller (structure-discovery.ts), not here. */
  baseAddress: bigint;
  length: number;
}

/** A captured byte-for-byte snapshot of a previously discovered structure's window, for later diffing. */
export interface StructureSnapshot {
  id: string;
  structureId: string;
  completeness: StructureReadCompleteness;
  /** Raw bytes at capture time, as 0x-hex, or null when completeness is 'failed'. */
  rawHex: string | null;
  capturedAt: string;
}

export type FieldChangeState = 'unchanged' | 'changed' | 'became_readable' | 'became_unreadable';

export interface FieldSnapshotDiff {
  offset: number;
  length: number;
  state: FieldChangeState;
  oldRawHex: string | null;
  newRawHex: string | null;
}

export interface StructureSnapshotDiffResult {
  structureId: string;
  snapshotAId: string;
  snapshotBId: string;
  /** Coalesced contiguous changed byte ranges between the two snapshots (spec §8 — delta-based field discovery). */
  changes: FieldSnapshotDiff[];
}

const DISCOVERY_ID_PREFIX = 'struct';
const SNAPSHOT_ID_PREFIX = 'structsnap';

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDiscoveredStructureId(): string {
  return newId(DISCOVERY_ID_PREFIX);
}

export function createStructureSnapshotId(): string {
  return newId(SNAPSHOT_ID_PREFIX);
}

/** Maximum inspection window (spec §12 — bounded reads, no accidental multi-gigabyte structure reads). Mirrors research/hex-inspector.ts's existing 4096-byte precedent. */
export const MAX_STRUCTURE_DISCOVERY_LENGTH = 4096;

/** Spec §18 resource limits — bounds the in-memory session registries (structures/snapshots accumulate across repeated discover/capture calls, unlike a single bounded read). Session-level, enforced by LiveMemorySession, not here. */
export const MAX_DISCOVERED_STRUCTURES_PER_SESSION = 100;
export const MAX_SNAPSHOTS_PER_STRUCTURE = 50;

/** Candidate widths tried at every offset, per spec §5/§6. Order matters: widest-first keeps wide interpretations (pointer/f64/u64) from being shadowed by an arbitrary narrower pick when both are plausible. */
export const CANDIDATE_FIELD_WIDTHS: readonly CandidateFieldWidth[] = [8, 4, 2, 1];
