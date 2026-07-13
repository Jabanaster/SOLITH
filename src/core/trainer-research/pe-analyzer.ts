import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PeSectionInfo, TrainerExeAnalysis } from './types.js';

const MAX_ANALYZE_BYTES = 50 * 1024 * 1024;
const MAX_STRINGS = 400;
const MIN_STRING_LEN = 5;

const MACHINE_TYPES: Record<number, string> = {
  0x014c: 'i386',
  0x8664: 'x64',
  0xaa64: 'ARM64',
};

const SUBSYSTEM_TYPES: Record<number, string> = {
  1: 'native',
  2: 'windows-gui',
  3: 'windows-cui',
};

function readU16(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
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

function parsePeSections(buf: Buffer, peOffset: number): PeSectionInfo[] {
  const coffOffset = peOffset + 4;
  const numberOfSections = readU16(buf, coffOffset + 2);
  const optionalHeaderSize = readU16(buf, coffOffset + 16);
  const sectionTableOffset = coffOffset + 20 + optionalHeaderSize;
  const sections: PeSectionInfo[] = [];

  for (let i = 0; i < numberOfSections; i += 1) {
    const base = sectionTableOffset + i * 40;
    if (base + 40 > buf.length) break;
    const name = buf.subarray(base, base + 8).toString('utf8').replace(/\0/g, '').trim();
    sections.push({
      name: name || `section-${i}`,
      virtualSize: readU32(buf, base + 8),
      rawSize: readU32(buf, base + 16),
    });
  }
  return sections;
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

  if (buf.length < 0x40 || readU16(buf, 0) !== 0x5a4d) {
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

  const peOffset = readU32(buf, 0x3c);
  const isPe =
    peOffset + 4 <= buf.length &&
    buf[peOffset] === 0x50 &&
    buf[peOffset + 1] === 0x45 &&
    buf[peOffset + 2] === 0x00 &&
    buf[peOffset + 3] === 0x00;

  if (!isPe) {
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

  const coffOffset = peOffset + 4;
  const machine = MACHINE_TYPES[readU16(buf, coffOffset)] ?? `unknown(0x${readU16(buf, coffOffset).toString(16)})`;
  const timestamp = readU32(buf, coffOffset + 4);
  const optionalHeaderSize = readU16(buf, coffOffset + 16);
  const optionalOffset = coffOffset + 20;
  const magic = readU16(buf, optionalOffset);
  const isPe32Plus = magic === 0x20b;

  let imageBase: string | undefined;
  let entryPoint: string | undefined;
  let subsystem: string | undefined;

  if (isPe32Plus && optionalOffset + 0x38 <= buf.length) {
    entryPoint = `0x${readU32(buf, optionalOffset + 16).toString(16).toUpperCase()}`;
    imageBase = `0x${readU64(buf, optionalOffset + 24).toString(16).toUpperCase()}`;
    subsystem = SUBSYSTEM_TYPES[readU16(buf, optionalOffset + 0x44)] ?? `unknown(${readU16(buf, optionalOffset + 0x44)})`;
  } else if (optionalOffset + 0x34 <= buf.length) {
    entryPoint = `0x${readU32(buf, optionalOffset + 16).toString(16).toUpperCase()}`;
    imageBase = `0x${readU32(buf, optionalOffset + 28).toString(16).toUpperCase()}`;
    subsystem = SUBSYSTEM_TYPES[readU16(buf, optionalOffset + 0x44)] ?? `unknown(${readU16(buf, optionalOffset + 0x44)})`;
  }

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
    peTimestamp: new Date(timestamp * 1000).toISOString(),
    subsystem,
    imageBase,
    entryPoint,
    sections: parsePeSections(buf, peOffset),
    interestingStrings: strings,
    warnings,
    analyzedAt: new Date().toISOString(),
  };
}

function readU64(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}
