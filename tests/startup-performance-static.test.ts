// Static assertions covering the startup-performance fix in electron/main.ts:
//   - the window is not shown before the renderer signals readiness
//   - a fallback exists so a stuck renderer still results in a visible window
//   - non-critical trainer catalog bootstrap starts only once, after the
//     window is shown, not before window creation
//   - the deferred bootstrap keeps its original try/catch/console.error
//     failure handling
//
// These are source-level checks rather than a live Electron harness because
// the actual timing behavior is already covered empirically by
// scripts/measure-startup.mjs (manual investigation harness) and by the
// existing tests/performance.e2e.test.ts (perf-01, live launch timing).
// Wall-clock assertions on renderer paint time are avoided here since
// renderer-side paint duration has independent variance unrelated to this
// fix (see final report).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_TS = path.join(ROOT, 'electron', 'main.ts');

function readMain(): string {
  return fs.readFileSync(MAIN_TS, 'utf8');
}

describe('startup performance — window visibility gating', () => {
  test('BrowserWindow is constructed with show: false', () => {
    const source = readMain();
    const ctorMatch = source.match(/new BrowserWindow\(\{[\s\S]*?\n {2}\}\);/);
    assert.ok(ctorMatch, 'BrowserWindow constructor call not found');
    assert.match(ctorMatch![0], /show:\s*false/, 'window must not be shown before renderer readiness');
  });

  test('window is shown on ready-to-show, not unconditionally', () => {
    const source = readMain();
    assert.match(source, /\.once\(\s*'ready-to-show'/, "expected a once('ready-to-show', ...) listener");
    const ctorMatch = source.match(/new BrowserWindow\(\{[\s\S]*?\}\);/);
    assert.ok(ctorMatch && ctorMatch.index != null, 'BrowserWindow constructor call not found');
    const afterCtorStatements = source
      .slice(ctorMatch.index + ctorMatch[0].length)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    assert.notEqual(afterCtorStatements[0], 'mainWindow.show();', 'window must not be shown immediately after construction');
  });

  test('a fallback timeout exists so a stuck renderer still shows a window', () => {
    const source = readMain();
    assert.match(
      source,
      /setTimeout\(\s*\(\)\s*=>\s*showOnce\(['"]ready-to-show-fallback-timeout['"]\)/,
      'expected a fallback setTimeout calling showOnce with a fallback reason'
    );
  });

  test('the fallback timeout is cleared on window close', () => {
    const source = readMain();
    assert.match(source, /clearTimeout\(readyToShowFallback\)/, 'fallback timer must be cleared to avoid a dangling handle after close');
  });
});

describe('startup performance — deferred non-critical catalog bootstrap', () => {
  test('trainer catalog bootstrap is not awaited before createWindow() in app.whenReady()', () => {
    const source = readMain();
    const whenReadyMatch = source.match(/app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?\n\}\);/);
    assert.ok(whenReadyMatch, 'app.whenReady() handler not found');
    assert.doesNotMatch(
      whenReadyMatch![0],
      /await bootstrapTrainerCatalog\(\)/,
      'bootstrapTrainerCatalog() must not be awaited inside the pre-window startup chain'
    );
  });

  test('runDeferredTrainerCatalogBootstrap is idempotent (single start guard)', () => {
    const source = readMain();
    assert.match(
      source,
      /let trainerCatalogBootstrapStarted = false;/,
      'expected a module-level guard flag'
    );
    assert.match(
      source,
      /if \(trainerCatalogBootstrapStarted\) return Promise\.resolve\(\);/,
      'expected an early-return guard so bootstrap only runs once'
    );
  });

  test('deferred bootstrap preserves original operations and error handling', () => {
    const source = readMain();
    const fnMatch = source.match(/function runDeferredTrainerCatalogBootstrap\(\)[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'runDeferredTrainerCatalogBootstrap not found');
    const body = fnMatch![0];
    assert.match(body, /await bootstrapTrainerCatalog\(\)/);
    assert.match(body, /await reconcileCommunitySyncPolling\(\)/);
    assert.match(body, /await startCatalogProcessWatch\(\)/);
    assert.match(body, /catch \(error\) \{\s*\n\s*console\.error\('Trainer catalog bootstrap failed:', error\);/);
  });

  test('deferred bootstrap is only invoked from showOnce, not from app.whenReady() directly', () => {
    const source = readMain();
    const calls = source.match(/void runDeferredTrainerCatalogBootstrap\(\);/g) ?? [];
    assert.equal(calls.length, 1, 'expected exactly one kick-off call site');
    const showOnceMatch = source.match(/const showOnce = \([\s\S]*?\n  \};/);
    assert.ok(showOnceMatch, 'showOnce function not found');
    assert.match(showOnceMatch![0], /void runDeferredTrainerCatalogBootstrap\(\);/, 'kick-off must happen inside showOnce');
  });

  test('required pre-window steps (db init, crash recovery) remain awaited before createWindow()', () => {
    const source = readMain();
    const whenReadyMatch = source.match(/app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*?\n\}\);/);
    assert.ok(whenReadyMatch);
    const body = whenReadyMatch![0];
    assert.match(body, /await dbModule\.initDatabase\(\)/);
    assert.match(body, /await operationsModule\.recoverInterruptedOperations\(\)/);
    const dbIdx = body.indexOf('await dbModule.initDatabase()');
    const recoveryIdx = body.indexOf('await operationsModule.recoverInterruptedOperations()');
    const createWindowIdx = body.indexOf('createWindow();');
    assert.ok(dbIdx > -1 && recoveryIdx > -1 && createWindowIdx > -1);
    assert.ok(dbIdx < createWindowIdx, 'db init must still run before window creation');
    assert.ok(recoveryIdx < createWindowIdx, 'crash recovery must still run before window creation');
  });
});
