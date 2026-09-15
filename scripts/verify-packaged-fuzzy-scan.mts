#!/usr/bin/env tsx
/**
 * Phase 1 / Stage 7.5 §7 — packaged fuzzy AOB proof.
 *
 * Companion to `verify-packaged-native-scan.mjs`, which proves the packaged
 * addon serves exact-value, u16/u64 and exact-AOB scans. This script proves the
 * remaining path: the real, production `signature-engine.ts` drift-tolerant
 * resolver, running over a `ScannerMemorySource` backed STRICTLY by the
 * packaged addon copy, against a real spawned fixture process.
 *
 *   packaged resources -> signature-engine fuzzy path -> backend memory source
 *   -> packaged native addon -> real fixture process -> correct address
 *
 * The addon is required by absolute packaged path and the resolved realpath is
 * asserted to be under dist/win-unpacked and NOT under node_modules, so a
 * `require('solith-scanner-napi')` that happened to resolve to the development
 * copy cannot silently satisfy this proof.
 *
 * Nothing here re-implements matching. `scanFuzzySignatureViaSource` is
 * imported from src and is the same function the shipping IPC path calls
 * through `LiveMemorySession.createFuzzyAobResolver()`.
 *
 * Not part of `npm test` — requires a prior `electron-builder --dir`.
 * Windows-only, like the packaging pipeline itself.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { scanFuzzySignatureViaSource } from '../src/core/live-memory/signature-engine.ts';
import type {
  CanonicalMemoryRegion,
  CanonicalRegionReadOutcome,
  CanonicalRegionSlice,
  CanonicalSkippedRange,
} from '../src/core/live-memory/scanner-backend.ts';
import type { ScannerMemorySource } from '../src/core/live-memory/scanner-backend-router.ts';

if (process.platform !== 'win32') {
  console.log('verify-packaged-fuzzy-scan: Windows-only, skipping on', process.platform);
  process.exit(0);
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const packagedAddonPath = path.join(
  repoRoot, 'dist', 'win-unpacked', 'resources', 'native', 'solith-scanner-napi', 'index.js',
);
const fixturePath = path.join(
  repoRoot, 'native', 'solith-scanner-core', 'target', 'release', 'solith-scanner-fixture.exe',
);

if (!existsSync(packagedAddonPath)) {
  console.error(`FAIL: packaged addon entry point not found at ${packagedAddonPath}. Run "npx electron-builder --dir" first.`);
  process.exit(1);
}
if (!existsSync(fixturePath)) {
  console.error(`FAIL: fixture binary not found at ${fixturePath}. Run "cargo test --release" in native/solith-scanner-core first.`);
  process.exit(1);
}

// ── Prove the addon resolves ONLY from the packaged path ──────────────────
const requireFromScratch = createRequire(import.meta.url);
const resolvedPath = requireFromScratch.resolve(packagedAddonPath);
const normalizedResolved = path.normalize(resolvedPath).toLowerCase();
const normalizedPackagedDir = path.normalize(path.join(repoRoot, 'dist', 'win-unpacked')).toLowerCase();
if (!normalizedResolved.startsWith(normalizedPackagedDir)) {
  console.error(`FAIL: addon resolved to ${resolvedPath}, which is NOT under ${normalizedPackagedDir}.`);
  process.exit(1);
}
if (normalizedResolved.includes('node_modules')) {
  console.error(`FAIL: addon resolved through node_modules (${resolvedPath}) instead of the packaged copy.`);
  process.exit(1);
}
console.log('── Packaged addon resolution ──');
console.log('resolved module path (must be under dist/win-unpacked, never node_modules):', resolvedPath);

interface PackagedAddon {
  NativeScanTarget: { attach(pid: number): NativeTarget };
  ScanCancellationHandle: new () => unknown;
  ScanProgressHandle: new () => unknown;
}
interface NativeRegionShape {
  baseAddress: bigint; size: bigint; allocationBase: bigint; commitState: string; kind: string;
  isReadable: boolean; isWritable: boolean; isExecutable: boolean; isGuard: boolean; isNoaccess: boolean;
  rawProtect: number; rawType: number;
}
interface NativeTarget {
  detach(): void;
  enumerateRegions(): NativeRegionShape[];
  readRegionChunked(
    region: NativeRegionShape, chunkSizeBytes: bigint, overlapBytes: bigint,
    cancellation: unknown, progress: unknown,
  ): Promise<{
    chunks: Array<{ chunkBase: bigint; requestedSize: bigint; status: string; data: Buffer }>;
    completeness: { state: string; skipped?: CanonicalSkippedRange[]; failedReason?: string; atByte?: bigint };
  }>;
}

const addon = requireFromScratch(packagedAddonPath) as PackagedAddon;
if (typeof addon.NativeScanTarget !== 'function') {
  console.error('FAIL: packaged addon does not export a NativeScanTarget constructor.');
  process.exit(1);
}

// ── Spawn the real fixture ────────────────────────────────────────────────
const child = spawn(fixturePath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const fields: Record<string, string> = {};
const pendingWrites: Array<{ offset: number; resolve: () => void; reject: (e: Error) => void }> = [];
let ackBuffered = '';

function onAck(chunk: Buffer): void {
  ackBuffered += chunk.toString('utf8');
  let idx: number;
  while ((idx = ackBuffered.indexOf('\n')) !== -1) {
    const line = ackBuffered.slice(0, idx).trim();
    ackBuffered = ackBuffered.slice(idx + 1);
    const m = /^WROTE (\d+)$/.exec(line);
    const pending = pendingWrites.shift();
    if (!pending) continue;
    if (m && Number(m[1]) === pending.offset) pending.resolve();
    else pending.reject(new Error(`unexpected fixture response: ${line}`));
  }
}

await new Promise<void>((resolve, reject) => {
  let buffered = '';
  child.on('error', reject);
  const onData = (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, idx).trim();
      buffered = buffered.slice(idx + 1);
      if (line === 'READY') {
        child.stdout.off('data', onData);
        child.stdout.on('data', onAck);
        resolve();
        return;
      }
      const eq = line.indexOf('=');
      if (eq !== -1) fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
  };
  child.stdout.on('data', onData);
});

function writeFar(offset: number, leHex: string): Promise<void> {
  return new Promise((res, rej) => {
    pendingWrites.push({ offset, resolve: res, reject: rej });
    child.stdin.write(`writefar ${offset} ${leHex}\n`);
  });
}

let exitCode = 0;
try {
  const target = addon.NativeScanTarget.attach(child.pid!);
  const nativeRegions = target.enumerateRegions();
  const byBase = new Map<string, NativeRegionShape>(nativeRegions.map((r) => [r.baseAddress.toString(), r]));

  // A ScannerMemorySource whose reads go through the PACKAGED addon only.
  const source: ScannerMemorySource = {
    kind: 'native',
    // eslint-disable-next-line @typescript-eslint/require-await
    async enumerateRegions(): Promise<CanonicalMemoryRegion[]> {
      return nativeRegions.map((r) => ({
        baseAddress: r.baseAddress,
        size: r.size,
        isReadable: r.isReadable && !r.isGuard && !r.isNoaccess,
        isWritable: r.isWritable,
        isExecutable: r.isExecutable,
      }));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async enumerateModules() {
      // Not needed for this proof: the scan below is not module-scoped.
      return [];
    },
    async readRegion(region): Promise<CanonicalRegionReadOutcome> {
      const nativeRegion = byBase.get(region.baseAddress.toString());
      if (!nativeRegion) {
        return {
          backend: 'native',
          slices: [],
          completeness: {
            state: 'complete_with_skipped_regions',
            skipped: [{ baseAddress: region.baseAddress, size: region.size, reason: 'region_not_enumerated' }],
          },
          metrics: { regionsConsidered: 1, regionsRead: 0, regionsSkipped: 1, bytesRequested: 0n, bytesRead: 0n, elapsedMillis: 0n },
        };
      }
      const cancellation = new addon.ScanCancellationHandle();
      const progress = new addon.ScanProgressHandle();
      const outcome = await target.readRegionChunked(nativeRegion, 65536n, 7n, cancellation, progress);

      const slices: CanonicalRegionSlice[] = [];
      const skipped: CanonicalSkippedRange[] = [];
      let runBase: bigint | null = null;
      let runParts: Buffer[] = [];
      let runEnd = 0n;
      const flush = () => {
        if (runBase !== null && runParts.length > 0) slices.push({ baseAddress: runBase, data: Buffer.concat(runParts) });
        runBase = null; runParts = []; runEnd = 0n;
      };
      for (const chunk of outcome.chunks) {
        if (chunk.status !== 'success' || !chunk.data || chunk.data.length === 0) {
          flush();
          skipped.push({ baseAddress: chunk.chunkBase, size: chunk.requestedSize, reason: chunk.status });
          continue;
        }
        if (runBase === null) {
          runBase = chunk.chunkBase; runParts = [chunk.data]; runEnd = chunk.chunkBase + BigInt(chunk.data.length);
        } else if (chunk.chunkBase > runEnd) {
          flush();
          runBase = chunk.chunkBase; runParts = [chunk.data]; runEnd = chunk.chunkBase + BigInt(chunk.data.length);
        } else {
          const held = Number(runEnd - chunk.chunkBase);
          if (held < chunk.data.length) {
            runParts.push(chunk.data.subarray(held));
            runEnd = chunk.chunkBase + BigInt(chunk.data.length);
          }
        }
      }
      flush();
      return {
        backend: 'native',
        slices,
        completeness: skipped.length > 0 ? { state: 'complete_with_skipped_regions', skipped } : { state: 'complete' },
        metrics: { regionsConsidered: 1, regionsRead: 1, regionsSkipped: 0, bytesRequested: region.size, bytesRead: BigInt(slices.reduce((n, s) => n + s.data.length, 0)), elapsedMillis: 0n },
      };
    },
  };

  // Plant a 16-byte signature 6 MiB into the 8 MiB PATTERN_REGION — past the
  // legacy 1 MiB ceiling, and long enough to be unique under drift tolerance.
  const FAR_OFFSET = 6 * 1024 * 1024;
  await writeFar(FAR_OFFSET, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  const searchSignature = 'A1 B2 C3 D4 E5 F6 07 18 29 3A 4B 5C 6D 7E 8F 91'; // last byte drifted
  const expectedAddress = BigInt(fields.PATTERN_REGION_BASE) + BigInt(FAR_OFFSET);

  const outcome = await scanFuzzySignatureViaSource(source, searchSignature, { maxDistance: 1, maxEdits: 0 });

  console.log('── Packaged fuzzy AOB scan ──');
  console.log('fixture PID:', child.pid);
  console.log('planted at:', `0x${expectedAddress.toString(16)}`, `(${FAR_OFFSET} bytes into PATTERN_REGION — past the legacy 1 MiB ceiling)`);
  console.log('resolved  :', outcome.match ? `0x${outcome.match.address.toString(16)}` : 'null');
  console.log('distance  :', outcome.match?.distance, 'driftKind:', outcome.match?.driftKind, 'mode:', outcome.match?.mode);
  console.log('completeness:', outcome.completeness.state);

  if (!outcome.match || outcome.match.address !== expectedAddress) {
    console.error('FAIL: packaged fuzzy path did not resolve the planted drifted signature at its true address.');
    exitCode = 1;
  } else if (outcome.match.distance !== 1 || outcome.match.mode !== 'fuzzy') {
    console.error('FAIL: packaged fuzzy path resolved the address but not as a genuine drift-tolerant match.');
    exitCode = 1;
  } else {
    console.log('PASS: packaged fuzzy AOB resolution through the packaged native addon');
  }

  target.detach();
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
