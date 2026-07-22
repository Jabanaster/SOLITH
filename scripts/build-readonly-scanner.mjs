#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const crateDir = join(root, 'native', 'solith-readonly-scanner');
const outDir = join(root, 'dist-electron');
const exeName = process.platform === 'win32' ? 'solith-readonly-scanner.exe' : 'solith-readonly-scanner';
const builtExe = join(crateDir, 'target', 'release', exeName);
const targetExe = join(outDir, 'solith-readonly-scanner.exe');

if (process.platform !== 'win32') {
  console.log('[Solith Scanner] Skipping native scanner build: Windows-only helper.');
  process.exit(0);
}

const cargo = spawnSync('cargo', ['build', '--release'], {
  cwd: crateDir,
  stdio: 'inherit',
  shell: false,
});

if (cargo.status !== 0) {
  process.exit(cargo.status ?? 1);
}

if (!existsSync(builtExe)) {
  console.error(`[Solith Scanner] Cargo completed but ${builtExe} does not exist.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(builtExe, targetExe);
console.log(`[Solith Scanner] Copied ${targetExe}`);
