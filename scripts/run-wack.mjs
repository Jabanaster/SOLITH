#!/usr/bin/env node
// Runs the Windows App Certification Kit (WACK) against a locally built
// MSIX/AppX package. Never claims a WACK pass without actually invoking
// appcert.exe — if no package exists (because Store identity env vars were
// never supplied and build:msix was never run), this reports
// BLOCKED — STORE IDENTITY REQUIRED and exits non-zero rather than
// fabricating a result.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');
const REPORT_PATH = path.join(ROOT, 'wack-report.xml');

const APPCERT_CANDIDATES = [
  'C:\\Program Files (x86)\\Windows Kits\\10\\App Certification Kit\\appcert.exe',
  'C:\\Program Files\\Windows Kits\\10\\App Certification Kit\\appcert.exe',
];

function findAppcert() {
  return APPCERT_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

function findPackage() {
  if (!fs.existsSync(DIST_DIR)) return null;
  const entries = fs.readdirSync(DIST_DIR);
  const pkg = entries.find((f) => f.toLowerCase().endsWith('.appx') || f.toLowerCase().endsWith('.msix'));
  return pkg ? path.join(DIST_DIR, pkg) : null;
}

const appcertPath = findAppcert();
const packagePath = findPackage();

if (!packagePath) {
  console.error('[wack] BLOCKED — STORE IDENTITY REQUIRED');
  console.error('[wack] No .appx/.msix package found in dist/. Run "npm run build:msix" first');
  console.error('[wack] (which itself requires SOLITH_MSIX_IDENTITY_NAME / SOLITH_MSIX_PUBLISHER /');
  console.error('[wack] SOLITH_MSIX_PUBLISHER_DISPLAY_NAME to be set).');
  process.exit(1);
}

if (!appcertPath) {
  console.error('[wack] Windows App Certification Kit (appcert.exe) was not found on this machine.');
  console.error('[wack] Expected at one of:');
  for (const c of APPCERT_CANDIDATES) console.error(`  - ${c}`);
  console.error('[wack] Install the Windows App Certification Kit (part of the Windows SDK) to run this locally.');
  process.exit(1);
}

console.log(`[wack] Found package: ${packagePath}`);
console.log(`[wack] Found appcert.exe: ${appcertPath}`);
console.log('[wack] Running WACK — this can take several minutes...');

const result = spawnSync(
  appcertPath,
  ['test', '-appxpackagepath', packagePath, '-reportoutputpath', REPORT_PATH],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error('[wack] appcert.exe failed to launch:', result.error);
  process.exit(1);
}

console.log(`[wack] appcert.exe exited with code ${result.status}`);
if (fs.existsSync(REPORT_PATH)) {
  console.log(`[wack] Report written to: ${REPORT_PATH}`);
} else {
  console.warn('[wack] No report file was produced — check appcert.exe output above for the failure reason.');
}

process.exit(result.status ?? 1);
