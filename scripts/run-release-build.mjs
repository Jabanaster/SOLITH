#!/usr/bin/env node
// Finding 5 (independent security review, ef254d1): scripts/verify-electron-output.mjs's
// placeholder catalog-update trust-root check only fails the build when
// SOLITH_RELEASE_BUILD=1 is set — but nothing in the documented release path
// (`npm run build`, `npm run dist`) ever set it, so a human forgetting the
// env var could ship the placeholder Ed25519 trust root. This wrapper is the
// only supported entrypoint for a real release build/dist/verify: it forces
// SOLITH_RELEASE_BUILD=1 for the wrapped npm script, so the gate cannot be
// silently skipped by an env var nobody remembered to set. Ordinary dev
// builds (`npm run build` directly) are unaffected and continue to only warn.
import { spawnSync } from 'node:child_process';

const npmScript = process.argv[2];
if (!npmScript) {
  console.error('Usage: node scripts/run-release-build.mjs <npm-script-name>');
  process.exit(1);
}

const result = spawnSync('npm', ['run', npmScript], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, SOLITH_RELEASE_BUILD: '1' },
});

if (result.error) {
  console.error(`Failed to launch npm run ${npmScript}:`, result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
