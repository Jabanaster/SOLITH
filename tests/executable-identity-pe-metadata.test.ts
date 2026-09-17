/**
 * Real LIEF-backed PE structural parsing coverage. Uses genuine Windows
 * system executables (never a synthetic/fabricated PE) so section names,
 * subsystem, and bitness are checked against real binaries, plus malformed
 * inputs to prove the parser never throws uncaught or crashes the process —
 * this path runs on untrusted user-supplied trainer executables in
 * trainer-research (pe-analyzer.ts).
 */
import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePeStructuralMetadata } from '../src/core/executable-identity/pe-metadata.ts';

const SYSTEM32 = 'C:\\Windows\\System32';
const NOTEPAD = path.join(SYSTEM32, 'notepad.exe');
const CMD = path.join(SYSTEM32, 'cmd.exe');
const hasWindowsFixtures = fs.existsSync(NOTEPAD) && fs.existsSync(CMD);

describe('resolvePeStructuralMetadata — real PE binaries', { skip: !hasWindowsFixtures ? 'requires Windows system executables' : false }, () => {
  test('parses a real GUI-subsystem x64 executable', () => {
    const result = resolvePeStructuralMetadata(NOTEPAD);
    assert.equal(result.isPe, true);
    if (!result.isPe) return;
    assert.equal(result.bitness, 'x64');
    assert.equal(result.subsystem, 'windows-gui');
    assert.match(result.entryPoint, /^0x[0-9A-F]+$/);
    assert.match(result.imageBase, /^0x[0-9A-F]+$/);
    assert.ok(result.sections.length > 0);
    assert.ok(result.sections.some((s) => s.name === '.text'));
    assert.ok(result.sections.every((s) => s.virtualSize >= 0 && s.rawSize >= 0));
  });

  test('parses a real console-subsystem x64 executable with a different subsystem value', () => {
    const result = resolvePeStructuralMetadata(CMD);
    assert.equal(result.isPe, true);
    if (!result.isPe) return;
    assert.equal(result.subsystem, 'windows-cui');
  });
});

describe('resolvePeStructuralMetadata — malformed/untrusted input safety', () => {
  let tmpDir: string;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-pe-metadata-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAndParse(name: string, bytes: Buffer) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, bytes);
    return resolvePeStructuralMetadata(filePath);
  }

  test('empty file is reported as not-PE, not thrown', () => {
    assert.deepEqual(writeAndParse('empty.exe', Buffer.alloc(0)), { isPe: false });
  });

  test('random garbage is reported as not-PE, not thrown', () => {
    const garbage = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37) % 256));
    assert.deepEqual(writeAndParse('garbage.exe', garbage), { isPe: false });
  });

  test('truncated MZ-only header is reported as not-PE, not thrown', () => {
    assert.deepEqual(writeAndParse('mz-only.exe', Buffer.from('MZ')), { isPe: false });
  });

  test('a non-executable text file is reported as not-PE, not thrown', () => {
    assert.deepEqual(writeAndParse('readme.exe', Buffer.from('this is not a PE file at all')), { isPe: false });
  });

  test('missing file path is reported as not-PE, not thrown', () => {
    const result = resolvePeStructuralMetadata(path.join(tmpDir, 'does-not-exist.exe'));
    assert.deepEqual(result, { isPe: false });
  });
});
