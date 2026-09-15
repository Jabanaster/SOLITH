#!/usr/bin/env node
// Phase 1 / Stage 7 §7.18 — integrates the native scanner addon into the
// REAL build pipeline (Stage 2's `scripts/build-scanner-native-foundation.mjs`
// was deliberately additive-only: debug build, isolated `npm install`, never
// wired into `npm run build`). This script performs a RELEASE build and is
// invoked from `build:electron`, so a fresh checkout with no prior native
// build produces a working `.node` addon with no manual step.
//
// Mirrors `scripts/build-readonly-scanner.mjs`'s existing conventions:
// Windows-only, verifies the expected output exists rather than assuming
// success, never throws away a real error.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const napiCrateDir = join(root, 'native', 'solith-scanner-napi');
const builtAddon = join(napiCrateDir, 'solith-scanner-napi.win32-x64-msvc.node');

if (process.platform !== 'win32') {
  console.log('[Solith Scanner NAPI] Skipping native scanner build: Windows-only, matches this project\'s packaging target.');
  process.exit(0);
}

// `npm install` here is idempotent/fast when already installed — matches
// the readonly-scanner build's own "no manual pre-build step" requirement,
// and is what makes `native/solith-scanner-napi`'s own napi-rs CLI (its
// own devDependency, isolated from the root workspace per Stage 2's
// design) available for the build step below.
console.log('[Solith Scanner NAPI] npm install (isolated napi package)...');
const npmInstall = spawnSync('npm', ['install'], { cwd: napiCrateDir, stdio: 'inherit', shell: true });
if (npmInstall.status !== 0) {
  process.exit(npmInstall.status ?? 1);
}

console.log('[Solith Scanner NAPI] napi build --release...');
const napiBuild = spawnSync('npm', ['run', 'build'], { cwd: napiCrateDir, stdio: 'inherit', shell: true });
if (napiBuild.status !== 0) {
  process.exit(napiBuild.status ?? 1);
}

if (!existsSync(builtAddon)) {
  console.error(`[Solith Scanner NAPI] napi build completed but ${builtAddon} does not exist.`);
  process.exit(1);
}

console.log(`[Solith Scanner NAPI] OK — ${builtAddon} built.`);
