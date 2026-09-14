#!/usr/bin/env node
// Builds and verifies the Phase 1 / Stage 2 native scanner foundation
// (native/solith-scanner-core + native/solith-scanner-napi). Mirrors the
// existing native/solith-readonly-scanner build script's conventions
// (scripts/build-readonly-scanner.mjs): Windows-only, cargo-driven,
// verifies the expected output exists rather than assuming success.
//
// Unlike that script, this one does NOT copy anything into dist-electron —
// this native module is Stage 2 foundation plumbing only (see
// Docs/phase1/11-stage2-native-layout.md). It is not yet wired into the
// packaged Electron app or any production runtime path; that integration
// belongs to the later stage that actually consumes it (see the Phase 1
// migration ladder, Docs/phase1/09-migration-ladder.md). Running this
// script only proves the native toolchain still builds cleanly from a
// fresh checkout.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const napiCrateDir = join(root, 'native', 'solith-scanner-napi');
const coreCrateDir = join(root, 'native', 'solith-scanner-core');
const builtAddon = join(napiCrateDir, 'solith-scanner-napi.win32-x64-msvc.node');

if (process.platform !== 'win32') {
  console.log('[Solith Scanner Foundation] Skipping native build: Windows-only, matches this project\'s packaging target.');
  process.exit(0);
}

console.log('[Solith Scanner Foundation] cargo test (solith-scanner-core)...');
const coreTest = spawnSync('cargo', ['test'], { cwd: coreCrateDir, stdio: 'inherit', shell: false });
if (coreTest.status !== 0) {
  process.exit(coreTest.status ?? 1);
}

console.log('[Solith Scanner Foundation] npm install (isolated napi package)...');
const npmInstall = spawnSync('npm', ['install'], { cwd: napiCrateDir, stdio: 'inherit', shell: true });
if (npmInstall.status !== 0) {
  process.exit(npmInstall.status ?? 1);
}

console.log('[Solith Scanner Foundation] napi build (debug)...');
const napiBuild = spawnSync('npm', ['run', 'build:debug'], { cwd: napiCrateDir, stdio: 'inherit', shell: true });
if (napiBuild.status !== 0) {
  process.exit(napiBuild.status ?? 1);
}

if (!existsSync(builtAddon)) {
  console.error(`[Solith Scanner Foundation] napi build completed but ${builtAddon} does not exist.`);
  process.exit(1);
}

console.log('[Solith Scanner Foundation] npm test (napi-layer integration tests)...');
const napiTest = spawnSync('npm', ['test'], { cwd: napiCrateDir, stdio: 'inherit', shell: true });
if (napiTest.status !== 0) {
  process.exit(napiTest.status ?? 1);
}

console.log(`[Solith Scanner Foundation] OK — ${builtAddon} built and verified.`);
