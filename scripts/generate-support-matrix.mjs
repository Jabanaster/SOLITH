#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runner = path.join(__dirname, 'generate-support-matrix-runner.ts');
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

const forwardedArgs = process.argv.slice(2).map(shellQuote).join(' ');
const command = `${npxCommand} tsx ${shellQuote(runner)}${forwardedArgs ? ` ${forwardedArgs}` : ''}`;

const result = spawnSync(
  command,
  { stdio: 'inherit', shell: true },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
