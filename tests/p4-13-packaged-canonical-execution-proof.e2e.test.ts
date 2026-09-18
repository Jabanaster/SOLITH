/**
 * P4-13 — packaged real-process canonical execution proof.
 *
 * Not a source scan, not a unit test against a fake capabilities object —
 * this launches the actual packaged SOLITH executable (dist/win-unpacked,
 * built via `electron-builder --dir`) against a real spawned fixture
 * process, and drives the real renderer -> preload -> canonical execution
 * IPC -> TrainerApplicationService -> TrainerRuntime -> real LiveMemorySession
 * chain end to end: import a real canonical definition, attach, bind the
 * canonical runtime onto the same session, seed a Phase-2-discovered
 * address (P4-13's own new handoff), propose/consent/confirm a write,
 * verify it landed via an INDEPENDENT read path, roll it back, freeze it,
 * unfreeze it, and prove a fail-closed rejection before the feature is
 * seeded. Mirrors the precedent in
 * gate2-2a1-packaged-real-process-write-proof.e2e.test.ts (same
 * SOLITH_PRIVILEGED_CONSENT=auto-approve / SOLITH_TEST_BUILD=1 seam) and
 * pointer-map-ui-real-process.e2e.test.ts (same fixture-process pattern).
 */
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { existsSync } from 'node:fs';

import { findRepoRoot, resolvePackagedExecutable } from '../scripts/release-artifact-utils.mjs';

const ROOT = findRepoRoot(import.meta.url);
const EXE_PATH = resolvePackagedExecutable(ROOT);
const FIXTURE_PATH = path.join(ROOT, 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe');

function fixtureAvailable(): boolean {
  return process.platform === 'win32' && existsSync(FIXTURE_PATH) && existsSync(EXE_PATH);
}

interface FixtureHandle {
  child: ChildProcessWithoutNullStreams;
  fields: Record<string, string>;
}

function spawnFixture(): Promise<FixtureHandle> {
  const child = spawn(FIXTURE_PATH, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.stdin.on('error', () => {});
  return new Promise((resolve, reject) => {
    let buffered = '';
    const fields: Record<string, string> = {};
    function onData(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (line === 'READY') {
          child.stdout.off('data', onData);
          resolve({ child, fields });
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

function killFixture(handle: FixtureHandle | undefined): void {
  if (!handle) return;
  try { handle.child.stdin.write('exit\n'); } catch { /* already gone */ }
  handle.child.kill();
}

const FIXTURE_EXECUTABLE_NAME = 'solith-scanner-fixture.exe';
const CATALOG_ID = 'p4-13-e2e-fixture-proof';
const FEATURE_ID = 'struct-mutable-i32';
// STRUCT_MUTABLE_I32_OFFSET in native/solith-scanner-core/src/bin/fixture.rs — a real,
// writable int32 inside the fixture's VirtualAlloc'd STRUCT_REGION. VirtualAlloc'd memory
// has no fixed relationship to the module base, so this is (correctly) NOT expressible as
// a static baseOffset feature — it is scan_unknown/discovery-required, exactly like every
// real curated GameConfig cheat post-P4-13, and its address is handed to the runtime via
// the new canonical discovery-seed handoff below, not fabricated.
const STRUCT_MUTABLE_I32_OFFSET = 0x18;

function yamlFor(): string {
  return [
    'schemaVersion: 1',
    `id: ${CATALOG_ID}`,
    'title: P4-13 E2E Fixture Proof',
    "gameVersion: '*'",
    'executableHashPrefixes: []',
    'author: p4-13-e2e-test',
    '',
    'safety:',
    '  requiresApproval: true',
    '  requiresOfflineConfirm: true',
    '  verificationStatus: community',
    '',
    'target:',
    '  executables:',
    `    - ${FIXTURE_EXECUTABLE_NAME}`,
    '  arch: x64',
    '',
    'memoryFeatures:',
    `  - id: ${FEATURE_ID}`,
    '    name: Struct Mutable I32',
    '    category: test',
    '    type: scan_unknown',
    '    dataType: int32',
    '    defaultValue: 0',
    '    resolution:',
    `      moduleName: ${FIXTURE_EXECUTABLE_NAME}`,
    '',
  ].join('\n');
}

const describeReal = fixtureAvailable() ? test : test.skip;

describeReal('P4-13 packaged real-process canonical execution proof', async () => {
  test.setTimeout(120_000);
  expect(existsSync(EXE_PATH), `packaged exe not found at ${EXE_PATH} — run "npm run dist:dir" first`).toBe(true);
  expect(existsSync(FIXTURE_PATH), `fixture exe not found at ${FIXTURE_PATH} — build native/solith-scanner-core in release mode first`).toBe(true);

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userDataDir = path.join(os.tmpdir(), `solith-p413-userdata-${runId}`);
  const appDataDir = path.join(os.tmpdir(), `solith-p413-appdata-${runId}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  let fixture: FixtureHandle | undefined;
  let electronApp: ElectronApplication | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  try {
    fixture = await spawnFixture();
    // The fixture exits after 30s of stdin silence (its own bounded-hang-safe
    // guard — see fixture.rs). This test doesn't send its first real stdin
    // command (writestruct, step 11) until well past that, so without a
    // keepalive the fixture would exit mid-test on its own timeout, not on
    // anything this test is actually proving. An UNKNOWN_CMD reply is
    // harmless and still resets the fixture's own timeout.
    keepalive = setInterval(() => {
      try { fixture?.child.stdin.write('ping\n'); } catch { /* fixture already gone */ }
    }, 5_000);
    const structBase = BigInt(fixture.fields.STRUCT_REGION_BASE);
    const targetAddress = structBase + BigInt(STRUCT_MUTABLE_I32_OFFSET);
    const targetHex = `0x${targetAddress.toString(16)}`;

    electronApp = await electron.launch({
      executablePath: EXE_PATH,
      env: {
        ...process.env,
        ELECTRON_USER_DATA_PATH: userDataDir,
        APPDATA: appDataDir,
        USERPROFILE: appDataDir,
        NODE_ENV: 'test',
        SOLITH_PRIVILEGED_CONSENT: 'auto-approve',
        SOLITH_TEST_BUILD: '1',
      },
    });

    const win: Page = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#root > *', { timeout: 20_000 });

    // 1. Import a real canonical SolithDefinitionV1 through the same production
    // IPC DiscoveryLab's "Add to Library" button uses — a real persisted
    // trainer_mod_packs row, not a fabricated in-memory object.
    const importResult = await win.evaluate(
      async (yamlText: string) => (window as any).electronAPI.trainerCatalogImportYaml({ yamlText }),
      yamlFor(),
    );
    expect(importResult?.success, `canonical definition import failed: ${JSON.stringify(importResult)}`).toBe(true);
    expect(importResult.catalogGameId).toBe(CATALOG_ID);

    // 2. Attach to the real fixture process (Phase 2, unchanged by P4-13).
    const attachResult = await win.evaluate(
      async (args: [number, string]) => (window as any).electronAPI.liveMemoryAttach({
        pid: args[0], executableName: args[1], userConfirmedOffline: true,
      }),
      [fixture.child.pid!, FIXTURE_EXECUTABLE_NAME],
    );
    expect(attachResult?.error, `attach failed: ${JSON.stringify(attachResult)}`).toBeUndefined();

    // 3. Canonical bind onto the SAME already-attached session (P4-10/P4-13 — no second attach).
    const bindResult = await win.evaluate(
      async (args: [string, number, string]) => (window as any).electronAPI.trainerBindRuntime({
        catalogGameId: args[0], pid: args[1], executableName: args[2],
      }),
      [CATALOG_ID, fixture.child.pid!, FIXTURE_EXECUTABLE_NAME],
    );
    expect(bindResult?.success, `trainerBindRuntime failed: ${JSON.stringify(bindResult)}`).toBe(true);

    // 4. No silent fallback / fail-closed proof: before seeding, this
    // scan_unknown feature must be REJECTED, not silently written somewhere.
    const proposeBeforeSeed = await win.evaluate(
      async (featureId: string) => (window as any).electronAPI.trainerProposeWriteFeature({ featureId, requestedValue: 1 }),
      FEATURE_ID,
    );
    expect(proposeBeforeSeed?.success, 'an unseeded discovery-required feature must be rejected, not silently accepted').toBe(false);
    expect(proposeBeforeSeed?.error?.reason).toBe('TARGET_RESOLUTION_FAILED');

    // 5. Independent baseline read (legacy liveMemoryRead — a different code
    // path than the canonical write/read chain under test) before any write.
    const baselineRead = await win.evaluate(
      async (address: string) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
      targetHex,
    );
    expect(baselineRead?.value, `baseline read failed: ${JSON.stringify(baselineRead)}`).toBeDefined();
    const baselineValue: number = baselineRead.value;

    // 6. Canonical discovery-resolution handoff (P4-13's new mechanism) — hands
    // the runtime the address this "session's discovery" (the fixture's own
    // real, live-process address) confirmed.
    const seedResult = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.trainerSeedDiscoveredFeature({
        featureId: args[0], address: args[1], dataType: 'int32',
      }),
      [FEATURE_ID, targetHex],
    );
    expect(seedResult?.success, `trainerSeedDiscoveredFeature failed: ${JSON.stringify(seedResult)}`).toBe(true);

    // 7. Real propose -> issue-consent (auto-approved) -> confirm write.
    const proposeResult = await win.evaluate(
      async (featureId: string) => (window as any).electronAPI.trainerProposeWriteFeature({ featureId, requestedValue: 424242 }),
      FEATURE_ID,
    );
    expect(proposeResult?.success, `propose failed: ${JSON.stringify(proposeResult)}`).toBe(true);
    const proposalId: string = proposeResult.value.proposalId;

    const consentResult = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.trainerIssueWriteConsent({ featureId: args[0], proposalId: args[1] }),
      [FEATURE_ID, proposalId],
    );
    expect(consentResult?.success, `issue-consent failed: ${JSON.stringify(consentResult)}`).toBe(true);
    const consentToken: string = consentResult.value.consentToken;

    const confirmResult = await win.evaluate(
      async (args: [string, string, string]) => (window as any).electronAPI.trainerConfirmWriteFeature({
        featureId: args[0], proposalId: args[1], consentToken: args[2],
      }),
      [FEATURE_ID, proposalId, consentToken],
    );
    expect(confirmResult?.success, `confirm failed: ${JSON.stringify(confirmResult)}`).toBe(true);

    // 8. GROUND TRUTH: verify the write landed via an INDEPENDENT read path
    // (legacy liveMemoryRead), not just trusting the canonical layer's own report.
    const afterWriteRead = await win.evaluate(
      async (address: string) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
      targetHex,
    );
    expect(afterWriteRead?.value, 'independent read-back must observe the real canonical write').toBe(424242);

    // 9. Rollback through the canonical runtime — real value restoration, not
    // just forgetting local UI state (the P4-13 fix to the legacy no-op).
    const rollbackResult = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.trainerRollbackFeature({ featureId: args[0], proposalId: args[1] }),
      [FEATURE_ID, proposalId],
    );
    expect(rollbackResult?.success, `rollback failed: ${JSON.stringify(rollbackResult)}`).toBe(true);

    const afterRollbackRead = await win.evaluate(
      async (address: string) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
      targetHex,
    );
    expect(afterRollbackRead?.value, 'independent read-back must observe the real rollback').toBe(baselineValue);

    // 10. Freeze through the canonical runtime.
    const freezeProposeResult = await win.evaluate(
      async (featureId: string) => (window as any).electronAPI.trainerProposeFreezeFeature({ featureId, value: 999999, intervalMs: 100 }),
      FEATURE_ID,
    );
    expect(freezeProposeResult?.success, `freeze propose failed: ${JSON.stringify(freezeProposeResult)}`).toBe(true);
    const freezeProposalId: string = freezeProposeResult.value.proposalId;

    const freezeConsentResult = await win.evaluate(
      async (args: [string, string]) => (window as any).electronAPI.trainerIssueFreezeConsent({ featureId: args[0], proposalId: args[1] }),
      [FEATURE_ID, freezeProposalId],
    );
    expect(freezeConsentResult?.success, `freeze issue-consent failed: ${JSON.stringify(freezeConsentResult)}`).toBe(true);
    const freezeConsentToken: string = freezeConsentResult.value.consentToken;

    const freezeConfirmResult = await win.evaluate(
      async (args: [string, string, string]) => (window as any).electronAPI.trainerConfirmFreezeFeature({
        featureId: args[0], proposalId: args[1], consentToken: args[2],
      }),
      [FEATURE_ID, freezeProposalId, freezeConsentToken],
    );
    expect(freezeConfirmResult?.success, `freeze confirm failed: ${JSON.stringify(freezeConfirmResult)}`).toBe(true);

    // 11. Overwrite the frozen value out-of-band via the fixture's own
    // writestruct command; the freeze scheduler must re-assert it. Polled
    // (not a single fixed-delay check) — the 100ms freeze tick interval is a
    // soft target under real IPC/Electron scheduling overhead, not a hard
    // real-time guarantee.
    fixture.child.stdin.write(`writestruct ${STRUCT_MUTABLE_I32_OFFSET} 00000000\n`);
    let reasserted = false;
    let lastDuringFreezeValue: number | undefined;
    for (let attempt = 0; attempt < 10 && !reasserted; attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      const duringFreezeRead = await win.evaluate(
        async (address: string) => (window as any).electronAPI.liveMemoryRead({ address, dataType: 'int32' }),
        targetHex,
      );
      lastDuringFreezeValue = duringFreezeRead?.value;
      if (lastDuringFreezeValue === 999999) reasserted = true;
    }
    expect(reasserted, `the canonical freeze scheduler must re-assert the frozen value — last observed ${lastDuringFreezeValue}`).toBe(true);

    // 12. Stop the freeze through the canonical runtime.
    const deactivateResult = await win.evaluate(
      async (featureId: string) => (window as any).electronAPI.trainerDeactivateFeature({ featureId }),
      FEATURE_ID,
    );
    expect(deactivateResult?.success, `deactivate failed: ${JSON.stringify(deactivateResult)}`).toBe(true);

    // 13. Runtime state reaches the renderer.
    const runtimeState = await win.evaluate(async () => (window as any).electronAPI.trainerGetRuntimeState());
    expect(runtimeState?.success, `get-runtime-state failed: ${JSON.stringify(runtimeState)}`).toBe(true);
    expect(['READY', 'ACTIVE', 'BOUND']).toContain(runtimeState.value.state);

    await win.evaluate(async () => (window as any).electronAPI.trainerUnbindRuntime());
    await win.evaluate(async () => (window as any).electronAPI.liveMemoryDetach());
  } finally {
    if (keepalive) clearInterval(keepalive);
    await electronApp?.close().catch(() => {});
    killFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});
