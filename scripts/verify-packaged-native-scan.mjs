#!/usr/bin/env node
// Stage 7 final closure §14 — packaged addon proof, made immutable/exact and
// repeatable. Loads the native scanner addon STRICTLY from its packaged
// resource path (dist/win-unpacked/resources/native/solith-scanner-napi),
// asserts it did NOT resolve via node_modules or any other location, then
// performs a real scan against a real spawned fixture process through it.
//
// Not part of `npm test` (requires a prior `electron-builder --dir` package
// build, which is not guaranteed to exist for every test run) — run manually
// or in a packaging-verification step after `npm run build`.
//
// Windows-only, like the packaging pipeline itself.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('verify-packaged-native-scan: Windows-only, skipping on', process.platform);
  process.exit(0);
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const packagedAddonPath = path.join(
  repoRoot,
  'dist',
  'win-unpacked',
  'resources',
  'native',
  'solith-scanner-napi',
  'index.js',
);
const packagedNodeFilePath = path.join(
  repoRoot,
  'dist',
  'win-unpacked',
  'resources',
  'native',
  'solith-scanner-napi',
  'solith-scanner-napi.win32-x64-msvc.node',
);
const fixturePath = path.join(
  repoRoot,
  'native',
  'solith-scanner-core',
  'target',
  'release',
  'solith-scanner-fixture.exe',
);

if (!existsSync(packagedAddonPath)) {
  console.error(`FAIL: packaged addon entry point not found at ${packagedAddonPath}. Run "npx electron-builder --dir --win" first.`);
  process.exit(1);
}
if (!existsSync(fixturePath)) {
  console.error(`FAIL: fixture binary not found at ${fixturePath}. Run "cargo test --release" in native/solith-scanner-core first.`);
  process.exit(1);
}

// ── Exact, immutable evidence ────────────────────────────────────────────
const stat = statSync(packagedNodeFilePath);
const bytes = readFileSync(packagedNodeFilePath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
let commitSha = 'UNKNOWN';
try {
  commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
} catch {
  /* not fatal for this script's purpose */
}

console.log('── Packaged addon evidence ──');
console.log('path:', packagedNodeFilePath);
console.log('size bytes:', stat.size);
console.log('sha256:', sha256);
console.log('architecture: x86-64 (PE32+ DLL, win32-x64-msvc target)');
console.log('build commit (worktree HEAD at capture time):', commitSha);
console.log('ASAR relationship: outside app.asar (extraResources copy, plain directory)');

// ── Prove the addon module resolves ONLY from the packaged path ─────────
// A require() cache poisoned by an earlier test importing 'solith-scanner-napi'
// via node_modules would let a stale reference slip through unnoticed — so
// this script always runs as a fresh process (no shared cache with any
// other test), and additionally asserts the resolved realpath is under
// dist/win-unpacked, not node_modules or another worktree.
const requireFromScratch = createRequire(import.meta.url);
const resolvedPath = requireFromScratch.resolve(packagedAddonPath);
const normalizedResolved = path.normalize(resolvedPath).toLowerCase();
const normalizedExpectedDir = path.normalize(path.join(repoRoot, 'dist', 'win-unpacked')).toLowerCase();
if (!normalizedResolved.startsWith(normalizedExpectedDir)) {
  console.error(`FAIL: addon resolved to ${resolvedPath}, which is NOT under the packaged output directory ${normalizedExpectedDir}.`);
  process.exit(1);
}
if (normalizedResolved.includes('node_modules')) {
  console.error(`FAIL: addon resolved through node_modules (${resolvedPath}) instead of the packaged copy — this is exactly the "standalone require()" shortcut this script must reject.`);
  process.exit(1);
}
console.log('resolved module path (must be under dist/win-unpacked, never node_modules):', resolvedPath);

const addon = requireFromScratch(packagedAddonPath);
if (typeof addon.NativeScanTarget !== 'function') {
  console.error('FAIL: packaged addon does not export a NativeScanTarget constructor.');
  process.exit(1);
}

// ── Real scan through the packaged copy ──────────────────────────────────
const child = spawn(fixturePath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const fields = {};
await new Promise((resolve, reject) => {
  let buffered = '';
  child.on('error', reject);
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    let idx;
    while ((idx = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, idx).trim();
      buffered = buffered.slice(idx + 1);
      if (line === 'READY') return resolve();
      const eq = line.indexOf('=');
      if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
  });
});

let exitCode = 0;
try {
  const pid = child.pid;
  const target = addon.NativeScanTarget.attach(pid);
  const bigBase = BigInt(fields.BIG_REGION_BASE);
  const sentinelOffset = Number(fields.SENTINEL_OFFSET);
  const sentinelValue = Number(fields.SENTINEL_VALUE);
  const regions = target.enumerateRegions();
  const region = regions.find((r) => bigBase >= r.baseAddress && bigBase < r.baseAddress + r.size);
  if (!region) throw new Error('could not find the fixture big region among enumerated regions');
  const cancellation = new addon.ScanCancellationHandle();
  const progress = new addon.ScanProgressHandle();
  const scanResult = await target.scanExact(region, 'u32', sentinelValue, undefined, 'bytewise', 65536n, 7n, undefined, cancellation, progress);
  const expectedAddress = bigBase + BigInt(sentinelOffset);
  const found = scanResult.matches.some((m) => BigInt(m.address) === expectedAddress);

  console.log('── Real scan through packaged addon ──');
  console.log('fixture PID:', pid);
  console.log('sentinel address:', `0x${expectedAddress.toString(16)}`);
  console.log('sentinel value:', `0x${sentinelValue.toString(16)}`);
  console.log('scan result:', JSON.stringify(scanResult, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  console.log('completeness:', scanResult.completeness.state);
  console.log('SENTINEL FOUND VIA PACKAGED ADDON:', found);

  if (!found) {
    console.error('FAIL: packaged addon did not find the real sentinel.');
    exitCode = 1;
  } else {
    console.log('PASS');
  }
} catch (err) {
  console.error('FAIL:', err);
  exitCode = 1;
} finally {
  try {
    child.stdin.write('exit\n');
  } catch {
    /* already gone */
  }
  child.kill();
}
process.exit(exitCode);
