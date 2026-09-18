import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeMemoryDriver } from '../fixtures/fake-memory-driver.js';
import { runPlannedScan } from '../../src/core/live-memory/adaptive-scan-orchestration.js';
import { AdaptiveScanTelemetryStore } from '../../src/core/live-memory/adaptive-scan-telemetry-store.js';

const HANDLE = { pid: 4242, opaque: { fake: true } };

function filled(size: number, fill = 0): Buffer {
  return Buffer.alloc(size, fill);
}

test('runPlannedScan (reference mode) finds every match in a module-heavy process, in OS-enumerated order', () => {
  const driver = new FakeMemoryDriver();
  const moduleRegion = filled(64);
  moduleRegion.writeInt32LE(777, 0);
  const privateRegion = filled(64);
  privateRegion.writeInt32LE(777, 4);
  driver.addRegion(0x1000n, moduleRegion, true, 'image');
  driver.addRegion(0x2000n, privateRegion, true, 'private');

  return runPlannedScan(driver, HANDLE, 'int32', 777, new AdaptiveScanTelemetryStore(), { mode: 'reference' }).then((outcome) => {
    assert.equal(outcome.plan.strategy, 'REFERENCE_FULL');
    assert.equal(outcome.plan.regionOrder, 'as_enumerated');
    assert.equal(outcome.result.matches.length, 2);
    // enumerated order: module region first, then private region
    assert.equal(outcome.result.matches[0].address, 0x1000n);
    assert.equal(outcome.result.matches[1].address, 0x2004n);
  });
});

test('runPlannedScan (adaptive mode) on a module-heavy profile scans the private region first, changing match order but not the match set', async () => {
  const driver = new FakeMemoryDriver();
  // Module region dominates eligible bytes (4096 vs 64) so the planner should classify this MODULE_HEAVY_PROFILE.
  const moduleRegion = filled(4096);
  moduleRegion.writeInt32LE(777, 0);
  const privateRegion = filled(64);
  privateRegion.writeInt32LE(777, 4);
  driver.addRegion(0x1000n, moduleRegion, true, 'image');
  driver.addRegion(0x2000n, privateRegion, true, 'private');

  const referenceOutcome = await runPlannedScan(driver, HANDLE, 'int32', 777, new AdaptiveScanTelemetryStore(), {
    mode: 'reference',
  });
  const adaptiveOutcome = await runPlannedScan(driver, HANDLE, 'int32', 777, new AdaptiveScanTelemetryStore(), {
    mode: 'adaptive',
  });

  assert.ok(adaptiveOutcome.plan.reasons.includes('MODULE_HEAVY_PROFILE'));
  assert.equal(adaptiveOutcome.plan.regionOrder, 'private_first');
  // §9 result-set equality: same addresses found regardless of strategy/order.
  const sortAddrs = (matches: { address: bigint }[]) => matches.map((m) => m.address).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(sortAddrs(adaptiveOutcome.result.matches), sortAddrs(referenceOutcome.result.matches));
  // But the private region was visited first under the adaptive plan, unlike reference.
  assert.equal(adaptiveOutcome.result.matches[0].address, 0x2004n);
});

test('a scan cancelled after the first region reports cancelled coverage and stops before scanning the rest', async () => {
  const driver = new FakeMemoryDriver();
  for (let i = 0; i < 3; i++) {
    const buf = filled(32);
    buf.writeInt32LE(555, 0);
    driver.addRegion(BigInt(0x5000 + i * 0x100), buf, true, 'private');
  }
  const signal = { aborted: false };
  const store = new AdaptiveScanTelemetryStore();

  const outcomePromise = runPlannedScan(driver, HANDLE, 'int32', 555, store, { mode: 'reference', signal });
  // Synchronous portion of the loop runs region 1 fully before its first
  // `await` (between region 1 and region 2) — flipping the signal here lands
  // genuinely mid-scan, not pre-flight.
  signal.aborted = true;
  const outcome = await outcomePromise;

  assert.equal(outcome.result.completeness.state, 'cancelled');
  assert.equal(outcome.result.regionsScanned, 1);
  assert.equal(outcome.telemetry.cancelled, true);
});

test('telemetry recorded from a real scan matches the scan result truthfully (no fabricated fields)', async () => {
  const driver = new FakeMemoryDriver();
  const buf = filled(64);
  buf.writeInt32LE(42, 0);
  buf.writeInt32LE(42, 32);
  driver.addRegion(0x9000n, buf, true, 'private');
  const store = new AdaptiveScanTelemetryStore();

  const { telemetry, result } = await runPlannedScan(driver, HANDLE, 'int32', 42, store, { mode: 'reference' });

  assert.equal(telemetry.resultCount, result.matches.length);
  assert.equal(telemetry.regionsScanned, result.regionsScanned);
  assert.equal(telemetry.scannedBytes, result.bytesScanned);
  assert.equal(telemetry.coverage, result.completeness.state);
  assert.ok(telemetry.elapsedMillis >= 0);
});

test('§11 follow-up feedback loop: a second scan in the same store sees the first scan as prior telemetry and adapts', async () => {
  const driver = new FakeMemoryDriver();
  // First value: sparse — only a couple of hits.
  const sparseRegion = filled(4096);
  sparseRegion.writeInt32LE(11, 0);
  driver.addRegion(0x1000n, sparseRegion, true, 'private');
  const store = new AdaptiveScanTelemetryStore();

  const first = await runPlannedScan(driver, HANDLE, 'int32', 11, store, { mode: 'adaptive' });
  // NO_PRIOR_TELEMETRY branch — a single all-private region is PRIVATE_HEAVY_PROFILE, not "uniform".
  assert.ok(first.plan.reasons.includes('NO_PRIOR_TELEMETRY'));
  assert.ok(first.plan.reasons.includes('PRIVATE_HEAVY_PROFILE'));
  assert.ok(first.telemetry.resultCount <= 500);

  const second = await runPlannedScan(driver, HANDLE, 'int32', 11, store, { mode: 'adaptive' });
  assert.equal(second.plan.strategy, 'NARROWED_BY_PRIOR_CANDIDATES');
  assert.ok(second.plan.reasons.includes('PRIOR_CANDIDATE_SET_SMALL'));
  assert.equal(store.list().length, 2);
});

test('detach-equivalent isolation: a fresh AdaptiveScanTelemetryStore never sees another store\'s history', async () => {
  const driver = new FakeMemoryDriver();
  const buf = filled(64);
  buf.writeInt32LE(9, 0);
  driver.addRegion(0xa000n, buf, true, 'private');

  const staleStore = new AdaptiveScanTelemetryStore();
  await runPlannedScan(driver, HANDLE, 'int32', 9, staleStore, { mode: 'adaptive' });
  assert.equal(staleStore.list().length, 1);

  const freshStore = new AdaptiveScanTelemetryStore();
  const outcome = await runPlannedScan(driver, HANDLE, 'int32', 9, freshStore, { mode: 'adaptive' });
  assert.ok(outcome.plan.reasons.includes('NO_PRIOR_TELEMETRY'));
});
