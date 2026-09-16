import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TrainerExeAnalysis } from './types.js';
import { resolvePeStructuralMetadata } from '../executable-identity/pe-metadata.js';

const MAX_ANALYZE_BYTES = 50 * 1024 * 1024;
const MAX_STRINGS = 400;
const MIN_STRING_LEN = 5;

// Real Microsoft PE/COFF Machine field values (winnt.h IMAGE_FILE_MACHINE_*).
// Kept as a direct fixed-offset read (not delegated to LIEF) because the
// node-lief binding actually available does not expose this — see
// ../executable-identity/pe-metadata.ts's module doc for the verified gap.
// Unlike full section-table/optional-header parsing, a 2-byte fixed-offset
// COFF field read carries no PE32/PE32_PLUS branching risk, so hand-reading
// it here (once LIEF has already confirmed this is a valid PE) is not the
// same class of risk the rest of this file's LIEF migration addresses.
const MACHINE_TYPES: Record<number, string> = {
  0x014c: 'i386',
  0x8664: 'x64',
  0xaa64: 'ARM64',
};

function readU16(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

/** Best-effort raw COFF machine type + link timestamp. Never throws — a file LIEF parsed leniently may not have every fixed offset in range. */
function readCoffMachineAndTimestamp(buf: Buffer): { machine: string; peTimestamp?: string } {
  try {
    const peOffset = readU32(buf, 0x3c);
    const coffOffset = peOffset + 4;
    if (coffOffset + 8 > buf.length) return { machine: 'unknown' };
    const machineCode = readU16(buf, coffOffset);
    const timestamp = readU32(buf, coffOffset + 4);
    return {
      machine: MACHINE_TYPES[machineCode] ?? `unknown(0x${machineCode.toString(16)})`,
      peTimestamp: new Date(timestamp * 1000).toISOString(),
    };
  } catch {
    return { machine: 'unknown' };
  }
}

function extractAsciiStrings(buf: Buffer): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current = '';

  for (let i = 0; i < buf.length; i += 1) {
    const code = buf[i];
    const printable = code >= 0x20 && code <= 0x7e;
    if (printable) {
      current += String.fromCharCode(code);
      continue;
    }
    if (current.length >= MIN_STRING_LEN) {
      const key = current.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(current);
        if (out.length >= MAX_STRINGS) return out;
      }
    }
    current = '';
  }

  if (current.length >= MIN_STRING_LEN && out.length < MAX_STRINGS) {
    out.push(current);
  }
  return out;
}

function scoreInterestingString(value: string): number {
  const lower = value.toLowerCase();
  let score = 0;
  if (/trainer|cheat|health|stamina|money|ammo|god|damage|shield|exp|pointer|kernel32|writeprocessmemory/i.test(lower)) {
    score += 3;
  }
  if (/\.exe|\.dll|palworld|dredge|steam/i.test(lower)) score += 2;
  if (value.length >= 12 && value.length <= 96) score += 1;
  return score;
}

export function analyzeTrainerExecutable(filePath: string): TrainerExeAnalysis {
  const resolved = path.resolve(filePath);
  const warnings: string[] = [];

  if (!resolved.toLowerCase().endsWith('.exe')) {
    throw new Error('Only .exe files can be analyzed (file is never executed).');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('File does not exist.');
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error('Path is not a file.');
  }
  if (stat.size > MAX_ANALYZE_BYTES) {
    throw new Error(`File exceeds ${MAX_ANALYZE_BYTES} byte analysis limit.`);
  }

  const buf = fs.readFileSync(resolved);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const fileName = path.basename(resolved);

  const hasDosHeader = buf.length >= 0x40 && readU16(buf, 0) === 0x5a4d;
  if (!hasDosHeader) {
    return {
      filePath: resolved,
      fileName,
      fileSizeBytes: stat.size,
      sha256,
      isPe: false,
      sections: [],
      interestingStrings: [],
      warnings: [
        'Not a valid PE/DOS executable — metadata only.',
        'Read-only PE analysis — Solith never executes user-supplied trainer binaries.',
      ],
      analyzedAt: new Date().toISOString(),
    };
  }

  // LIEF (real structural parser, ../executable-identity/pe-metadata.ts) is
  // the single authoritative source for isPe/sections/subsystem/entrypoint/
  // imageBase — it replaces this file's former hand-rolled section-table and
  // PE32/PE32_PLUS-optional-header offset math.
  const structural = resolvePeStructuralMetadata(resolved);

  if (!structural.isPe) {
    return {
      filePath: resolved,
      fileName,
      fileSizeBytes: stat.size,
      sha256,
      isPe: false,
      sections: [],
      interestingStrings: extractAsciiStrings(buf)
        .sort((a, b) => scoreInterestingString(b) - scoreInterestingString(a))
        .slice(0, 80),
      warnings: ['DOS header present but PE signature missing.'],
      analyzedAt: new Date().toISOString(),
    };
  }

  const { machine, peTimestamp } = readCoffMachineAndTimestamp(buf);

  const strings = extractAsciiStrings(buf)
    .sort((a, b) => scoreInterestingString(b) - scoreInterestingString(a))
    .slice(0, 80);

  if (/trainer|fling|mrantifun/i.test(fileName) === false) {
    warnings.push('Filename does not look like a public trainer build — verify you own/have rights to analyze it.');
  }
  warnings.push('Read-only PE analysis — Solith never executes user-supplied trainer binaries.');

  return {
    filePath: resolved,
    fileName,
    fileSizeBytes: stat.size,
    sha256,
    isPe: true,
    machine,
    peTimestamp,
    subsystem: structural.subsystem,
    imageBase: structural.imageBase,
    entryPoint: structural.entryPoint,
    sections: structural.sections,
    interestingStrings: strings,
    warnings,
    analyzedAt: new Date().toISOString(),
  };
}
