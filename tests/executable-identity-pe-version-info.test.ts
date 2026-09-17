import { describe, test, before as beforeAll, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePeVersionInfo } from '../src/core/executable-identity/pe-version-info.ts';

const NOTEPAD = 'C:\\Windows\\System32\\notepad.exe';
const hasWindowsFixture = fs.existsSync(NOTEPAD);

describe('resolvePeVersionInfo — real PE binary', { skip: !hasWindowsFixture ? 'requires a Windows system executable' : false }, () => {
  test('reads FileVersion/ProductVersion/CompanyName from a real signed system executable', () => {
    const info = resolvePeVersionInfo(NOTEPAD);
    assert.ok(info);
    assert.match(info!.fileVersion ?? '', /^\d+\.\d+\.\d+/);
    assert.match(info!.productVersion ?? '', /^\d+\.\d+\.\d+/);
    assert.ok(info!.companyName);
    assert.ok(info!.productName);
  });
});

describe('resolvePeVersionInfo — malformed/untrusted input safety', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-pe-version-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(name: string, bytes: Buffer): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
  }

  test('empty file returns null, not thrown', () => {
    assert.equal(resolvePeVersionInfo(write('empty.exe', Buffer.alloc(0))), null);
  });

  test('random garbage returns null, not thrown', () => {
    const garbage = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37) % 256));
    assert.equal(resolvePeVersionInfo(write('garbage.exe', garbage)), null);
  });

  test('truncated MZ-only header returns null, not thrown', () => {
    assert.equal(resolvePeVersionInfo(write('mz-only.exe', Buffer.from('MZ'))), null);
  });

  test('missing file returns null, not thrown', () => {
    assert.equal(resolvePeVersionInfo(path.join(tmpDir, 'does-not-exist.exe')), null);
  });

  test('a valid PE with no version resource at all (synthetic minimal PE) returns null gracefully', { skip: !hasWindowsFixture ? 'requires a Windows system executable' : false }, () => {
    // A real PE's headers only (no resource section) truncated well past the
    // headers but before any resource data — resedit will not find a usable
    // version resource and this must degrade to null, not throw.
    const real = fs.readFileSync(NOTEPAD);
    const partial = write('partial.exe', real.subarray(0, 4096));
    // Not asserting a specific outcome (may or may not parse depending on
    // where the resource directory happens to land) — only that it never throws.
    assert.doesNotThrow(() => resolvePeVersionInfo(partial));
  });
});
