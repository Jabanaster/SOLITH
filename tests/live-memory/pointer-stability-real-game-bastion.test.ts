/**
 * Phase 2 P2-4.1 (mission §2-4) — real shipped-game restart-stability
 * campaign. Closes the P2-4 real-game evidence gap recorded honestly as
 * NOT_COMPLETE in Docs/phase2/018: two real attach-only probes against
 * Godlike Burger and Bastion succeeded, but no candidate ground truth
 * narrowed enough (screen-resolution and own-PID exact scans both hit the
 * scanner's 10,000-match cap) to run an actual restart-stability
 * classification against either title.
 *
 * This test uses a DIFFERENT, allowed ground-truth category from the
 * mission's list — "a deterministic static object with independent
 * verification" / "process-owned data with repeatable semantic identity" —
 * instead of chasing a noisy runtime heap value:
 *
 * Bastion.exe is a 32-bit XNA/.NET title. Its own `.text` section (parsed
 * directly from the on-disk PE file, independently of any running process —
 * see pe-static-string-finder.mjs) contains the CLR's string-heap metadata,
 * including the two adjacent NUL-terminated strings "Bastion" and
 * "Graphics" at file offset 1342404 / RVA 1350084. This is real,
 * process-owned, static program data — not a heap value, not "resolved
 * therefore stable" circular reasoning. Ground truth here is verified two
 * independent ways: (1) parsing the EXE file directly on disk with no
 * running process at all, and (2) reading the corresponding
 * moduleBase+RVA address in an attached, real, running instance and
 * confirming an exact byte match — done once as a sanity probe
 * (real-game-static-rva-verify.mjs) before writing this test, which
 * confirmed the runtime bytes match the file bytes exactly.
 *
 * Because this is a module-relative address with zero pointer
 * dereferences (`offsets: []` — resolvePointerPath simply returns
 * `moduleBase + moduleOffset`), it is stable by construction against
 * heap/GC relocation; what this campaign actually exercises end-to-end,
 * against a genuine unmodified third-party binary across real process
 * restarts, is: real attach, real module enumeration, the real
 * PointerMapNode/stability-baseline/classification pipeline
 * (pointerMapAddNode -> pointerMapValidateNodeAfterRestart), and the real
 * ground-truth verification contract (mission §4: independently known
 * expected value, never "resolved == stable").
 *
 * Module relocation itself (OLD MODULE BASE != CURRENT MODULE BASE) is
 * separately, rigorously proven against the fixture in
 * pointer-stability-module-relocation.test.ts; this real-game campaign is
 * not required to also reproduce relocation (Bastion.exe, like many older
 * XNA titles, is linked without /DYNAMICBASE, so its own module base does
 * not vary across launches on this machine — a real, observed fact, not a
 * limitation of the test).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

import { nativeMemoryDriver } from '../../src/core/live-memory/native-memory-driver.ts';
import { resetForTesting } from '../../src/core/database/index.ts';
import type { PointerPathCandidate } from '../../src/core/live-memory/pointer-scanner.ts';

const BASTION_EXE = 'D:/SteamLibrary/steamapps/common/Bastion/Bastion.exe';
const BASTION_EXE_NAME = 'Bastion.exe';

// Parsed directly from the on-disk PE file (pe-static-string-finder.mjs),
// independently of any running process. See file-header comment above.
const STATIC_STRING_RVA = 1350084;
// Little-endian u32 of the first 4 bytes of the NUL-terminated ASCII string
// "Bastion" ('B'=0x42 'a'=0x61 's'=0x73 't'=0x74) living at that RVA.
const STATIC_STRING_GROUND_TRUTH_U32 = 0x74736142;

const REAL_GAME_RESTART_COUNT = 5;
const LAUNCH_SETTLE_MS = 12_000;
const ATTACH_RETRY_MS = 500;
const ATTACH_MAX_ATTEMPTS = 10;
const PROCESS_EXIT_POLL_MS = 500;
const PROCESS_EXIT_MAX_WAIT_MS = 15_000;

function bastionAvailable(): boolean {
  return process.platform === 'win32' && existsSync(BASTION_EXE);
}

function findRunningPid(exeName: string): number | null {
  const output = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  const match = output.match(/"([^"]+)","(\d+)"/);
  return match ? Number(match[2]) : null;
}

async function waitForProcessExit(pid: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < PROCESS_EXIT_MAX_WAIT_MS) {
    try {
      process.kill(pid, 0);
    } catch {
      return; // ESRCH — process is gone.
    }
    await new Promise((resolve) => setTimeout(resolve, PROCESS_EXIT_POLL_MS));
  }
}

interface RunRecord {
  run: number;
  pid: number;
  moduleBase: string;
  targetAddress: string;
  status: string;
  correct: boolean;
  durationMs: number;
}

const describeReal = bastionAvailable() ? test : test.skip;

describeReal(
  'P2-4.1 real-game restart-stability campaign — Bastion.exe, 5 real restarts, static process-owned ground truth',
  { timeout: 180_000 },
  async () => {
    await resetForTesting();
    const { LiveMemorySession } = await import('../../src/core/live-memory/live-memory-session.ts');

    const candidate: PointerPathCandidate = {
      moduleName: BASTION_EXE_NAME,
      moduleOffset: STATIC_STRING_RVA,
      offsets: [],
      depth: 0,
    };

    const records: RunRecord[] = [];
    let mapId: string | null = null;
    let nodeId: string | null = null;
    let previousPid: number | null = null;

    for (let run = 1; run <= REAL_GAME_RESTART_COUNT; run++) {
      const runStart = Date.now();

      // Launch a genuinely new process instance every run — never reuse a
      // handle across "restarts", or this would not be testing restart
      // stability at all.
      const launcher = spawn(BASTION_EXE, [], { detached: true, stdio: 'ignore' });
      launcher.unref();
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_SETTLE_MS));

      const pid = findRunningPid(BASTION_EXE_NAME);
      assert.ok(pid, `run ${run}: a real Bastion.exe process must be found via tasklist`);
      assert.notEqual(pid, previousPid, `run ${run}: must be a genuinely new process instance, not a stale PID`);
      previousPid = pid;

      const session = new LiveMemorySession(nativeMemoryDriver);
      let attachResult: Awaited<ReturnType<typeof session.attach>> | undefined;
      for (let attempt = 0; attempt < ATTACH_MAX_ATTEMPTS; attempt++) {
        attachResult = await session.attach({ pid: pid!, executableName: BASTION_EXE_NAME }, true);
        if (attachResult.success) break;
        await new Promise((resolve) => setTimeout(resolve, ATTACH_RETRY_MS));
      }
      assert.equal(attachResult!.success, true, `run ${run}: real attach to Bastion.exe must succeed: ${JSON.stringify(attachResult)}`);

      try {
        if (run === 1) {
          const map = session.pointerMapCreate('P2-4.1 Real-Game Restart Campaign (Bastion.exe)');
          mapId = map.id;
          const node = session.pointerMapAddNode(mapId, 'Static metadata string RVA', candidate);
          nodeId = node.id;
        } else {
          // Each restart gets a genuinely fresh LiveMemorySession (mirroring a
          // real relaunch of the app, not a long-lived in-memory map) — carry
          // the map across restarts the same way the production UI does: the
          // real save/load round trip, never a shared in-process reference.
          const loadedMap = session.pointerMapLoad(mapId!);
          nodeId = loadedMap.nodes.find((n) => n.path.moduleName === candidate.moduleName && n.path.moduleOffset === candidate.moduleOffset)!.id;
        }

        const result = session.pointerMapValidateNodeAfterRestart(mapId!, nodeId!, {
          kind: 'u32',
          expected: STATIC_STRING_GROUND_TRUTH_U32,
          description:
            "First 4 bytes of the static NUL-terminated ASCII string 'Bastion' embedded in Bastion.exe's own .text section metadata (file offset 1342404, RVA 1350084), read little-endian — verified independently via static PE-file parsing, not via runtime resolution.",
        });

        const saveResult = session.pointerMapSave(mapId!);
        assert.deepEqual(saveResult, { ok: true }, `run ${run}: real pointer-map save must succeed so the next restart can load the updated baseline`);

        const { driver, handle } = session.getMemoryAccess()!;
        const modules = driver.getModules(handle);
        const mod = modules.find((m) => m.name.toLowerCase() === BASTION_EXE_NAME.toLowerCase())!;
        const targetAddress = mod.baseAddress + BigInt(STATIC_STRING_RVA);

        records.push({
          run,
          pid: pid!,
          moduleBase: `0x${mod.baseAddress.toString(16)}`,
          targetAddress: `0x${targetAddress.toString(16)}`,
          status: result.observation.status,
          correct: result.observation.status === 'stable_exact' || result.observation.status === 'stable_relocated',
          durationMs: Date.now() - runStart,
        });
      } finally {
        try {
          process.kill(pid!, 'SIGKILL');
        } catch {
          /* already gone */
        }
        await waitForProcessExit(pid!);
      }
    }

    console.log('=== P2-4.1 real-game restart campaign: Bastion.exe ===');
    console.table(records);

    assert.equal(records.length, REAL_GAME_RESTART_COUNT, 'every scheduled restart must produce a recorded run, no skipped failed runs');
    for (const record of records) {
      assert.ok(
        record.correct,
        `run ${record.run}: classification must be stable_exact or stable_relocated, got ${record.status} (pid ${record.pid})`,
      );
    }

    const stableCount = records.filter((r) => r.correct).length;
    assert.ok(stableCount > 0, 'REAL-GAME RESTART EVIDENCE must be > 0 — no 0/0 certification');
  },
);
