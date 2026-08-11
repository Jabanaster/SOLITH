#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distElectron = path.join(root, 'dist-electron');
const manifestPath = path.join(distElectron, 'solith-build-manifest.json');

// 1. Directory and manifest verification
if (!fs.existsSync(distElectron)) {
  console.error('[security-verify] REJECTED: dist-electron directory is missing.');
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.error('[security-verify] REJECTED: Production build manifest solith-build-manifest.json is missing.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.buildMode !== 'production' || manifest.consentOverrideEnabled !== false) {
  console.error(`[security-verify] REJECTED: Build manifest is not production mode (found mode: ${manifest.buildMode}).`);
  process.exit(1);
}

// 2. Required bundle assertion (vacuous pass prevention)
const requiredBundles = [
  'main.js',
  'preload.cjs',
  'host-entry.js',
  'headless-verification-worker.js',
];
for (const b of requiredBundles) {
  if (!fs.existsSync(path.join(distElectron, b))) {
    console.error(`[security-verify] REJECTED: Required bundle missing: ${b}`);
    process.exit(1);
  }
}

// 3. Package configuration safety check
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (JSON.stringify(pkg.build?.files ?? []).includes('dist-electron-test')) {
  console.error('[security-verify] REJECTED: package.json build.files references test directory!');
  process.exit(1);
}

// 4. Scan all JS, CJS, MJS, JSON, HTML, MAP files under dist-electron/ AND dist-electron/dist/
function scanAllArtifacts(dir) {
  let results = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) results = results.concat(scanAllArtifacts(full));
    else if (/\.(js|cjs|mjs|json|html|map)$/i.test(item)) results.push(full);
  }
  return results;
}

const scannedFiles = scanAllArtifacts(distElectron);
if (scannedFiles.length < 5) {
  console.error(`[security-verify] REJECTED: Only ${scannedFiles.length} artifacts found; expected >= 5.`);
  process.exit(1);
}

const forbidden = [
  '__SOLITH_TEST_BUILD_MARKER__',
  'SOLITH_PRIVILEGED_CONSENT',
  'auto-approve',
  'auto-deny',
];

let failed = false;
for (const file of scannedFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of forbidden) {
    if (content.includes(pattern)) {
      console.error(`[security-verify] REJECTED: Forbidden string "${pattern}" found in ${path.relative(root, file)}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`[security-verify] PASS: Verified ${scannedFiles.length} production artifacts (including renderer and manifests). Zero test markers or bypass strings found.`);
