#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distElectron = path.join(root, 'dist-electron');

if (fs.existsSync(distElectron)) {
  const files = fs.readdirSync(distElectron);
  for (const file of files) {
    if (file !== 'dist') {
      // Protect Vite renderer assets inside dist-electron/dist/
      fs.rmSync(path.join(distElectron, file), { recursive: true, force: true });
    }
  }
}
console.log('[Solith Clean] Cleaned top-level dist-electron artifacts (preserved dist-electron/dist).');
