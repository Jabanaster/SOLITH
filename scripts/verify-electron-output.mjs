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

console.log('\n🔍 ResourceForge — Electron Output Verifier\n');

// ── 1. Required files exist ──────────────────────────────────────────────────
console.log('── Required files');
check('main.js exists', fileExists('main.js'));
check('preload.cjs exists', fileExists('preload.cjs'));

const mainText  = readBundleText('main.js');
const preloadText = readBundleText('preload.cjs');

// ── 2. No TypeScript source paths in compiled output ─────────────────────────
console.log('\n── No TypeScript leakage');
const tsImportPattern = /from\s+['"][^'"]*\.ts['"]/g;
const tsDynPattern    = /import\(['"][^'"]*\.ts['"]\)/g;
const mainTsHits      = [...mainText.matchAll(tsImportPattern), ...mainText.matchAll(tsDynPattern)];
const preloadTsHits   = [...preloadText.matchAll(tsImportPattern), ...preloadText.matchAll(tsDynPattern)];
check('main.js contains no .ts imports',    mainTsHits.length === 0,
  mainTsHits.length ? mainTsHits.slice(0,3).map(m => m[0]).join(', ') : '');
check('preload.cjs contains no .ts imports', preloadTsHits.length === 0,
  preloadTsHits.length ? preloadTsHits.slice(0,3).map(m => m[0]).join(', ') : '');

// ── 3. No bare relative imports remain ──────────────────────────────────────
//    (tsup bundles everything; any leftover would be a bundler failure)
console.log('\n── No bare relative imports');
const relImportPattern = /from\s+['"](\.\.?\/[^'"]+?)['"]/g;
const mainRelHits   = [...mainText.matchAll(relImportPattern)];
const preloadRelHits = [...preloadText.matchAll(relImportPattern)];
check('main.js has no bare relative imports',    mainRelHits.length === 0,
  mainRelHits.length ? `${mainRelHits.length} found: ` + mainRelHits.slice(0,3).map(m => m[1]).join(', ') : '');
check('preload.cjs has no bare relative imports', preloadRelHits.length === 0,
  preloadRelHits.length ? `${preloadRelHits.length} found: ` + preloadRelHits.slice(0,3).map(m => m[1]).join(', ') : '');

// ── 4. No development-only paths ────────────────────────────────────────────
console.log('\n── No development-only paths');
const geminiPattern = /\.gemini[\/\\]/;
check('main.js does not import from .gemini', !geminiPattern.test(mainText));
check('preload.cjs does not import from .gemini', !geminiPattern.test(preloadText));

const testRunnerPattern = /require\(['"]mocha|require\(['"]jest|from ['"]vitest|--test\b/;
check('main.js does not import a test runner', !testRunnerPattern.test(mainText));

// ── 5. contextBridge in preload ──────────────────────────────────────────────
console.log('\n── Security checks');
check('preload.js uses contextBridge', preloadText.includes('contextBridge'));
check('preload.js uses exposeInMainWorld', preloadText.includes('exposeInMainWorld'));
check('main.js has nodeIntegration: false', mainText.includes('nodeIntegration: false') || mainText.includes('nodeIntegration:false'));
check('main.js has contextIsolation: true', mainText.includes('contextIsolation: true') || mainText.includes('contextIsolation:true'));
check('main.js has single-instance lock', mainText.includes('requestSingleInstanceLock'));

// ── 6. Bundle size sanity ────────────────────────────────────────────────────
console.log('\n── Bundle sanity');
const mainSize = existsSync(join(DIST, 'main.js')) ? statSync(join(DIST, 'main.js')).size : 0;
const preloadSize = existsSync(join(DIST, 'preload.cjs')) ? statSync(join(DIST, 'preload.cjs')).size : 0;
check('main.js > 10 KB (not empty/stub)',     mainSize > 10_000,    `actual: ${(mainSize/1024).toFixed(1)} KB`);
check('main.js < 5 MB (not bloated)',         mainSize < 5_000_000, `actual: ${(mainSize/1024).toFixed(1)} KB`);
check('preload.cjs > 100 bytes (not empty)',  preloadSize > 100,    `actual: ${preloadSize} bytes`);
check('preload.cjs < 100 KB (not bloated)',   preloadSize < 100_000, `actual: ${preloadSize} bytes`);

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n── Summary: ${checks - failures}/${checks} checks passed\n`);

if (failures > 0) {
  console.error(`❌ ${failures} verification check(s) failed. Build is not safe to deploy.\n`);
  process.exit(1);
} else {
  console.log(`✅ All ${checks} checks passed. Electron output is verified.\n`);
}
