#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distElectronTest = path.join(root, 'dist-electron-test');

if (fs.existsSync(distElectronTest)) {
  fs.rmSync(distElectronTest, { recursive: true, force: true });
}
console.log('[Solith Clean Test] Cleaned dist-electron-test directory.');
