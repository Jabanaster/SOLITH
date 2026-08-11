#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distElectronTest = path.join(root, 'dist-electron-test');
const manifestPath = path.join(distElectronTest, 'solith-build-manifest.json');

if (!fs.existsSync(distElectronTest)) {
  console.error('[test-verify] REJECTED: dist-electron-test directory is missing.');
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.error('[test-verify] REJECTED: Test build manifest solith-build-manifest.json is missing.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.buildMode !== 'test' || manifest.consentOverrideEnabled !== true) {
  console.error(`[test-verify] REJECTED: Test build manifest is invalid (found mode: ${manifest.buildMode}).`);
  process.exit(1);
}

const requiredBundles = [
  'main.js',
  'preload.cjs',
  'host-entry.js',
  'headless-verification-worker.js',
  'solith-readonly-scanner.exe',
  path.join('dist', 'index.html'),
];

for (const b of requiredBundles) {
  const fullPath = path.join(distElectronTest, b);
  if (!fs.existsSync(fullPath)) {
    console.error(`[test-verify] REJECTED: Required test artifact missing: ${b}`);
    process.exit(1);
  }
}

console.log('[test-verify] PASS: Verified all required test-harness artifacts exist under dist-electron-test/.');
