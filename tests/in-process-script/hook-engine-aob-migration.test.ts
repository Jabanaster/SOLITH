// Phase 1 / Stage 7.4 §8 — `installHookFromProposal` no longer resolves its
// own hook-site AOB scan (that moved to the `in-process-confirm-hook` IPC
// handler, routed through `LiveMemorySession.scanAobViaBackend`); this
// function now requires the caller to supply an already-resolved `hookSite`.
// The actual code-cave allocation and process writes (`native-bridge.ts`)
// require a real Windows process handle via the `memoryjs` native module —
// the same category of dependency as the real-game canaries — so they are
// not exercised by this pure unit test. What IS verified here, deterministically
// and without any native dependency, is the part of the contract this stage
// actually changed: the function no longer performs its own scan (there is
// no `driver`/`handle` region data backing an AOB match in this test at
// all — if it tried to scan, every one of these calls would behave
// differently or throw), and its pre-existing validation (unknown proposal,
// non-executable plan) is unchanged.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAaScript } from '../../src/core/script-research/aa-script-analyzer.ts';
import { planHookFromScriptAnalysis } from '../../src/core/in-process-script/aa-hook-planner.ts';
import {
  clearHookProposals,
  getHookProposal,
  installHookFromProposal,
  proposeHookInstall,
} from '../../src/core/in-process-script/hook-engine.ts';
import type { LiveProcessHandle, MemoryDriver } from '../../src/core/live-memory/types.ts';

const FRIENDSHIP_SCRIPT = `
aobscanmodule(INJECT_FAST_FRIENDSHIP,$process,74 ?? ?? 8B ?? 20 E8 ?? ?? ?? ?? 3C FE 7E ??)
alloc(newmem,$1000)
code:
  cmp qword ptr [rax+20], 64
  mov qword ptr [rax+20], 64
registersymbol(INJECT_FAST_FRIENDSHIP)
`;

const SCAN_ONLY_METHODS = ['getRegions', 'getModules'] as const;

/**
 * A driver that throws only on the methods `scanAobInProcess` needs
 * (`getRegions`/`getModules` — see aob-resolver.ts) — proving no AOB scan
 * happened inside `installHookFromProposal` itself. `readBuffer` is legitimate
 * and unaffected by this migration (reading the original bytes at the
 * already-resolved hook site, for later rollback), so it is allowed and
 * returns a zero-filled buffer of the requested size.
 */
function makeScanForbiddingDriver(): MemoryDriver {
  const fail = (name: string) => () => {
    throw new Error(`installHookFromProposal must not call driver.${name}() — the AOB lookup is the caller's job now.`);
  };
  const forbidden = Object.fromEntries(SCAN_ONLY_METHODS.map((name) => [name, fail(name)]));
  return {
    ...forbidden,
    readBuffer: (_handle: LiveProcessHandle, _address: bigint, size: number) => Buffer.alloc(size),
  } as unknown as MemoryDriver;
}

const FAKE_HANDLE = { pid: 4242, opaque: {} } as unknown as LiveProcessHandle;

describe('hook-engine AOB caller migration (Stage 7.4 §8)', () => {
  test('installHookFromProposal rejects an unknown proposal without touching the driver', () => {
    clearHookProposals();
    assert.throws(
      () =>
        installHookFromProposal({
          sessionKey: 'test-session',
          proposalId: 'does-not-exist',
          driver: makeScanForbiddingDriver(),
          handle: FAKE_HANDLE,
          hookSite: 0x1000n,
        }),
      /Unknown hook proposal/,
    );
  });

  test('installHookFromProposal rejects a non-executable plan without touching the driver', () => {
    clearHookProposals();
    // A plan with no executablePlan/presetId — proposeHookInstall accepts any HookInstallPlan shape.
    const proposal = proposeHookInstall({
      status: 'ready',
      executablePlan: false,
      presetId: undefined,
      aobSignature: '00 11 22 33',
      moduleName: 'Demo.exe',
      patchByteCount: 4,
    } as any);
    assert.throws(
      () =>
        installHookFromProposal({
          sessionKey: 'test-session',
          proposalId: proposal.proposalId,
          driver: makeScanForbiddingDriver(),
          handle: FAKE_HANDLE,
          hookSite: 0x1000n,
        }),
      /Hook plan is not executable/,
    );
  });

  test('installHookFromProposal uses the caller-supplied hookSite, never its own scan', () => {
    clearHookProposals();
    const analysis = analyzeAaScript('Fast friendship', FRIENDSHIP_SCRIPT, 'CrimsonDesert.exe')!;
    const plan = planHookFromScriptAnalysis(analysis, 'CrimsonDesert.exe');
    assert.equal(plan.status, 'ready');
    const proposal = proposeHookInstall(plan);
    assert.ok(getHookProposal(proposal.proposalId), 'proposal must be retrievable by the IPC handler before install');

    // `getRegions`/`getModules` throw if touched (proving no AOB scan
    // happens here); `readBuffer` is allowed (legitimate original-bytes
    // read at the given hookSite). Execution proceeds past that into
    // `allocateCodeCave`/`native-bridge.ts`, which requires a real
    // memoryjs-backed process handle and genuinely fails outside one — that
    // failure, not a "driver.getRegions()" one, is the expected outcome
    // here, confirming the scan step was skipped and hookSite was used
    // directly.
    assert.throws(
      () =>
        installHookFromProposal({
          sessionKey: 'test-session',
          proposalId: proposal.proposalId,
          driver: makeScanForbiddingDriver(),
          handle: FAKE_HANDLE,
          hookSite: 0x140001000n,
        }),
      (err: unknown) => err instanceof Error && !err.message.includes('installHookFromProposal must not call'),
    );
  });
});
