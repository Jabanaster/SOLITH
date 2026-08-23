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

const npmScripts = process.argv.slice(2);
if (npmScripts.length === 0) {
  console.error('Usage: node scripts/run-release-build.mjs <npm-script-name> [<npm-script-name>...]');
  process.exit(1);
}

// Every listed script runs to completion even if an earlier one fails — a
// release-mode verifier can have multiple independent, simultaneously-true
// blockers (e.g. the placeholder trust-root key AND unsigned artifacts),
// and stopping at the first would hide the rest. The overall exit code is
// non-zero if any script failed.
let worstStatus = 0;

for (const npmScript of npmScripts) {
  const result = spawnSync('npm', ['run', npmScript], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, SOLITH_RELEASE_BUILD: '1' },
  });

  if (result.error) {
    console.error(`Failed to launch npm run ${npmScript}:`, result.error);
    process.exit(1);
  }

  const status = result.status ?? 1;
  if (status !== 0) {
    worstStatus = status;
  }
}

process.exit(worstStatus);
