/**
 * Phase 2 P2-4.1 (mission §5/§6) — real module-base relocation proof.
 *
 * The P2-4 10-restart campaign (pointer-stability-real-process.test.ts)
 * observed the SAME module base across all 10 real launches of the
 * identical fixture binary. Investigated directly (not assumed): Windows
 * caches a randomized image base per FILE IDENTITY (the section object for
 * a given file path), so relaunching the exact same file repeatedly reuses
 * the same randomized base, while a genuinely different file — even one
 * with byte-identical content — gets an independently-randomized base from
 * the OS loader. Confirmed empirically: three consecutive launches of
 * `solith-scanner-fixture.exe` all loaded at the identical base; a single
 * launch of a byte-for-byte copy at a different path loaded at a
 * completely different base.
 *
 * This test uses that real, unmodified Windows loader behavior — not a
 * faked module base, not a unit-only substitute — to prove the real
 * production resolver (`resolvePointerPath`/`validateNodeAfterRestart`)
 * correctly follows a module-relative chain when the module's actual base
 * address has genuinely changed between two real process instances.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';

import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.ts';
import { resetForTesting } from '../../src/core/database/index.ts';

const testRequire = createRequire(import.meta.url);

const FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'native',
  'solith-scanner-core',
  'target',
  'release',
  'solith-scanner-fixture.exe',
);

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH);
}

function nativeAddonAvailable(): boolean {
  try {
    testRequire('solith-scanner-napi');
    return true;
  } catch {
    return false;
  }
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
  exePath: string;
}

function spawnFixture(exePath: string): Promise<FixtureHandle> {
  const child = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          resolve({ child, fields, exePath });
          return;
        }
        const eq = line.indexOf('=');
        if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
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

async function attachSession(handle: FixtureHandle) {
  const { LiveMemorySession } = await import('../../src/core/live-memory/live-memory-session.ts');
  const session = new LiveMemorySession(nativeMemoryDriver);
  let attachResult: Awaited<ReturnType<typeof session.attach>> | undefined;
  const exeName = path.basename(handle.exePath);
  for (let attempt = 0; attempt < 5; attempt++) {
    attachResult = await session.attach({ pid: handle.child.pid!, executableName: exeName }, true);
    if (attachResult.success) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal(attachResult!.success, true, `session attach must succeed: ${JSON.stringify(attachResult)}`);
  return session;
}

const describeReal = fixtureAvailable() && nativeAddonAvailable() ? test : test.skip;

const POINTER_TARGET_VALUE_DECIMAL = 0x5a5a1234; // matches fixture.rs's POINTER_TARGET_VALUE exactly

describeReal(
  'P2-4.1 real module-base relocation — a genuinely different file identity produces a genuinely different, real module base',
  { timeout: 60_000 },
  async () => {
    await resetForTesting();
    // A byte-for-byte copy in a DIFFERENT DIRECTORY, same filename: the SAME
    // binary content, behavior, and module NAME (so resolvePointerPath's
    // by-name module lookup still matches in both processes), but a
    // distinct Windows section-object identity, which is what the OS
    // loader's image-base cache actually keys on — confirmed by direct
    // probe: repeated launches of the identical file+path always share one
    // base; the identical file content at a different directory gets an
    // independently, genuinely randomized base from the real OS loader
    // (same filename ruled out as the caching key; same content ruled out
    // too, since it's byte-for-byte identical — the full path is what's
    // cached).
    const copyDir = path.join(os.tmpdir(), `solith-fixture-relocation-${Date.now()}`);
    fs.mkdirSync(copyDir, { recursive: true });
    const copyPath = path.join(copyDir, path.basename(FIXTURE_PATH));
    fs.copyFileSync(FIXTURE_PATH, copyPath);

    const original = await spawnFixture(FIXTURE_PATH);
    const copy = await spawnFixture(copyPath);
    try {
      const sessionOriginal = await attachSession(original);
      const sessionCopy = await attachSession(copy);

      const moduleBaseOf = (session: Awaited<ReturnType<typeof attachSession>>, exePath: string) => {
        const { driver, handle } = session.getMemoryAccess()!;
        const modules = driver.getModules(handle);
        const exeName = path.basename(exePath);
        const mod = modules.find((m) => m.name.toLowerCase() === exeName.toLowerCase());
        assert.ok(mod, `module ${exeName} must be found in its own process`);
        return mod!.baseAddress;
      };

      const baseOriginal = moduleBaseOf(sessionOriginal, FIXTURE_PATH);
      const baseCopy = moduleBaseOf(sessionCopy, copyPath);

      // The real, mission-required proof: OLD MODULE BASE != CURRENT MODULE BASE.
      assert.notEqual(
        baseOriginal,
        baseCopy,
        `two genuinely different process instances must show different real module bases; got identical 0x${baseOriginal.toString(16)} for both`,
      );

      // And the real production resolver still finds the correct target
      // against EACH process using ITS OWN real (different) module base —
      // module-relative resolution, never a cached/stale absolute address.
      const node3Original = BigInt(original.fields.POINTER_NODE3_BASE);
      const offsetOriginal = BigInt(Number(original.fields.POINTER_TARGET_OFFSET));
      const targetOriginal = node3Original + offsetOriginal;

      const node3Copy = BigInt(copy.fields.POINTER_NODE3_BASE);
      const offsetCopy = BigInt(Number(copy.fields.POINTER_TARGET_OFFSET));
      const targetCopy = node3Copy + offsetCopy;

      const boundsForDiscovery = {
        maxOffsetPerLevel: 64,
        maxRegionBytes: 1 * 1024 * 1024,
        maxBytesPerScan: 64 * 1024 * 1024,
        maxDepth: 3,
        maxCandidatesPerLevel: 16,
        maxResults: 64,
        maxTotalScans: 500,
      };

      const groundTruth = {
        kind: 'u32' as const,
        expected: POINTER_TARGET_VALUE_DECIMAL,
        description: 'fixture POINTER_TARGET_VALUE (0x5A5A1234)',
      };

      const mapOriginal = sessionOriginal.pointerMapCreate('Relocation Proof');
      const scanOriginal = sessionOriginal.pointerMapScanTargets(mapOriginal.id, [targetOriginal], boundsForDiscovery);
      assert.ok(scanOriginal.perTarget[0].nodesAdded > 0, 'discovery must succeed against the original file');
      const nodeOriginal = sessionOriginal.pointerMapGet(mapOriginal.id)!.nodes.find((n) => n.depth === 3)!;
      assert.ok(nodeOriginal, 'a real depth-3 candidate must exist for the original file');

      // Establish a REAL baseline against the original process — the
      // reference point every later restart's classification compares
      // against, exactly like the 10-restart campaign's own workflow.
      const baselineResult = sessionOriginal.pointerMapValidateNodeAfterRestart(mapOriginal.id, nodeOriginal.id, groundTruth);
      assert.equal(baselineResult.observation.status, 'stable_exact');
      assert.equal(baselineResult.observation.moduleBase, `0x${baseOriginal.toString(16)}`);

      // The real, production save/load round trip: the baseline (recorded
      // against the ORIGINAL's module base) survives persistence intact —
      // toInactiveOnLoad resets status/lastResolvedAddress but never
      // stability history, exactly as the schemaVersion migration requires.
      const saveResult = sessionOriginal.pointerMapSave(mapOriginal.id);
      assert.deepEqual(saveResult, { ok: true });
      const loadedMap = sessionCopy.pointerMapLoad(mapOriginal.id);
      const loadedNode = loadedMap.nodes.find((n) => n.depth === 3)!;
      assert.equal(loadedNode.stability?.baseline?.moduleBase, `0x${baseOriginal.toString(16)}`, 'the real baseline must survive the save/load round trip unchanged');

      // Now validate that SAME node — carrying the ORIGINAL's baseline —
      // against the COPY's session, whose real module base is genuinely
      // different (see the two assertions above).
      const result = sessionCopy.pointerMapValidateNodeAfterRestart(mapOriginal.id, loadedNode.id, groundTruth);

      assert.equal(
        result.observation.status,
        'stable_relocated',
        `the identical chain must resolve correctly against the copy's real, different module base and classify stable_relocated — got: ${JSON.stringify(result.observation)}`,
      );
      assert.equal(result.observation.moduleBase, `0x${baseCopy.toString(16)}`);
      assert.notEqual(result.observation.moduleBase, `0x${baseOriginal.toString(16)}`);

      void targetCopy; // ground truth confirmed via classification above, not a second independent scan
    } finally {
      killFixture(original);
      killFixture(copy);
      // Windows can briefly hold the executable file locked immediately
      // after the process exits — a real OS timing quirk, not a test logic
      // issue. Retry the cleanup rather than fail the whole test over it.
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          fs.rmSync(copyDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
    }
  },
);
