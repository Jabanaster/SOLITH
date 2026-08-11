#!/usr/bin/env node
// scripts/verify-electron-output.mjs
// Verifies the tsup-compiled Electron output is safe to run.
// Fails the build if any structural problem is found.
// Run automatically as part of `npm run build`.

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..');
const DIST = join(ROOT, 'dist-electron');

let failures = 0;
let checks = 0;

function check(description, condition, detail = '') {
  checks++;
  if (!condition) {
    console.error(`  ❌ FAIL [${checks}] ${description}${detail ? ': ' + detail : ''}`);
    failures++;
  } else {
    console.log(`  ✅ PASS [${checks}] ${description}`);
  }
}

function fileExists(relativePath) {
  return existsSync(join(DIST, relativePath));
}

function readBundleText(relativePath) {
  const full = join(DIST, relativePath);
  if (!existsSync(full)) return '';
  return readFileSync(full, 'utf8');
}

console.log('\n🔍 Solith — Electron Output Verifier\n');

// ── 1. Required files exist ──────────────────────────────────────────────────
console.log('── Required files');
check('main.js exists', fileExists('main.js'));
check('preload.cjs exists', fileExists('preload.cjs'));
check('host-entry.js exists (TrainerHost child process)', fileExists('host-entry.js'));
check('headless-verification-worker.js exists (read-only runtime worker)', fileExists('headless-verification-worker.js'));
check('solith-readonly-scanner.exe exists (Windows read-only helper)', process.platform !== 'win32' || fileExists('solith-readonly-scanner.exe'));

const mainText  = readBundleText('main.js');
const preloadText = readBundleText('preload.cjs');
const headlessWorkerText = readBundleText('headless-verification-worker.js');

// ── 2. No TypeScript source paths in compiled output ─────────────────────────
console.log('\n── No TypeScript leakage');
const tsImportPattern = /from\s+['"][^'"]*\.ts['"]/g;
const tsDynPattern    = /import\(['"][^'"]*\.ts['"]\)/g;
const mainTsHits      = [...mainText.matchAll(tsImportPattern), ...mainText.matchAll(tsDynPattern)];
const preloadTsHits   = [...preloadText.matchAll(tsImportPattern), ...preloadText.matchAll(tsDynPattern)];
const headlessWorkerTsHits = [...headlessWorkerText.matchAll(tsImportPattern), ...headlessWorkerText.matchAll(tsDynPattern)];
check('main.js contains no .ts imports',    mainTsHits.length === 0,
  mainTsHits.length ? mainTsHits.slice(0,3).map(m => m[0]).join(', ') : '');
check('preload.cjs contains no .ts imports', preloadTsHits.length === 0,
  preloadTsHits.length ? preloadTsHits.slice(0,3).map(m => m[0]).join(', ') : '');
check('headless-verification-worker.js contains no .ts imports', headlessWorkerTsHits.length === 0,
  headlessWorkerTsHits.length ? headlessWorkerTsHits.slice(0,3).map(m => m[0]).join(', ') : '');

// ── 3. No bare relative imports remain ──────────────────────────────────────
//    (tsup bundles everything; any leftover would be a bundler failure)
console.log('\n── No bare relative imports');
const relImportPattern = /from\s+['"](\.\.?\/[^'"]+?)['"]/g;
const mainRelHits   = [...mainText.matchAll(relImportPattern)];
const preloadRelHits = [...preloadText.matchAll(relImportPattern)];
const headlessWorkerRelHits = [...headlessWorkerText.matchAll(relImportPattern)];
check('main.js has no bare relative imports',    mainRelHits.length === 0,
  mainRelHits.length ? `${mainRelHits.length} found: ` + mainRelHits.slice(0,3).map(m => m[1]).join(', ') : '');
check('preload.cjs has no bare relative imports', preloadRelHits.length === 0,
  preloadRelHits.length ? `${preloadRelHits.length} found: ` + preloadRelHits.slice(0,3).map(m => m[1]).join(', ') : '');
check('headless-verification-worker.js has no bare relative imports', headlessWorkerRelHits.length === 0,
  headlessWorkerRelHits.length ? `${headlessWorkerRelHits.length} found: ` + headlessWorkerRelHits.slice(0,3).map(m => m[1]).join(', ') : '');

// ── 4. No development-only paths ────────────────────────────────────────────
console.log('\n── No development-only paths');
const geminiPattern = /\.gemini[\/\\]/;
check('main.js does not import from .gemini', !geminiPattern.test(mainText));
check('preload.cjs does not import from .gemini', !geminiPattern.test(preloadText));
check('headless-verification-worker.js does not import from .gemini', !geminiPattern.test(headlessWorkerText));

const testRunnerPattern = /require\(['"]mocha|require\(['"]jest|from ['"]vitest|--test\b/;
check('main.js does not import a test runner', !testRunnerPattern.test(mainText));
check('headless-verification-worker.js does not import a test runner', !testRunnerPattern.test(headlessWorkerText));

// ── 5. contextBridge in preload ──────────────────────────────────────────────
console.log('\n── Security checks');
check('preload.js uses contextBridge', preloadText.includes('contextBridge'));
check('preload.js uses exposeInMainWorld', preloadText.includes('exposeInMainWorld'));
check('main.js has nodeIntegration: false', mainText.includes('nodeIntegration: false') || mainText.includes('nodeIntegration:false') || mainText.includes('nodeIntegration: !1') || mainText.includes('nodeIntegration:!1'));
check('main.js has contextIsolation: true', mainText.includes('contextIsolation: true') || mainText.includes('contextIsolation:true') || mainText.includes('contextIsolation: !0') || mainText.includes('contextIsolation:!0'));
check('main.js has single-instance lock', mainText.includes('requestSingleInstanceLock'));

// ── 6. Bundle size sanity ────────────────────────────────────────────────────
console.log('\n── Bundle sanity');
const mainSize = existsSync(join(DIST, 'main.js')) ? statSync(join(DIST, 'main.js')).size : 0;
const preloadSize = existsSync(join(DIST, 'preload.cjs')) ? statSync(join(DIST, 'preload.cjs')).size : 0;
const headlessWorkerSize = existsSync(join(DIST, 'headless-verification-worker.js')) ? statSync(join(DIST, 'headless-verification-worker.js')).size : 0;
const scannerSize = existsSync(join(DIST, 'solith-readonly-scanner.exe')) ? statSync(join(DIST, 'solith-readonly-scanner.exe')).size : 0;
check('main.js > 10 KB (not empty/stub)',     mainSize > 10_000,    `actual: ${(mainSize/1024).toFixed(1)} KB`);
check('main.js < 5 MB (not bloated)',         mainSize < 5_000_000, `actual: ${(mainSize/1024).toFixed(1)} KB`);
check('preload.cjs > 100 bytes (not empty)',  preloadSize > 100,    `actual: ${preloadSize} bytes`);
check('preload.cjs < 100 KB (not bloated)',   preloadSize < 100_000, `actual: ${preloadSize} bytes`);
check('headless-verification-worker.js > 1 KB (not empty/stub)', headlessWorkerSize > 1_000, `actual: ${headlessWorkerSize} bytes`);
check('headless-verification-worker.js < 500 KB (not bloated)', headlessWorkerSize < 500_000, `actual: ${(headlessWorkerSize/1024).toFixed(1)} KB`);
check('solith-readonly-scanner.exe > 10 KB on Windows (not empty/stub)', process.platform !== 'win32' || scannerSize > 10_000, `actual: ${scannerSize} bytes`);
check('solith-readonly-scanner.exe < 5 MB on Windows (not bloated)', process.platform !== 'win32' || scannerSize < 5_000_000, `actual: ${(scannerSize/1024).toFixed(1)} KB`);

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n── Summary: ${checks - failures}/${checks} checks passed\n`);

if (failures > 0) {
  console.error(`❌ ${failures} verification check(s) failed. Build is not safe to deploy.\n`);
  process.exit(1);
} else {
  console.log(`✅ All ${checks} checks passed. Electron output is verified.\n`);
}
