// Phase 1 / Stage 7.4 §14 — closes what mission §14 explicitly requires be
// closed for real (not synthetic-stub) evidence, and honestly leaves open
// what genuinely cannot be safely reproduced in this environment. Doc
// 104's baseline: 4 gaps remained, all requiring either a real corrupted
// native artifact or real OS-level access denial, neither set up before
// this pass.
//
// REAL vs DETERMINISTIC_INJECTION (mission's own required distinction):
// - "Missing addon" and "corrupt/load-failure addon" below are REAL: they
//   make the actual `require('solith-scanner-napi')` call fail for real,
//   via `node:module`'s `registerHooks()` (a real, supported Node module
//   resolution override — not a stand-in `ScannerBackend` stub that merely
//   throws). `registerHooks` intercepts CJS `require()` (verified
//   empirically: the older async `register()` loader hooks do NOT
//   intercept `require()` in this Node version — only `registerHooks`
//   does), and is deregistered in every test's `finally` so it cannot leak
//   into other test files sharing this process.
// - "Access denied" is DETERMINISTIC_INJECTION-if-safely-reproducible: it
//   attempts a real attach to PID 4 (the Windows "System" process), which a
//   non-elevated process can never open for the access rights memory
//   scanning needs. If this environment is itself elevated (or PID 4 is
//   unavailable for any other environment reason) the test skips with a
//   clear diagnostic instead of asserting a false result — mission §14's
//   own explicit "if access denied cannot be safely reproduced: document as
//   environment-limited" rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, mkdtempSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { ScannerBackendError } from '../../src/core/live-memory/scanner-backend.ts';

const NAPI_SPECIFIER = 'solith-scanner-napi';
const REAL_NAPI_DIR = path.resolve(import.meta.dirname, '..', '..', 'native', 'solith-scanner-napi');
const REAL_NODE_BINDING = path.join(REAL_NAPI_DIR, 'solith-scanner-napi.win32-x64-msvc.node');

function realAddonAvailable(): boolean {
  return process.platform === 'win32' && existsSync(REAL_NODE_BINDING);
}

const describeReal = realAddonAvailable() ? test : test.skip;

/** Registers a CJS-require-intercepting resolve hook for `solith-scanner-napi` only; every other specifier falls through unchanged. */
function withRedirectedNapiRequire(targetUrl: string | null, fn: () => Promise<void> | void) {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === NAPI_SPECIFIER) {
        if (targetUrl === null) {
          const err = new Error(`Cannot find module '${NAPI_SPECIFIER}'`) as NodeJS.ErrnoException;
          err.code = 'MODULE_NOT_FOUND';
          throw err;
        }
        return { url: targetUrl, format: 'commonjs', shortCircuit: true } as any;
      }
      return nextResolve(specifier, context);
    },
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => hooks.deregister());
}

/** Imports a fresh `scanner-backend-native.ts` module instance so its module-level `cachedAddon` starts null for this test. */
async function freshNativeScannerBackendModule() {
  const url = `../../src/core/live-memory/scanner-backend-native.ts?cachebust=${Date.now()}-${Math.random()}`;
  return import(url);
}

describeReal('MISSING ADDON (real): require("solith-scanner-napi") genuinely fails to resolve, surfaced as a structured native_addon_missing error', async () => {
  await withRedirectedNapiRequire(null, async () => {
    const { NativeScannerBackend } = await freshNativeScannerBackendModule();
    const backend = new NativeScannerBackend();
    await assert.rejects(
      backend.attach(1),
      (err: unknown) => {
        assert.ok(err instanceof ScannerBackendError, `expected a ScannerBackendError, got ${String(err)}`);
        assert.equal((err as InstanceType<typeof ScannerBackendError>).kind, 'native_addon_missing');
        assert.ok(
          /not installed\/built|Cannot find module/i.test((err as Error).message),
          `expected a real missing-module message, got: ${(err as Error).message}`,
        );
        return true;
      },
    );
  });
});

describeReal('CORRUPT ADDON / LOAD FAILURE (real): a genuinely malformed .node file fails to load, surfaced as a structured native_addon_load_failed error', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'solith-corrupt-addon-'));
  try {
    // Isolated copy — the canonical addon under native/solith-scanner-napi is
    // never touched.
    copyFileSync(path.join(REAL_NAPI_DIR, 'index.js'), path.join(tmpDir, 'index.js'));
    const corruptedBindingPath = path.join(tmpDir, 'solith-scanner-napi.win32-x64-msvc.node');
    copyFileSync(REAL_NODE_BINDING, corruptedBindingPath);
    writeFileSync(corruptedBindingPath, Buffer.from('NOT A REAL NATIVE BINARY — deliberately corrupted for Stage 7.4 §14 real load-failure testing'));

    const corruptedIndexUrl = pathToFileURL(path.join(tmpDir, 'index.js')).href;
    await withRedirectedNapiRequire(corruptedIndexUrl, async () => {
      const { NativeScannerBackend } = await freshNativeScannerBackendModule();
      const backend = new NativeScannerBackend();
      await assert.rejects(
        backend.attach(1),
        (err: unknown) => {
          assert.ok(err instanceof ScannerBackendError, `expected a ScannerBackendError, got ${String(err)}`);
          assert.equal((err as InstanceType<typeof ScannerBackendError>).kind, 'native_addon_load_failed');
          return true;
        },
      );
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describeReal('ACCESS DENIED (deterministic injection, if safely reproducible): attaching to the Windows System process (PID 4) fails, never a crash', async (t) => {
  const { NativeScannerBackend } = await import('../../src/core/live-memory/scanner-backend-native.ts');
  const backend = new NativeScannerBackend();
  let threw: unknown;
  try {
    await backend.attach(4);
  } catch (err) {
    threw = err;
  }
  if (threw === undefined) {
    t.skip(
      'attach(4) unexpectedly succeeded in this environment (likely running elevated) — access denial cannot be safely reproduced here; documenting as environment-limited per mission §14, not asserting a false failure.',
    );
    return;
  }
  assert.ok(threw instanceof ScannerBackendError, `expected a structured ScannerBackendError, got ${String(threw)}`);
  assert.equal((threw as InstanceType<typeof ScannerBackendError>).kind, 'attach_failed');
  // No crash, no hang, no unstructured throw — the required properties for every failure-injection case.
});
