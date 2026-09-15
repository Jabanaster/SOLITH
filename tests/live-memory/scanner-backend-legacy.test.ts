// Phase 1 / Stage 7 §7.3 — proves `LegacyScannerBackend` is a pure,
// behavior-preserving adapter: every result it produces is identical to
// calling `memory-scanner.ts`'s `scanFirst`/`aob-resolver.ts`'s
// `scanAobInProcess` directly, just repackaged into the canonical shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { scanFirst } from '../../src/core/live-memory/memory-scanner.js';
import { scanAobInProcess } from '../../src/core/live-memory/aob-resolver.js';
import { LegacyScannerBackend } from '../../src/core/live-memory/scanner-backend-legacy.js';

const HANDLE = { pid: 1234, opaque: { fake: true } };

function filledBuffer(size: number, fill = 0xaa): Buffer {
  return Buffer.alloc(size, fill);
}

test('LegacyScannerBackend.exactScan produces the same matches as calling scanFirst directly', async () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(64);
  region.writeInt32LE(500, 8);
  driver.addRegion(0x1000n, region, true);

  const direct = scanFirst(driver, HANDLE, 'int32', 500);
  const backend = new LegacyScannerBackend(driver, HANDLE);
  const outcome = await backend.exactScan('i32', 500, undefined, {});

  assert.equal(outcome.backend, 'legacy');
  assert.equal(outcome.matches.length, direct.matches.length);
  assert.equal(outcome.matches[0].address, direct.matches[0].address);
  assert.equal(outcome.matches[0].valueNumber, direct.matches[0].value);
  assert.equal(outcome.completeness.state, 'complete');
  assert.equal(outcome.isAuthoritativeAbsence, direct.matches.length === 0);
});

test('LegacyScannerBackend.exactScan reports complete_with_skipped_regions, never isAuthoritativeAbsence, when the legacy scan was truncated', async () => {
  const driver = new FakeMemoryDriver();
  driver.addUnreadableRegion(0x2000n, 4096, true);
  const backend = new LegacyScannerBackend(driver, HANDLE);

  const outcome = await backend.exactScan('i32', 999, undefined, {});

  assert.equal(outcome.matches.length, 0);
  assert.equal(outcome.completeness.state, 'complete_with_skipped_regions');
  assert.equal(outcome.isAuthoritativeAbsence, false, 'a truncated scan must never claim authoritative absence');
});

test('LegacyScannerBackend.exactScan int64 above Number.MAX_SAFE_INTEGER silently fails to find an exact match (D06), and this adapter does not paper over it', async () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(64);
  // Beyond Number.MAX_SAFE_INTEGER — does not round-trip exactly through a
  // JS Number. Legacy's own scanFirst searches by re-encoding
  // `BigInt(Number(targetValue))`, which for a value like this produces
  // different bytes than the exact planted value — so legacy finds
  // nothing, not a rounded value. This is the real, current shape of D06,
  // and this adapter must reproduce it exactly, not hide it.
  const planted = 9_000_000_000_000_000_123n; // beyond Number.MAX_SAFE_INTEGER, but clear of the i64::MAX rounding-overflow edge
  region.writeBigInt64LE(planted, 8);
  driver.addRegion(0x3000n, region, true);

  const backend = new LegacyScannerBackend(driver, HANDLE);
  const outcome = await backend.exactScan('i64', undefined, planted, {});

  assert.equal(
    outcome.matches.length,
    0,
    'legacy cannot exactly search for an int64 value beyond Number.MAX_SAFE_INTEGER — this is D06, not a bug in this adapter',
  );
});

test('LegacyScannerBackend.exactScan int64 within the safe-integer range round-trips exactly and reports a valueBigint', async () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(64);
  const planted = 4_000_000_000n; // within safe-integer range, but too wide for int32
  region.writeBigInt64LE(planted, 8);
  driver.addRegion(0x3100n, region, true);

  const backend = new LegacyScannerBackend(driver, HANDLE);
  const outcome = await backend.exactScan('i64', undefined, planted, {});

  assert.equal(outcome.matches.length, 1);
  assert.equal(outcome.matches[0].valueBigint, planted);
});

test('LegacyScannerBackend.aobScan produces the same address as calling scanAobInProcess directly', async () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(32, 0x00);
  region.writeUInt8(0x48, 4);
  region.writeUInt8(0x8b, 5);
  region.writeUInt8(0x05, 6);
  driver.addRegion(0x4000n, region, true);

  const direct = scanAobInProcess(driver, HANDLE, '48 8B 05');
  const backend = new LegacyScannerBackend(driver, HANDLE);
  const outcome = await backend.aobScan('48 8B 05', undefined, {});

  assert.equal(outcome.matches.length, 1);
  assert.equal(outcome.matches[0].address, direct);
});

test('LegacyScannerBackend.aobScan never claims authoritative absence — legacy tracks no completeness signal at all (D01/D04)', async () => {
  const driver = new FakeMemoryDriver();
  const region = filledBuffer(32, 0x00);
  driver.addRegion(0x5000n, region, true);

  const backend = new LegacyScannerBackend(driver, HANDLE);
  const outcome = await backend.aobScan('DE AD BE EF', undefined, {});

  assert.equal(outcome.matches.length, 0);
  assert.equal(outcome.isAuthoritativeAbsence, false);
  assert.equal(outcome.completeness.state, 'complete_with_skipped_regions');
});

test('LegacyScannerBackend rejects a pre-aborted scan control before doing any work', async () => {
  const driver = new FakeMemoryDriver();
  const backend = new LegacyScannerBackend(driver, HANDLE);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => backend.exactScan('i32', 1, undefined, {}, { signal: controller.signal }),
    (err: unknown) => err instanceof Error && err.name === 'ScannerBackendError',
  );
});
