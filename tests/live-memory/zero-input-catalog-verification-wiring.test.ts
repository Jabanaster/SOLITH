import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Mission 15 (Personal Library Completion pass) — regression coverage that
 * BOTH the normal attach flow ('live-memory-attach') and the zero-input flow
 * ('live-memory-zero-input-prepare') route through the SAME shared
 * verifyCatalogGameIdForExecutable() before trusting a renderer-supplied
 * catalogGameId, per Mission 1's fix this session.
 *
 * The five required scenarios (correct game -> PASS; missing identity,
 * renderer lies, wrong executable/cross-game, stale PID -> all FAIL CLOSED)
 * are exercised once, at the pure-function level, in
 * attach-catalog-verification.test.ts — that coverage transfers to both IPC
 * handlers BECAUSE this test proves both handlers call that exact function
 * with no second, divergent verifier. Electron's ipcMain has no lightweight
 * in-process harness in this test suite (see the project's existing
 * static-source-inspection convention in tests/trainer-library-*.test.ts),
 * so wiring is verified the same way: reading the real handler source.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

describe('zero-input-prepare and normal attach share one catalog-identity verifier (no second weaker verifier)', () => {
  const source = readSource('electron/live-memory-ipc.ts');

  test('both handlers import the same verifyCatalogGameIdForExecutable from attach-catalog-verification.ts', () => {
    assert.match(source, /import \{ verifyCatalogGameIdForExecutable \} from '\.\.\/src\/core\/live-memory\/attach-catalog-verification\.js';/);
    const occurrences = source.match(/verifyCatalogGameIdForExecutable\(/g) ?? [];
    assert.equal(occurrences.length, 2, 'expected exactly 2 call sites: live-memory-attach and live-memory-zero-input-prepare');
  });

  test('live-memory-attach calls the verifier before trusting catalogGameId for fingerprinting', () => {
    const attachHandler = source.match(/ipcMain\.handle\('live-memory-attach'[\s\S]*?(?=ipcMain\.handle\('live-memory-zero-input-prepare')/)?.[0] ?? '';
    assert.ok(attachHandler.length > 0, 'expected to find the live-memory-attach handler body');
    assert.match(attachHandler, /verifyCatalogGameIdForExecutable\(/);
    // The unverified parsed.catalogGameId must never itself reach the fingerprint object.
    assert.doesNotMatch(attachHandler, /catalogGameId: parsed\.catalogGameId/);
  });

  test('live-memory-zero-input-prepare calls the verifier and fails closed (planAllowed: false) before loading any definition', () => {
    const zeroInputHandler = source.slice(source.indexOf("ipcMain.handle('live-memory-zero-input-prepare'"));
    assert.match(zeroInputHandler, /verifyCatalogGameIdForExecutable\(/);
    assert.match(zeroInputHandler, /if \(!verifiedZeroInputCatalogGameId\)/);
    assert.match(zeroInputHandler, /planAllowed: false/);
    assert.match(zeroInputHandler, /error: 'catalog_identity_unverified'/);
    // loadCatalogDefinition must only ever be called with the VERIFIED id, never parsed.catalogGameId.
    assert.doesNotMatch(zeroInputHandler, /loadCatalogDefinition\(parsed\.catalogGameId\)/);
    assert.match(zeroInputHandler, /loadCatalogDefinition\(verifiedZeroInputCatalogGameId\)/);
  });

  test('neither handler falls back to trusting parsed.catalogGameId when verification returns undefined', () => {
    // Guards against a future edit reintroducing "?? parsed.catalogGameId" as
    // a fallback, which would silently restore the original vulnerability.
    assert.doesNotMatch(source, /verifiedCatalogGameId \?\? parsed\.catalogGameId/);
    assert.doesNotMatch(source, /verifiedZeroInputCatalogGameId \?\? parsed\.catalogGameId/);
  });
});
