/**
 * Phase 2 P2-5 — per-field candidate interpretation.
 *
 * Pure functions over raw bytes; no I/O. Decoding a field never claims
 * semantic truth (spec §11) — `decodeInterpretations` always returns every
 * plausible width-appropriate reading side by side. Pointer/string
 * candidate classification (spec §9/§10) is evidence-based: a pointer
 * candidate is only classified when the value lands in an actually-known
 * readable region, and a string candidate only when a real printable-ratio
 * threshold is met — never assumed from decode success alone.
 */
import type { MemoryModule, MemoryRegion } from './types.js';
import type {
  CandidateFieldWidth,
  FieldConfidence,
  FieldEvidence,
  FieldInterpretation,
  PointerCandidateEvidence,
  StringCandidateEvidence,
} from './structure-model.js';

const MIN_STRING_LENGTH = 3;
const PRINTABLE_RATIO_HIGH_THRESHOLD = 0.9;
const PRINTABLE_RATIO_MEDIUM_THRESHOLD = 0.6;

function isPrintableAscii(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

function toHex(buffer: Buffer): string {
  return `0x${buffer.toString('hex')}`;
}

/** Every plausible width-appropriate decoding of `buffer.subarray(offset, offset + width)`, per spec §6/§11. */
export function decodeInterpretations(buffer: Buffer, offset: number, width: CandidateFieldWidth): FieldInterpretation[] {
  const out: FieldInterpretation[] = [];
  switch (width) {
    case 1:
      out.push({ kind: 'u8', value: String(buffer.readUInt8(offset)) });
      out.push({ kind: 'i8', value: String(buffer.readInt8(offset)) });
      break;
    case 2:
      out.push({ kind: 'u16', value: String(buffer.readUInt16LE(offset)) });
      out.push({ kind: 'i16', value: String(buffer.readInt16LE(offset)) });
      break;
    case 4:
      out.push({ kind: 'u32', value: String(buffer.readUInt32LE(offset)) });
      out.push({ kind: 'i32', value: String(buffer.readInt32LE(offset)) });
      out.push({ kind: 'f32', value: formatFloat(buffer.readFloatLE(offset)) });
      out.push({ kind: 'pointer', value: `0x${buffer.readUInt32LE(offset).toString(16)}` });
      break;
    case 8:
      out.push({ kind: 'u64', value: buffer.readBigUInt64LE(offset).toString() });
      out.push({ kind: 'i64', value: buffer.readBigInt64LE(offset).toString() });
      out.push({ kind: 'f64', value: formatFloat(buffer.readDoubleLE(offset)) });
      out.push({ kind: 'pointer', value: `0x${buffer.readBigUInt64LE(offset).toString(16)}` });
      break;
  }
  const stringCandidate = classifyStringCandidate(buffer, offset, width);
  if (stringCandidate.classified) {
    out.push({ kind: stringCandidate.encoding === 'ascii' ? 'ascii' : 'utf16', value: stringCandidate.text });
  }
  const utf8Text = decodeUtf8Candidate(buffer, offset, width);
  if (utf8Text !== null) {
    out.push({ kind: 'utf8', value: utf8Text });
  }
  return out;
}

/**
 * P2-6 typed-view reinterpretation only — deliberately NOT part of
 * `classifyStringCandidate`'s evidence-gated ascii/utf16 candidate system
 * (that stays exactly as P2-5 certified it). Only reported when the bytes
 * decode as *valid* UTF-8 AND genuinely use a multi-byte sequence — pure
 * ASCII bytes already decode identically under the 'ascii' kind above, so a
 * duplicate 'utf8' entry there would add no information.
 */
function decodeUtf8Candidate(buffer: Buffer, offset: number, width: CandidateFieldWidth): string | null {
  const span = buffer.subarray(offset, offset + width);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(span);
  } catch {
    return null;
  }
  const hasMultiByteChar = Array.from(text).some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
  return hasMultiByteChar ? text : null;
}

function formatFloat(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  return String(value);
}

/**
 * A pointer candidate requires the width to be pointer-sized (4 or 8 bytes,
 * matching the process architecture the caller passes in) AND the decoded
 * value to fall inside an actually-enumerated module or region — never
 * classified from "looks like a plausible address range" alone (spec §9).
 */
export function classifyPointerCandidate(
  buffer: Buffer,
  offset: number,
  width: CandidateFieldWidth,
  pointerWidth: 4 | 8,
  modules: MemoryModule[],
  regions: MemoryRegion[],
): PointerCandidateEvidence {
  if (width !== pointerWidth) return { classified: false };
  const value = pointerWidth === 4 ? BigInt(buffer.readUInt32LE(offset)) : buffer.readBigUInt64LE(offset);
  if (value === 0n) return { classified: false };

  for (const mod of modules) {
    const end = mod.baseAddress + BigInt(mod.size);
    if (value >= mod.baseAddress && value < end) {
      return {
        classified: true,
        destinationAddress: `0x${value.toString(16)}`,
        destinationRegion: 'module',
        destinationModuleName: mod.name,
        readable: true,
      };
    }
  }
  for (const region of regions) {
    const end = region.baseAddress + BigInt(region.size);
    if (value >= region.baseAddress && value < end) {
      return {
        classified: true,
        destinationAddress: `0x${value.toString(16)}`,
        destinationRegion: 'heap_or_other_region',
        destinationModuleName: null,
        readable: true,
      };
    }
  }
  return { classified: false };
}

/**
 * A string candidate requires >= MIN_STRING_LENGTH consecutive printable
 * ASCII bytes (or UTF-16LE code units whose high byte is 0 and low byte is
 * printable ASCII) starting at `offset`, within the field's own width —
 * never a blanket "these bytes happen to be printable somewhere" claim
 * (spec §10).
 */
export function classifyStringCandidate(buffer: Buffer, offset: number, width: CandidateFieldWidth): StringCandidateEvidence {
  const span = buffer.subarray(offset, offset + width);
  if (span.length < MIN_STRING_LENGTH) return { classified: false };

  let asciiPrintable = 0;
  for (const byte of span) if (isPrintableAscii(byte)) asciiPrintable++;
  const asciiRatio = asciiPrintable / span.length;
  if (asciiRatio >= PRINTABLE_RATIO_MEDIUM_THRESHOLD) {
    return { classified: true, encoding: 'ascii', text: span.toString('latin1'), printableRatio: asciiRatio };
  }

  if (width >= 4 && width % 2 === 0) {
    let utf16Printable = 0;
    const units = width / 2;
    for (let i = 0; i < units; i++) {
      const low = span[i * 2];
      const high = span[i * 2 + 1];
      if (high === 0 && isPrintableAscii(low)) utf16Printable++;
    }
    const utf16Ratio = utf16Printable / units;
    if (utf16Ratio >= PRINTABLE_RATIO_MEDIUM_THRESHOLD) {
      return { classified: true, encoding: 'utf16', text: span.toString('utf16le'), printableRatio: utf16Ratio };
    }
  }
  return { classified: false };
}

export function buildFieldEvidence(pointerCandidate: PointerCandidateEvidence, stringCandidate: StringCandidateEvidence): FieldEvidence {
  return { pointerCandidate, stringCandidate };
}

export function deriveFieldConfidence(evidence: FieldEvidence): FieldConfidence {
  if (evidence.pointerCandidate.classified && evidence.pointerCandidate.readable) return 'high';
  if (evidence.stringCandidate.classified && evidence.stringCandidate.printableRatio >= PRINTABLE_RATIO_HIGH_THRESHOLD) return 'high';
  if (evidence.stringCandidate.classified) return 'medium';
  return 'low';
}

export function fieldRawHex(buffer: Buffer, offset: number, width: number): string {
  return toHex(buffer.subarray(offset, offset + width));
}
