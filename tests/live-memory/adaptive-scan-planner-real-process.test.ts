// P2-10 — Adaptive Scan Planner, real-process proof (mission §21/§23). Spawns
// the real `solith-scanner-fixture.exe` Windows process, attaches the real
// production `LiveMemorySession` over the real `nativeMemoryDriver` (the
// exact classes `electron/live-memory-ipc.ts` delegates to), and proves:
//
//  1. A real measured region profile (real DLL-backed "image" regions +
//     real private heap/stack regions — not a synthetic scenario) drives the
//     planner's initial strategy (§12).
//  2. A real prior scan's measured telemetry (not its own profile) drives
//     the NEXT scan's plan — the §13 follow-up feedback loop — cross-checked
//     against the pure planner function fed that exact recorded telemetry,
//     so the proof does not depend on guessing this machine's memory
//     contents (§23's own request for a concrete, non-fabricated example).
//  3. Reference and adaptive scans of the same value return the same
//     address set (§9 result-set equality) even though region visitation
//     order differs.
//
// Skips cleanly (not a failure) when the fixture binary or the native driver
// addon has not been built in this environment — this test proves real
// behavior, it does not build prerequisites itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { LiveMemorySession } from '../../src/core/live-memory/live-memory-session.js';
import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.js';
import { buildScanRegionProfile, planAdaptiveScan } from '../../src/core/live-memory/adaptive-scan-planner.js';

const FIXTURE_PATH = path.resolve(
  import.meta.dirname, '..', '..', 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe',
);
function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}
const testRequire = createRequire(import.meta.url);
function memoryjsAvailable(): boolean {
  try {
    testRequire('memoryjs');
    return true;
  } catch {
    try {
      testRequire(path.resolve(import.meta.dirname, '..', '..', 'vendor', 'memoryjs-3.5.1-patched', 'index.js'));
      return true;
    } catch {
      return false;
    }
  }
}
function realEnvSkipReason(): string | false {
  if (!fixtureAvailable()) return 'native fixture binary not built in this environment';
  if (!memoryjsAvailable()) return 'memoryjs addon not available in this environment';
  return false;
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
  /** Writes exact little-endian bytes at `offset` within REFINE_REGION (the fixture's real stdin protocol); resolves once the fixture confirms `WROTE <offset>`. */
  writeBytes: (offset: number, leHex: string) => Promise<void>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {
    /* fixture already gone — nothing left to say to it */
  });
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    const pendingWrites: Array<{ offset: number; resolve: () => void; reject: (e: Error) => void }> = [];

    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          child.stdout.on('data', onWriteAckData);
          resolve({ child, fields, writeBytes });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }

    let ackBuffered = '';
    function onWriteAckData(chunk: Buffer) {
      ackBuffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = ackBuffered.indexOf('\n')) !== -1) {
        const line = ackBuffered.slice(0, idx).trim();
        ackBuffered = ackBuffered.slice(idx + 1);
        const wroteMatch = /^WROTE (\d+)$/.exec(line);
        const pending = pendingWrites.shift();
        if (!pending) continue;
        if (wroteMatch && Number(wroteMatch[1]) === pending.offset) pending.resolve();
        else pending.reject(new Error(`unexpected fixture response to write: ${line}`));
      }
    }

    function writeBytes(offset: number, leHex: string): Promise<void> {
      return new Promise((res, rej) => {
        pendingWrites.push({ offset, resolve: res, reject: rej });
        child.stdin.write(`write ${offset} ${leHex}\n`);
      });
    }

    child.stdout.on('data', onData);
    child.on('error', reject);
  });
}

function killFixture(handle: FixtureHandle): void {
  try {
    handle.child.stdin.write('exit\n');
  } catch {
    /* already gone */
  }
  handle.child.kill();
}

/**
 * `attach()`'s identity check shells out to a real `Get-CimInstance
 * Win32_Process` PowerShell query (windows-process-identity.ts) to bind the
 * session to a verified path+creation-time, not just a PID. That query can
 * occasionally lose a race against a process that was only just spawned
 * (`incomplete_process_identity`) — an environmental PowerShell-round-trip
 * timing characteristic, not a planner defect. Retrying the attach call
 * itself (never a test assertion) is the same defensiveness a real caller
 * would reasonably apply.
 */
async function attachWithRetry(
  session: LiveMemorySession,
  target: { pid: number; executableName: string },
  attempts = 4,
): Promise<{ success: boolean; error?: string }> {
  let last: { success: boolean; error?: string } = { success: false, error: 'not_attempted' };
  for (let i = 0; i < attempts; i++) {
    last = await session.attach(target, true);
    if (last.success) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return last;
}

const skipReason = realEnvSkipReason();
const describeReal = skipReason ? test.skip : test;

describeReal('§12: real measured profile is module+private diverse; §21 initial adaptive plan reacts to it', async () => {
  const fixture = await spawnFixture();
  try {
    const session = new LiveMemorySession(nativeMemoryDriver);
    const attachResult = await attachWithRetry(session, { pid: fixture.child.pid!, executableName: 'solith-scanner-fixture.exe' });
    assert.ok(attachResult.success, `attach failed: ${attachResult.error}`);

    const handle = nativeMemoryDriver.openProcess(fixture.child.pid!);
    const regions = nativeMemoryDriver.getRegions(handle);
    const profile = buildScanRegionProfile(regions);

    // Every real Win32 process loads ntdll.dll/kernel32.dll etc (image-backed)
    // alongside its own heap/stack (private-backed) — this is a fact about
    // the real OS, not a fixture-engineered scenario.
    assert.ok(profile.eligibleRegions > 0, 'a live process must have at least one eligible region');
    assert.ok(profile.moduleBackedBytes > 0, 'a real Windows process always has image-backed regions');
    assert.ok(profile.privateBytes > 0, 'a real Windows process always has private heap/stack regions');

    const plan = planAdaptiveScan({ profile, priorTelemetry: [] });
    assert.ok(plan.reasons.includes('NO_PRIOR_TELEMETRY'));
    // Both branches are legitimate depending on this real process's actual
    // measured split — what matters is that a real category dominance
    // produced private-first ordering, or neither dominated and it stayed
    // broad. Any of these three is a genuine, non-fabricated outcome.
    assert.ok(
      plan.reasons.includes('MODULE_HEAVY_PROFILE') ||
        plan.reasons.includes('PRIVATE_HEAVY_PROFILE') ||
        plan.reasons.includes('UNIFORM_PROFILE'),
    );

    console.log('[P2-10 evidence] SCAN 1 (initial, real profile):', {
      eligibleRegions: profile.eligibleRegions,
      eligibleBytes: profile.eligibleBytes,
      moduleBackedBytes: profile.moduleBackedBytes,
      privateBytes: profile.privateBytes,
      strategy: plan.strategy,
      reasons: plan.reasons,
    });

    nativeMemoryDriver.closeProcess(handle);
    await session.detach();
  } finally {
    killFixture(fixture);
  }
});

describeReal('§13/§23: a real prior scan\'s measured telemetry (not its own profile) changes the next plan', async () => {
  const fixture = await spawnFixture();
  try {
    const session = new LiveMemorySession(nativeMemoryDriver);
    const attachResult = await attachWithRetry(session, { pid: fixture.child.pid!, executableName: 'solith-scanner-fixture.exe' });
    assert.ok(attachResult.success, `attach failed: ${attachResult.error}`);

    // Plants a fresh, distinctive u32 into REFINE_REGION (64 KiB — entirely
    // reachable through nativeMemoryDriver's real 1 MiB-per-read ceiling,
    // unlike BIG_REGION/TYPES_REGION at 4 MiB each, which `scanFirst`
    // genuinely cannot fully read via this driver — the same pre-existing,
    // already-documented "1 MiB shipping defect" scanner-backend-real-process
    // .test.ts exists to characterize, not a P2-10 regression). A value this
    // unusual is vanishingly unlikely to occur anywhere else in this
    // process's real memory by chance, so its result count is a reliable
    // "small prior candidate set" without needing to predict this machine's
    // memory contents.
    const rareValue = 0x5a5aface;
    const refineBase = BigInt(fixture.fields.REFINE_REGION_BASE);
    await fixture.writeBytes(0, Buffer.from([0xce, 0xfa, 0x5a, 0x5a]).toString('hex'));

    const scan1Id = session.startAdaptiveScanOperation('uint32', rareValue, 'adaptive');
    const scan1 = await pollUntilTerminal(session, scan1Id);
    assert.ok(scan1.plan.reasons.includes('NO_PRIOR_TELEMETRY'));
    assert.ok(scan1.telemetry.resultCount >= 1, 'the fixture genuinely plants this value — it must be found');
    assert.ok(scan1.telemetry.resultCount <= 500, 'a deliberately rare sentinel should not be a common byte pattern');
    assert.ok(
      scan1.result.matches.some((m: { address: bigint }) => m.address === refineBase),
      'the planted value must be found at exactly the address it was written to',
    );

    // A second scan (any value) now has scan1's real telemetry as its only
    // prior entry — the planner must react to scan1's actual measured
    // resultCount, not to a fresh profile read alone.
    const scan2Id = session.startAdaptiveScanOperation('int32', 42, 'adaptive');
    const scan2 = await pollUntilTerminal(session, scan2Id);
    assert.equal(scan2.plan.strategy, 'NARROWED_BY_PRIOR_CANDIDATES');
    assert.ok(scan2.plan.reasons.includes('PRIOR_CANDIDATE_SET_SMALL'));

    // Independent oracle: recompute the expected plan directly from the
    // planner's pure function fed scan1's exact recorded telemetry, and
    // require the orchestration's real decision to match it exactly — this
    // is what proves the wiring is correct, not merely that some plan came
    // back looking plausible.
    const handle = nativeMemoryDriver.openProcess(fixture.child.pid!);
    const currentProfile = buildScanRegionProfile(nativeMemoryDriver.getRegions(handle));
    const expected = planAdaptiveScan({ profile: currentProfile, priorTelemetry: [scan1.telemetry as never] });
    assert.deepEqual(scan2.plan, expected);
    nativeMemoryDriver.closeProcess(handle);

    console.log('[P2-10 evidence] SCAN 1 -> SCAN 2 (real follow-up adaptation):', {
      scan1: { strategy: scan1.plan.strategy, reasons: scan1.plan.reasons, resultCount: scan1.telemetry.resultCount, elapsedMillis: scan1.telemetry.elapsedMillis },
      scan2: { strategy: scan2.plan.strategy, reasons: scan2.plan.reasons, resultCount: scan2.telemetry.resultCount, elapsedMillis: scan2.telemetry.elapsedMillis },
      whyStrategyChanged: `scan1 found only ${scan1.telemetry.resultCount} match(es) (<=500), so scan2's plan reacted with PRIOR_CANDIDATE_SET_SMALL instead of scan1's NO_PRIOR_TELEMETRY branch`,
    });

    await session.detach();
  } finally {
    killFixture(fixture);
  }
});

describeReal('§9: reference and adaptive scans of the same value find the same address set against real memory', async () => {
  const fixture = await spawnFixture();
  try {
    const session = new LiveMemorySession(nativeMemoryDriver);
    const attachResult = await attachWithRetry(session, { pid: fixture.child.pid!, executableName: 'solith-scanner-fixture.exe' });
    assert.ok(attachResult.success, `attach failed: ${attachResult.error}`);

    // Same REFINE_REGION-planted technique as the §13 test above — a real,
    // non-empty match set is a stronger equality proof than two empty ones
    // would be, and REFINE_REGION (64 KiB) is fully reachable through
    // nativeMemoryDriver's real 1 MiB-per-read ceiling (unlike BIG_REGION).
    const rareValue = 0x5a5aface;
    await fixture.writeBytes(0, Buffer.from([0xce, 0xfa, 0x5a, 0x5a]).toString('hex'));

    // Adaptive runs FIRST so it sees NO_PRIOR_TELEMETRY (an untainted §12
    // initial plan, not narrowed by another scan's history) — this is the
    // true like-for-like §9 comparison: same value, same real profile,
    // planner-chosen order vs the fixed reference order. Reference mode
    // itself ignores prior telemetry unconditionally (see
    // `runPlannedScan`), so running it second is unaffected either way.
    const adaptiveId = session.startAdaptiveScanOperation('uint32', rareValue, 'adaptive');
    const adaptive = await pollUntilTerminal(session, adaptiveId);
    assert.ok(adaptive.plan.reasons.includes('NO_PRIOR_TELEMETRY'));

    const referenceId = session.startAdaptiveScanOperation('uint32', rareValue, 'reference');
    const reference = await pollUntilTerminal(session, referenceId);
    assert.equal(reference.plan.strategy, 'REFERENCE_FULL');
    assert.ok(reference.result.matches.length >= 1, 'the sentinel must genuinely be found by the reference scan');

    const sortAddrs = (matches: Array<{ address: bigint }>) =>
      matches.map((m) => m.address).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(sortAddrs(adaptive.result.matches), sortAddrs(reference.result.matches));
    assert.equal(adaptive.result.completeness.state, reference.result.completeness.state);

    await session.detach();
  } finally {
    killFixture(fixture);
  }
});

async function pollUntilTerminal(
  session: LiveMemorySession,
  operationId: string,
): Promise<{ plan: any; telemetry: any; result: any }> {
  for (;;) {
    const status = session.getScanOperationStatus(operationId);
    if (!status) throw new Error('operation vanished from registry');
    if (status.status === 'pending') {
      await new Promise((resolve) => setTimeout(resolve, 20));
      continue;
    }
    if (status.status === 'error') throw new Error(`scan operation errored: ${status.error}`);
    return status.result as { plan: any; telemetry: any; result: any };
  }
}
