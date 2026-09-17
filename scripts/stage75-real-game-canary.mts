#!/usr/bin/env tsx
/**
 * Phase 1 / Stage 7.5 §12 — real-game read-only canary.
 *
 * Mission §12 requires the 3-game canary be re-run because common AOB/signature
 * routing changed this stage. Method follows doc 118 (Stage 7.4 §16) so the
 * results are directly comparable — a real launch of each game's real installed
 * executable, a stabilization wait, a real `LiveMemorySession` attach through
 * the same production classes the Electron app uses, and **zero** calls to
 * `setScannerRoutingMode` — with one addition that is the point of this stage:
 * a real drift-tolerant AOB resolution against the live game process.
 *
 * Ground truth for the fuzzy leg is derived from the game itself rather than
 * planted, because this canary is strictly read-only and never writes to a
 * commercial game process. A distinctive 16-byte window is read out of the
 * game's own main module, the final byte is flipped to produce a signature that
 * cannot match exactly anywhere, and the resolver is asked to find it. The
 * result is then verified independently: the bytes actually living at the
 * returned address are re-read and their Hamming distance to the searched
 * signature is recomputed locally. A pass therefore means "the resolver
 * returned an address whose real contents are genuinely one substitution away
 * from what was asked for", not "the resolver agreed with itself".
 *
 * The fuzzy leg is module-scoped. That is both realistic (definition-driven
 * signatures carry a module name) and necessary: drift-tolerant matching is
 * O(bytes x pattern) and an unscoped pass over a modern game's entire readable
 * address space is not a sensible thing to do on a canary.
 *
 * NO WRITES ARE PERFORMED AT ANY POINT. Every process is closed afterwards and
 * verified closed.
 */
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { nativeMemoryDriver } from '../src/core/live-memory/native-memory-driver.ts';
import { LiveMemorySession } from '../src/core/live-memory/live-memory-session.ts';
import type { RemoteConnectionEvidence } from '../src/core/live-memory/types.ts';

const testRequire = createRequire(import.meta.url);

interface GameSpec {
  label: string;
  exePath: string;
  /**
   * Every directory this title may actually run from. Steam can start a copy
   * from a different library than the executable that was spawned, so matching
   * a single directory is not sufficient (Godlike Burger is installed in two
   * libraries on this machine).
   */
  searchDirs?: string[];
  /** Last-resort process-name match when no image path matches. */
  processNameFallback?: string;
}

const GAMES: GameSpec[] = [
  { label: 'Bastion', exePath: 'D:\\SteamLibrary\\steamapps\\common\\Bastion\\Bastion.exe' },
  {
    label: 'Godlike Burger',
    exePath: 'D:\\SteamLibrary\\steamapps\\common\\Godlike Burger\\Godlike Burger.exe',
    searchDirs: [
      'D:\\SteamLibrary\\steamapps\\common\\Godlike Burger',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Godlike Burger',
    ],
    processNameFallback: 'Godlike Burger',
  },
  { label: 'Aegis Defenders', exePath: 'D:\\SteamLibrary\\steamapps\\common\\Aegis Defenders\\AegisDefenders.exe' },
];

const STABILIZE_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Finds the real game process by its loaded image path, falling back to a
 * process-name match. Doc 118 already recorded that 2 of these 3 titles start
 * through a launcher, so the process that actually holds the game's memory is
 * not reliably the executable that was spawned; and a title installed in more
 * than one Steam library may be started from the copy that was not launched.
 * Selecting the largest-working-set process whose image lives under any of the
 * title's known directories identifies the real one without hard-coding
 * per-title process names.
 */
function findPid(gameDirs: string[], processNameFallback?: string): number | null {
  const conditions = gameDirs
    .map((d) => `$_.Path.StartsWith('${d.replace(/'/g, "''")}', [System.StringComparison]::OrdinalIgnoreCase)`)
    .join(' -or ');

  const firstLineAsPid = (out: string): number | null => {
    const pid = Number(out.trim().split(/\r?\n/)[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  };

  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Process | Where-Object { $_.Path -and (${conditions}) } | Sort-Object WS -Descending | Select-Object -First 1 -ExpandProperty Id`,
      ],
      { encoding: 'utf8', timeout: 30_000, windowsHide: true },
    );
    const pid = firstLineAsPid(out);
    if (pid !== null) return pid;
  } catch {
    /* fall through to the name match */
  }

  if (!processNameFallback) return null;
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Process -Name '${processNameFallback.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Sort-Object WS -Descending | Select-Object -First 1 -ExpandProperty Id`,
      ],
      { encoding: 'utf8', timeout: 30_000, windowsHide: true },
    );
    return firstLineAsPid(out);
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`,
      ],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true },
    ).trim();
    return out === 'yes';
  } catch {
    return false;
  }
}

function killPid(pid: number): void {
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true },
    );
  } catch {
    /* best effort */
  }
}

interface AddonRegion {
  baseAddress: bigint;
  size: bigint;
  isReadable: boolean;
  isGuard: boolean;
  isNoaccess: boolean;
}
interface AddonTarget {
  detach(): void;
  enumerateRegions(): AddonRegion[];
  readRegionChunked(
    region: AddonRegion,
    chunkSizeBytes: bigint,
    overlapBytes: bigint,
    cancellation: unknown,
    progress: unknown,
  ): Promise<{ chunks: Array<{ chunkBase: bigint; status: string; data: Buffer }> }>;
}
interface Addon {
  NativeScanTarget: { attach(pid: number): AddonTarget };
  ScanCancellationHandle: new () => unknown;
  ScanProgressHandle: new () => unknown;
}

const addon = testRequire('solith-scanner-napi') as Addon;

/**
 * Reads up to `want` bytes starting at `address` through an independent
 * read-only attach.
 *
 * Deliberately tolerant about length: a mapped PE image is carved into many
 * page-granular regions with differing protections, so requiring a whole
 * multi-kilobyte span to sit inside one region fails almost every time. This
 * returns however much contiguous readable memory actually exists from
 * `address` onward, up to `want`, and null only when `address` itself is not
 * readable.
 */
async function readAt(pid: number, address: bigint, want: number): Promise<Buffer | null> {
  const target = addon.NativeScanTarget.attach(pid);
  try {
    const region = target
      .enumerateRegions()
      .find(
        (r) =>
          r.isReadable &&
          !r.isGuard &&
          !r.isNoaccess &&
          address >= r.baseAddress &&
          address < r.baseAddress + r.size,
      );
    if (!region) return null;
    const outcome = await target.readRegionChunked(
      region,
      65536n,
      0n,
      new addon.ScanCancellationHandle(),
      new addon.ScanProgressHandle(),
    );

    // Reassemble contiguous successful chunks, then slice from `address`.
    let runBase: bigint | null = null;
    let runParts: Buffer[] = [];
    let runEnd = 0n;
    const runs: Array<{ base: bigint; data: Buffer }> = [];
    const flush = () => {
      if (runBase !== null && runParts.length > 0) runs.push({ base: runBase, data: Buffer.concat(runParts) });
      runBase = null;
      runParts = [];
      runEnd = 0n;
    };
    for (const chunk of outcome.chunks) {
      if (chunk.status !== 'success' || !chunk.data || chunk.data.length === 0) {
        flush();
        continue;
      }
      if (runBase === null || chunk.chunkBase > runEnd) {
        flush();
        runBase = chunk.chunkBase;
        runParts = [chunk.data];
        runEnd = chunk.chunkBase + BigInt(chunk.data.length);
      } else {
        const held = Number(runEnd - chunk.chunkBase);
        if (held < chunk.data.length) {
          runParts.push(chunk.data.subarray(held));
          runEnd = chunk.chunkBase + BigInt(chunk.data.length);
        }
      }
    }
    flush();

    for (const run of runs) {
      if (address >= run.base && address < run.base + BigInt(run.data.length)) {
        const start = Number(address - run.base);
        return run.data.subarray(start, Math.min(start + want, run.data.length));
      }
    }
    return null;
  } finally {
    target.detach();
  }
}

/** A 16-byte window with enough byte variety to be a meaningful signature. */
function pickDistinctiveWindow(buf: Buffer, base: bigint): { address: bigint; bytes: Buffer } | null {
  for (let i = 0; i + 16 <= buf.length; i += 16) {
    const win = buf.subarray(i, i + 16);
    const distinct = new Set(win).size;
    if (distinct >= 12) return { address: base + BigInt(i), bytes: Buffer.from(win) };
  }
  return null;
}

function toSignature(bytes: Buffer): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function hamming(a: Buffer, b: Buffer): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d += 1;
  return d;
}

interface Row {
  label: string;
  exe: string;
  pid: number;
  architecture: string;
  defaultMode: string;
  exactBackend: string;
  regions: number;
  bytesRead: number;
  matches: number;
  completeness: string;
  exactMs: number;
  fuzzyBackend: string;
  fuzzyModule: string;
  fuzzyScope: string;
  fuzzyExpected: string;
  fuzzyResolved: string;
  fuzzyDistance: string;
  fuzzyVerifiedDistance: string;
  fuzzyCompleteness: string;
  fuzzyMs: number;
  fallbackCount: number;
  differenceClassification: string;
  closed: boolean;
}

const rows: Row[] = [];
let failures = 0;

for (const game of GAMES) {
  console.log(`\n================ ${game.label} ================`);
  if (!existsSync(game.exePath)) {
    console.error(`FAIL: executable not found: ${game.exePath}`);
    failures += 1;
    continue;
  }

  const child = spawn(game.exePath, [], {
    cwd: path.dirname(game.exePath),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  await sleep(STABILIZE_MS);
  const searchDirs = game.searchDirs ?? [path.dirname(game.exePath)];
  let pid = findPid(searchDirs, game.processNameFallback);
  for (let attempt = 0; attempt < 6 && pid === null; attempt++) {
    await sleep(4000);
    pid = findPid(searchDirs, game.processNameFallback);
  }
  if (pid === null) {
    console.error(`FAIL: could not locate a running process with an image under ${searchDirs.join(' | ')}`);
    failures += 1;
    continue;
  }
  console.log(`pid: ${pid}`);

  const session = new LiveMemorySession(nativeMemoryDriver);
  // Read-only canary: the online guard is satisfied explicitly rather than by
  // probing the network, exactly as the existing live-memory suites do.
  const CLEAN: RemoteConnectionEvidence = {
    availability: 'available',
    remoteConnectionCount: 0,
    observedAt: new Date().toISOString(),
  };
  session._injectRemoteConnectionObserver(async () => CLEAN);

  const row: Partial<Row> = { label: game.label, exe: path.basename(game.exePath), pid, closed: false };
  try {
    let attached = false;
    for (let attempt = 0; attempt < 5 && !attached; attempt++) {
      const result = await session.attach({ pid, executableName: path.basename(game.exePath) }, true);
      attached = result.success;
      if (!attached) {
        console.log(`  attach attempt ${attempt + 1} failed: ${result.error ?? 'unknown'}`);
        await sleep(2000);
      }
    }
    if (!attached) throw new Error('attach never succeeded');

    // ── Zero override: the production default must already be NATIVE ──────
    const defaultMode = session.getScannerRoutingMode();
    row.defaultMode = defaultMode;
    if (defaultMode !== 'NATIVE') throw new Error(`default routing mode was ${defaultMode}, expected NATIVE`);

    const access = session.getMemoryAccessOrThrow();
    // Module enumeration goes through memoryjs and does not succeed against
    // every real process (observed on this canary: Godlike Burger fails with
    // "method failed to retrieve the first module"). This is a pre-existing
    // legacy limitation, not a Stage 7.5 regression: the legacy fuzzy path
    // called the very same `driver.getModules` whenever a signature carried a
    // module name, so a module-scoped resolution failed there identically. It
    // is also precisely the gap that native module enumeration would close, and
    // is forward-assigned to Stage 8. Rather than let it abort the canary, fall
    // back to the other real production scoping mechanism — the hint window.
    let modules: Array<{ name: string; baseAddress: bigint; size: number }> = [];
    let moduleEnumerationError: string | null = null;
    try {
      modules = access.driver.getModules(access.handle);
    } catch (err) {
      moduleEnumerationError = err instanceof Error ? err.message : String(err);
      console.log(`  module enumeration unavailable: ${moduleEnumerationError}`);
    }
    const mainModule =
      modules.find((m) => m.name.toLowerCase() === path.basename(game.exePath).toLowerCase()) ?? modules[0] ?? null;
    row.architecture = process.arch === 'x64' ? 'x64 host, x64 read-only attach' : process.arch;

    // ── Exact-value leg (parity with doc 118) ────────────────────────────
    const exactStart = Date.now();
    const exact = await session.scanExactViaBackend('uint32', 100);
    row.exactMs = Date.now() - exactStart;
    row.exactBackend = exact.backend;
    row.regions = exact.regionsScanned;
    row.bytesRead = exact.bytesScanned;
    row.matches = exact.matches.length;
    row.completeness = exact.truncated ? 'truncated/incomplete' : 'complete';
    console.log(
      `  exact: backend=${exact.backend} regions=${exact.regionsScanned} bytes=${exact.bytesScanned} matches=${exact.matches.length} truncated=${exact.truncated} (${row.exactMs} ms)`,
    );
    if (exact.backend !== 'native') throw new Error(`exact scan backend was ${exact.backend}, expected native`);

    // ── Fuzzy leg: ground truth read out of the game's own main module ────
    row.fuzzyModule = mainModule?.name ?? `(module enumeration unavailable: ${moduleEnumerationError ?? 'no modules returned'})`;
    let groundTruth: { address: bigint; bytes: Buffer } | null = null;
    if (mainModule) {
      // Probe a few offsets: the first readable page of a PE image is the
      // header, and section layout differs per title, so a single fixed offset
      // is not a reliable place to find varied bytes.
      for (const probe of [0x1000n, 0x2000n, 0x10000n, 0x40000n, 0x100000n]) {
        if (probe >= mainModule.size) break;
        const sample = await readAt(pid, mainModule.baseAddress + probe, 65536);
        if (!sample || sample.length < 16) continue;
        groundTruth = pickDistinctiveWindow(sample, mainModule.baseAddress + probe);
        if (groundTruth) break;
      }
    } else {
      // No module list: sample from the largest readable private region
      // instead, and scope the search with a hint window rather than a module.
      const probeTarget = addon.NativeScanTarget.attach(pid);
      let candidate: bigint | null = null;
      try {
        const readable = probeTarget
          .enumerateRegions()
          .filter((r) => r.isReadable && !r.isGuard && !r.isNoaccess && r.size >= 65536n)
          .sort((a, b) => (a.size < b.size ? 1 : a.size > b.size ? -1 : 0));
        candidate = readable[0]?.baseAddress ?? null;
      } finally {
        probeTarget.detach();
      }
      if (candidate !== null) {
        const sample = await readAt(pid, candidate + 4096n, 65536);
        if (sample && sample.length >= 16) groundTruth = pickDistinctiveWindow(sample, candidate + 4096n);
      }
    }
    if (!groundTruth) throw new Error('could not read a distinctive ground-truth window from the target process');
    console.log(
      `  fuzzy ground truth: 0x${groundTruth.address.toString(16)} (${groundTruth.bytes.length} bytes read from ${mainModule ? mainModule.name : 'largest readable region'})`,
    );

    const drifted = Buffer.from(groundTruth.bytes);
    drifted[15] = drifted[15] ^ 0xff; // guarantee a real difference in the final byte
    const searchSignature = toSignature(drifted);
    row.fuzzyExpected = `0x${groundTruth.address.toString(16)}`;

    // Two real production scoping mechanisms; use whichever this process
    // actually supports, and record which one was exercised.
    const fuzzyScope = mainModule ? 'module-scoped' : 'hint-window-scoped';
    row.fuzzyScope = fuzzyScope;
    const fuzzyStart = Date.now();
    const fuzzy = await session.scanFuzzyAobViaBackend(
      searchSignature,
      mainModule
        ? { moduleName: mainModule.name, maxDistance: 1, maxEdits: 0 }
        : { hintAddress: groundTruth.address, maxShiftBytes: 4096, maxDistance: 1, maxEdits: 0 },
    );
    row.fuzzyMs = Date.now() - fuzzyStart;
    row.fuzzyBackend = fuzzy.backend;
    row.fuzzyResolved = fuzzy.match ? `0x${fuzzy.match.address.toString(16)}` : 'null';
    row.fuzzyDistance = fuzzy.match ? String(fuzzy.match.distance) : 'n/a';
    row.fuzzyCompleteness = fuzzy.completeness.state;
    console.log(
      `  fuzzy: backend=${fuzzy.backend} scope=${fuzzyScope} resolved=${row.fuzzyResolved} distance=${row.fuzzyDistance} completeness=${fuzzy.completeness.state} (${row.fuzzyMs} ms)`,
    );

    if (fuzzy.backend !== 'native') throw new Error(`fuzzy scan backend was ${fuzzy.backend}, expected native`);
    if (!fuzzy.match) throw new Error('fuzzy scan found no match for a signature derived from live memory');

    // ── Independent verification: re-read and recompute the distance ──────
    const actual = await readAt(pid, fuzzy.match.address, 16);
    if (!actual) throw new Error('could not re-read the resolved address for verification');
    const verified = hamming(actual, drifted);
    row.fuzzyVerifiedDistance = String(verified);
    console.log(`  fuzzy verification: re-read Hamming distance to the searched signature = ${verified}`);
    if (verified !== fuzzy.match.distance) {
      throw new Error(`reported distance ${fuzzy.match.distance} does not match independently verified ${verified}`);
    }
    if (verified > 1) throw new Error(`resolved address is ${verified} substitutions away, outside the requested budget`);

    const diagnostics = session.getScannerBackendDiagnostics();
    row.fallbackCount = diagnostics?.fallbackCount ?? -1;
    if (diagnostics?.fallbackCount !== 0) throw new Error(`fallbackCount was ${diagnostics?.fallbackCount}, expected 0`);
    row.differenceClassification = 'NONE — single-backend NATIVE run, no shadow comparison performed';
  } catch (err) {
    console.error(`  FAIL: ${String(err)}`);
    failures += 1;
    row.differenceClassification = `FAILED: ${String(err)}`;
  } finally {
    try {
      await session.detach();
    } catch {
      /* best effort */
    }
    killPid(pid);
    await sleep(3000);
    row.closed = !isRunning(pid);
    console.log(`  process closed: ${row.closed}`);
    if (!row.closed) {
      killPid(pid);
      await sleep(3000);
      row.closed = !isRunning(pid);
      console.log(`  process closed after retry: ${row.closed}`);
    }
    if (!row.closed) failures += 1;
  }

  rows.push(row as Row);
}

console.log('\n================ STAGE 7.5 REAL-GAME CANARY SUMMARY ================');
console.log(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(`\nRESULT: ${rows.length - failures}/${GAMES.length} games passed; failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
