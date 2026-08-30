import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Adaptive Wisp Phase 1 — Section 15/28 static security tests: the renderer
 * consent UI must reach the backend ONLY through the narrow
 * `window.electronAPI.wispConsent*` surface exposed by preload.ts, never by
 * importing a backend memory/process/registry/token/execution module
 * directly, and the preload bridge itself must not hand the renderer raw
 * `ipcRenderer` or an arbitrary-channel invoker.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER_FILES = ['src/app/components/WispConsentDialog.tsx', 'src/app/components/WispConsentQueue.tsx'];

const FORBIDDEN_IMPORT_FRAGMENTS = [
  'live-memory',
  'memory-manager',
  'write-consent',
  'consent/proposal-store',
  'consent/consent-service',
  'consent/audit-log',
  'adaptive-wisp/quick-slot-controller',
  'adaptive-wisp/wisp-action-executor',
  'cheat-system',
  'canonical-games',
  'core/database',
  'child_process',
  'node:child_process',
  'electron',
];

describe('Wisp consent renderer stays behind window.electronAPI (no direct backend import)', () => {
  for (const file of RENDERER_FILES) {
    test(`${file} imports nothing from a forbidden backend module`, () => {
      const contents = readFileSync(path.join(ROOT, file), 'utf8');
      const importLines = contents.split('\n').filter((line) => /^\s*import\b/.test(line));
      for (const line of importLines) {
        for (const fragment of FORBIDDEN_IMPORT_FRAGMENTS) {
          assert.ok(!line.toLowerCase().includes(fragment), `${file} imports from forbidden module fragment "${fragment}": ${line.trim()}`);
        }
      }
    });

    test(`${file} only reaches the backend through window.electronAPI.wispConsent*`, () => {
      const contents = readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(!contents.includes('ipcRenderer'), `${file} must never import ipcRenderer directly`);
    });
  }

  test('WispConsentQueue.tsx calls only the documented wispConsent* preload methods, never a raw/arbitrary channel', () => {
    const contents = readFileSync(path.join(ROOT, 'src/app/components/WispConsentQueue.tsx'), 'utf8');
    const calls = contents.match(/window\.electronAPI\.(\w+)/g) ?? [];
    const allowed = new Set([
      'window.electronAPI.wispConsentListPending',
      // Phase 2 lifecycle-evidence closeout — read-only, same bare-proposalId
      // schema as the other four calls (see the .strict()/no-extra-fields
      // test below); used only to distinguish an externally invalidated
      // proposal (real detach/reattach/process-replacement/generation-
      // change/game-switch) from the dialog's own approve/reject/cancel
      // outcome, so the dialog can close itself on the former without ever
      // unmounting the latter's own success/failure state prematurely.
      'window.electronAPI.wispConsentGet',
      'window.electronAPI.wispConsentApprove',
      'window.electronAPI.wispConsentReject',
      'window.electronAPI.wispConsentCancel',
      'window.electronAPI.onWispConsentQueueChanged',
      'window.electronAPI.onWispConsentProposalUpdated',
    ]);
    assert.ok(calls.length > 0, 'expected at least one window.electronAPI.wispConsent* call');
    for (const call of calls) {
      assert.ok(allowed.has(call), `unexpected electronAPI call "${call}" — the consent renderer must use only the documented wispConsent* surface`);
    }
  });

  test('preload.ts exposes the wisp consent methods but never a generic/arbitrary-channel invoker', () => {
    const contents = readFileSync(path.join(ROOT, 'electron/preload.ts'), 'utf8');
    assert.ok(contents.includes('wispConsentListPending'), 'expected preload.ts to expose wispConsentListPending inside exposeInMainWorld');
    assert.ok(!contents.includes('invoke: (channel'), 'preload must not expose a generic invoke(channel, ...) passthrough');
    assert.ok(!contents.includes('ipcRenderer.invoke(channel'), 'preload must not expose a renderer-controlled arbitrary IPC channel');
  });

  test('the Wisp consent IPC schema only accepts a bare proposalId (no address/value/game/action field)', () => {
    const contents = readFileSync(path.join(ROOT, 'electron/ipc-validation.ts'), 'utf8');
    const schemaBlock = contents.match(/export const WispConsentProposalIdSchema[\s\S]*?;/)?.[0] ?? '';
    assert.ok(schemaBlock.length > 0, 'expected to find WispConsentProposalIdSchema in ipc-validation.ts');
    for (const forbiddenField of ['address', 'requestedValue', 'gameId', 'actionId', 'entryId', 'value']) {
      assert.ok(!schemaBlock.toLowerCase().includes(forbiddenField.toLowerCase()), `WispConsentProposalIdSchema must never accept a renderer-supplied "${forbiddenField}" field`);
    }
    assert.ok(schemaBlock.includes('.strict()'), 'WispConsentProposalIdSchema must be .strict() so unknown fields are rejected');
  });
});
