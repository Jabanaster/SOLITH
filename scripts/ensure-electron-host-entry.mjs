#!/usr/bin/env node
/**
 * TrainerHost E2E (included in default `npm test`) requires
 * `dist-electron/host-entry.js`. Fresh clones fail that suite with
 * cancelledByParent unless Electron was built first.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostEntry = path.join(root, 'dist-electron', 'host-entry.js');

if (existsSync(hostEntry)) {
  process.exit(0);
}

console.log('[solith] dist-electron/host-entry.js missing — running build:electron before tests');
const result = spawnSync('npm', ['run', 'build:electron'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
