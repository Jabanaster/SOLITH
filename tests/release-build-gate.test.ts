import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

// Independent security review, Finding 5 (MEDIUM) against frozen candidate
// ef254d1: scripts/verify-electron-output.mjs's placeholder catalog-update
// trust-root check only fails the build when SOLITH_RELEASE_BUILD=1 is set,
// but no documented release command (`npm run build`, `npm run dist`) ever
// set it — a human forgetting the env var could ship the placeholder
// Ed25519 trust root undetected. scripts/run-release-build.mjs is now the
// only supported release entrypoint: it force-sets SOLITH_RELEASE_BUILD=1
// for whatever npm script it wraps, so the gate cannot be silently skipped.
//
// These tests exercise the real wrapper script end-to-end against a
// hermetic scratch npm project (not the real build, which is expensive and
// would require mutating real dist-electron output to simulate a
// placeholder-key regression) — proving the env var genuinely reaches the
// wrapped script's process — plus a static check that every documented
// release script in package.json routes through the wrapper.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRAPPER = path.join(REPO_ROOT, 'scripts', 'run-release-build.mjs');

function mkScratchNpmProject(scriptBody: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-release-gate-test-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'scratch', version: '0.0.0', scripts: { 'check-env': scriptBody } }, null, 2),
  );
  return dir;
}

test('run-release-build.mjs forces SOLITH_RELEASE_BUILD=1 on the wrapped npm script, even when unset in the parent environment', () => {
  const dir = mkScratchNpmProject(
    `node -e "require('fs').writeFileSync('env-output.txt', process.env.SOLITH_RELEASE_BUILD || 'UNSET')"`,
  );
  const { SOLITH_RELEASE_BUILD: _unused, ...envWithoutFlag } = process.env;

  const result = spawnSync('node', [WRAPPER, 'check-env'], {
    cwd: dir,
    env: envWithoutFlag,
    shell: process.platform === 'win32',
  });

  assert.equal(result.status, 0, result.stderr?.toString());
  const output = fs.readFileSync(path.join(dir, 'env-output.txt'), 'utf8');
  assert.equal(output, '1', 'the wrapped script must observe SOLITH_RELEASE_BUILD=1');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('run-release-build.mjs forces SOLITH_RELEASE_BUILD=1 even when the parent environment explicitly sets it to something else', () => {
  const dir = mkScratchNpmProject(
    `node -e "require('fs').writeFileSync('env-output.txt', process.env.SOLITH_RELEASE_BUILD || 'UNSET')"`,
  );

  const result = spawnSync('node', [WRAPPER, 'check-env'], {
    cwd: dir,
    env: { ...process.env, SOLITH_RELEASE_BUILD: '0' },
    shell: process.platform === 'win32',
  });

  assert.equal(result.status, 0, result.stderr?.toString());
  const output = fs.readFileSync(path.join(dir, 'env-output.txt'), 'utf8');
  assert.equal(output, '1');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('run-release-build.mjs propagates the wrapped script\'s failure exit code (fail closed)', () => {
  const dir = mkScratchNpmProject('node -e "process.exit(1)"');

  const result = spawnSync('node', [WRAPPER, 'check-env'], {
    cwd: dir,
    shell: process.platform === 'win32',
  });

  assert.notEqual(result.status, 0, 'a failing wrapped script must not be reported as success');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('run-release-build.mjs requires an explicit npm-script argument (no silent no-op)', () => {
  const dir = mkScratchNpmProject('node -e "process.exit(0)"');

  const result = spawnSync('node', [WRAPPER], {
    cwd: dir,
    shell: process.platform === 'win32',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /usage/i);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('every documented release build/dist/verify script in package.json routes through the release-build gate wrapper', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const scripts: Record<string, string> = pkg.scripts;

  const releaseScriptNames = Object.keys(scripts).filter((name) => /^(build|dist):release$|^release:verify$/.test(name));
  assert.ok(releaseScriptNames.length >= 3, 'expected build:release, dist:release, and release:verify to exist');

  for (const name of releaseScriptNames) {
    assert.match(
      scripts[name],
      /run-release-build\.mjs/,
      `"${name}" must route through scripts/run-release-build.mjs so SOLITH_RELEASE_BUILD is never left to be set by hand`,
    );
  }

  // Guard against a future alternate release path that bypasses the wrapper —
  // e.g. someone adding "build:prod": "npm run build" directly.
  for (const [name, command] of Object.entries(scripts)) {
    if (/release|prod/i.test(name) && /electron-builder|npm run build\b/.test(command)) {
      assert.match(
        command,
        /run-release-build\.mjs/,
        `"${name}" looks like a release/production build path but does not route through run-release-build.mjs`,
      );
    }
  }
});
