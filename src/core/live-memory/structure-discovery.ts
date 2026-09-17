/**
 * Phase 2 P2-5 — Structure Discovery engine.
 *
 * discoverStructure: one bounded read + per-offset candidate breakdown.
 * captureStructureSnapshot / compareStructureSnapshots: multi-snapshot
 * discovery and delta-based field discovery (spec §7/§8) — a single static
 * byte dump is weak evidence; repeated snapshots of the same window let a
 * caller distinguish a mutable field from noise by deliberately changing
 * game state between captures.
 *
 * Mirrors research/hex-inspector.ts's read/clamp/try-catch shape (spec
 * §12/§13: bounded window, truthful completeness, never substitute zeros
 * for unread bytes).
 */
import type { LiveProcessHandle, MemoryDriver } from './types.js';
import {
  buildFieldEvidence,
  classifyPointerCandidate,
  classifyStringCandidate,
  decodeInterpretations,
  deriveFieldConfidence,
  fieldRawHex,
} from './structure-interpretation.js';
import {
  CANDIDATE_FIELD_WIDTHS,
  MAX_STRUCTURE_DISCOVERY_LENGTH,
  createDiscoveredStructureId,
  createStructureSnapshotId,
  type DiscoveredField,
  type DiscoveredStructure,
  type FieldChangeState,
  type FieldSnapshotDiff,
  type StructureDiscoveryRequest,
  type StructureSnapshot,
  type StructureSnapshotDiffResult,
  type UnknownSpan,
} from './structure-model.js';

const MIN_STRUCTURE_DISCOVERY_LENGTH = 1;

/** Fallback probe granularity when the whole-window read fails — matches research/hex-inspector.ts's 16-byte row width. */
const PARTIAL_READ_CHUNK_SIZE = 16;

export interface StructureDiscoveryOptions {
  /** Architecture pointer width for this attached process (spec §9 — recorded as evidence, never guessed by the engine itself). */
  pointerWidth: 4 | 8;
}

interface ReadableRun {
  /** Offset of this run relative to the discovery window's own base address. */
  offset: number;
  buffer: Buffer;
}

interface WindowReadResult {
  runs: ReadableRun[];
  unreadableSpans: UnknownSpan[];
  totalFailure: boolean;
  failureReason: string | null;
}

/**
 * Attempts one whole-window read first (the common, fast case). Only if
 * that throws does it fall back to per-chunk probing so a genuinely partial
 * read (spec §13) can be told apart from a total failure, instead of
 * collapsing both into one "failed" outcome.
 */
function readWindow(driver: MemoryDriver, handle: LiveProcessHandle, baseAddress: bigint, length: number): WindowReadResult {
  try {
    const buffer = driver.readBuffer(handle, baseAddress, length);
    return { runs: [{ offset: 0, buffer }], unreadableSpans: [], totalFailure: false, failureReason: null };
  } catch (wholeWindowError) {
    const runs: ReadableRun[] = [];
    const unreadableSpans: UnknownSpan[] = [];
    for (let offset = 0; offset < length; offset += PARTIAL_READ_CHUNK_SIZE) {
      const chunkLength = Math.min(PARTIAL_READ_CHUNK_SIZE, length - offset);
      try {
        const chunkBuffer = driver.readBuffer(handle, baseAddress + BigInt(offset), chunkLength);
        const last = runs[runs.length - 1];
        if (last && last.offset + last.buffer.length === offset) {
          runs[runs.length - 1] = { offset: last.offset, buffer: Buffer.concat([last.buffer, chunkBuffer]) };
        } else {
          runs.push({ offset, buffer: chunkBuffer });
        }
      } catch {
        unreadableSpans.push({ offset, length: chunkLength });
      }
    }
    return {
      runs,
      unreadableSpans,
      totalFailure: runs.length === 0,
      failureReason: runs.length === 0 ? String(wholeWindowError) : null,
    };
  }
}

/** Everything decoded per offset, before deciding which single width to keep as this offset's field (spec §5 — do not automatically turn every aligned sequence into a field). */
function buildFieldAt(
  buffer: Buffer,
  offset: number,
  width: 1 | 2 | 4 | 8,
  pointerWidth: 4 | 8,
  modules: import('./types.js').MemoryModule[],
  regions: import('./types.js').MemoryRegion[],
): DiscoveredField {
  const interpretations = decodeInterpretations(buffer, offset, width);
  const pointerCandidate = classifyPointerCandidate(buffer, offset, width, pointerWidth, modules, regions);
  const stringCandidate = classifyStringCandidate(buffer, offset, width);
  const evidence = buildFieldEvidence(pointerCandidate, stringCandidate);
  return {
    offset,
    width,
    aligned: offset % width === 0,
    confidence: deriveFieldConfidence(evidence),
    rawHex: fieldRawHex(buffer, offset, width),
    interpretations,
    evidence,
  };
}

/**
 * Greedy left-to-right field segmentation over one CONTIGUOUS readable run.
 * At each unconsumed offset, prefer a width with real evidence (pointer or
 * string candidate) if one fits; otherwise fall back to the widest width
 * that fits, so every readable byte is always attributed to some field.
 * 'low' confidence (the common case — most bytes have no independent
 * pointer/string evidence) is a truthful, expected outcome, not a reason to
 * exclude the byte from having a field at all (spec §3 lists "unknown
 * bytes" as one candidate a field can show, not a reason to omit the
 * field). Every field's `interpretations` array still carries every
 * plausible width-appropriate decoding (spec §22 field inspector) — this
 * only decides the per-offset row width used for the top-level table
 * (spec §21), and never claims that row width is "the" structure layout.
 */
function segmentFields(
  buffer: Buffer,
  runOffset: number,
  pointerWidth: 4 | 8,
  modules: import('./types.js').MemoryModule[],
  regions: import('./types.js').MemoryRegion[],
): DiscoveredField[] {
  const fields: DiscoveredField[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    let picked: DiscoveredField | null = null;
    for (const width of CANDIDATE_FIELD_WIDTHS) {
      if (offset + width > buffer.length) continue;
      const candidate = buildFieldAt(buffer, offset, width, pointerWidth, modules, regions);
      if (candidate.confidence !== 'low') {
        picked = candidate;
        break;
      }
    }
    if (!picked) {
      const width = (CANDIDATE_FIELD_WIDTHS.find((w) => offset + w <= buffer.length) ?? 1) as 1 | 2 | 4 | 8;
      picked = buildFieldAt(buffer, offset, width, pointerWidth, modules, regions);
    }
    fields.push({ ...picked, offset: picked.offset + runOffset });
    offset += picked.width;
  }
  return fields;
}

export function discoverStructure(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  request: StructureDiscoveryRequest,
  options: StructureDiscoveryOptions,
): DiscoveredStructure {
  const requestedLength = Math.trunc(request.length);
  const length = Math.min(Math.max(requestedLength, MIN_STRUCTURE_DISCOVERY_LENGTH), MAX_STRUCTURE_DISCOVERY_LENGTH);
  const truncated = requestedLength > MAX_STRUCTURE_DISCOVERY_LENGTH;
  const baseAddressHex = `0x${request.baseAddress.toString(16)}`;

  const { runs, unreadableSpans, totalFailure, failureReason } = readWindow(driver, handle, request.baseAddress, length);

  if (totalFailure) {
    return {
      id: createDiscoveredStructureId(),
      label: request.label,
      baseAddressHex,
      length,
      truncated,
      completeness: { state: 'failed', reason: failureReason ?? 'unreadable' },
      fields: [],
      unknownSpans: unreadableSpans,
      createdAt: new Date().toISOString(),
    };
  }

  // The window read above already succeeded — those bytes are a real,
  // already-captured fact. A process that exits (or otherwise becomes
  // unqueryable) in the gap between that read and this module/region
  // enumeration must not discard that real evidence: it degrades pointer-
  // candidate classification (no known modules/regions to check against,
  // so nothing classifies — an honest "unknown", never a fabricated one)
  // rather than crashing the whole discovery (spec §9/§19 — process exit
  // between the read and this call must yield truthful results, not a
  // thrown exception surfacing as an opaque IPC failure).
  let modules: import('./types.js').MemoryModule[] = [];
  let regions: import('./types.js').MemoryRegion[] = [];
  try {
    modules = driver.getModules(handle);
    regions = driver.getRegions(handle);
  } catch {
    /* process became unqueryable after the read above — fall back to no known modules/regions. */
  }
  const fields = runs.flatMap((run) => segmentFields(run.buffer, run.offset, options.pointerWidth, modules, regions));
  fields.sort((a, b) => a.offset - b.offset);

  return {
    id: createDiscoveredStructureId(),
    label: request.label,
    baseAddressHex,
    length,
    truncated,
    completeness: unreadableSpans.length === 0 ? { state: 'complete' } : { state: 'complete_with_unreadable_spans' },
    fields,
    unknownSpans: unreadableSpans,
    createdAt: new Date().toISOString(),
  };
}

/** Re-reads the exact same window a structure was discovered at (spec §14/§15 refreshStructure). */
export function refreshStructure(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  structure: DiscoveredStructure,
  options: StructureDiscoveryOptions,
): DiscoveredStructure {
  return discoverStructure(driver, handle, { label: structure.label, baseAddress: BigInt(structure.baseAddressHex), length: structure.length }, options);
}

export function captureStructureSnapshot(driver: MemoryDriver, handle: LiveProcessHandle, structure: DiscoveredStructure): StructureSnapshot {
  try {
    const buffer = driver.readBuffer(handle, BigInt(structure.baseAddressHex), structure.length);
    return {
      id: createStructureSnapshotId(),
      structureId: structure.id,
      completeness: { state: 'complete' },
      rawHex: `0x${buffer.toString('hex')}`,
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      id: createStructureSnapshotId(),
      structureId: structure.id,
      completeness: { state: 'failed', reason: String(err) },
      rawHex: null,
      capturedAt: new Date().toISOString(),
    };
  }
}

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex');
}

function classifyByteChange(oldReadable: boolean, newReadable: boolean, changed: boolean): FieldChangeState {
  if (!oldReadable && newReadable) return 'became_readable';
  if (oldReadable && !newReadable) return 'became_unreadable';
  return changed ? 'changed' : 'unchanged';
}

/**
 * Coalesces contiguous changed-byte ranges between two snapshots of the
 * same structure (spec §8 — delta-based field discovery). Does not assign
 * a type to a changed range; that stays the caller's job via
 * discoverStructure/inspectField on the live structure afterward.
 */
export function compareStructureSnapshots(a: StructureSnapshot, b: StructureSnapshot): StructureSnapshotDiffResult {
  if (a.structureId !== b.structureId) {
    throw new Error(`Cannot compare snapshots from different structures (${a.structureId} vs ${b.structureId})`);
  }
  const oldReadable = a.completeness.state === 'complete' && a.rawHex !== null;
  const newReadable = b.completeness.state === 'complete' && b.rawHex !== null;
  const changes: FieldSnapshotDiff[] = [];

  if (!oldReadable || !newReadable) {
    changes.push({
      offset: 0,
      length: 0,
      state: classifyByteChange(oldReadable, newReadable, false),
      oldRawHex: a.rawHex,
      newRawHex: b.rawHex,
    });
    return { structureId: a.structureId, snapshotAId: a.id, snapshotBId: b.id, changes };
  }

  const oldBuf = hexToBuffer(a.rawHex!);
  const newBuf = hexToBuffer(b.rawHex!);
  const length = Math.min(oldBuf.length, newBuf.length);

  let runStart: number | null = null;
  for (let i = 0; i < length; i++) {
    const differs = oldBuf[i] !== newBuf[i];
    if (differs && runStart === null) runStart = i;
    if (!differs && runStart !== null) {
      changes.push(makeChangedRange(oldBuf, newBuf, runStart, i));
      runStart = null;
    }
  }
  if (runStart !== null) changes.push(makeChangedRange(oldBuf, newBuf, runStart, length));

  return { structureId: a.structureId, snapshotAId: a.id, snapshotBId: b.id, changes };
}

function makeChangedRange(oldBuf: Buffer, newBuf: Buffer, start: number, end: number): FieldSnapshotDiff {
  return {
    offset: start,
    length: end - start,
    state: 'changed',
    oldRawHex: `0x${oldBuf.subarray(start, end).toString('hex')}`,
    newRawHex: `0x${newBuf.subarray(start, end).toString('hex')}`,
  };
}
