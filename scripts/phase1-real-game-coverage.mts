#!/usr/bin/env tsx
/**
 * Phase 1 final closure §15-§17 — real-game scan coverage measurement.
 *
 * ROADMAP line 281 asks for "real-game scan coverage measured against at least
 * one of the 7 curated titles (Phase 12's roster) with a recorded, honest
 * coverage percentage — not a synthetic-fixture-only claim".
 *
 * Prior Phase 1 docs recorded this as unsatisfiable because Stardew Valley was
 * "confirmed not installed". That conclusion came from searching C: and G:
 * only. Stardew Valley is installed, on Z:, along with four other curated
 * titles — so the requirement is satisfiable exactly as written, against the
 * very title doc 10's exit gate names, with no substitution and no waiver.
 *
 * Method: launch the real installed executable, wait for it to stabilize,
 * attach read-only through the same production `LiveMemorySession` the Electron
 * app uses, run a real exact scan on the DEFAULT backend (NATIVE — this script
 * never calls `setScannerRoutingMode`), and read coverage out of the canonical
 * metrics the backend reports.
 *
 * Two percentages are reported, because they answer different questions and
 * collapsing them is how a scanner ends up claiming 100% of a process it barely
 * read:
 *
 *     process coverage% = bytesRead / eligibleBytes     * 100
 *     attempted read %  = bytesRead / bytesRequested    * 100
 *
 * `eligibleBytes` is the total size of every region in the target that the
 * scanner's own eligibility predicate accepts — readable, not a guard page, not
 * PAGE_NOACCESS — read through the same `enumerateRegions()` the native backend
 * uses, so the denominator is the scanner's definition of eligible rather than
 * one invented here. It is also the denominator Audit 2 used ("42.1 MB of
 * 893 MiB", 4.5%, on this same title), so the numbers are directly comparable.
 *
 * `bytesRequested` counts only what the scan attempted AFTER the native core
 * applied its own per-region policy exclusions, so the attempted read rate can
 * legitimately be 100% while process coverage is not. The first run of this
 * harness caught exactly that: Stardew Valley reported 100% next to
 * `CompleteWithSkippedRegions(1 [... policy_excluded])`, and the §16 truth
 * check flagged it. That was not a scanner defect — it was this script
 * measuring against the wrong denominator, and the check is what found it.
 *
 * READ-ONLY. No writes are performed at any point. Every launched process is
 * closed afterwards and verified closed.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { nativeMemoryDriver } from '../src/core/live-memory/native-memory-driver.ts';
import { LiveMemorySession } from '../src/core/live-memory/live-memory-session.ts';
import type { CanonicalCompleteness } from '../src/core/live-memory/scanner-backend.ts';

const scriptRequire = createRequire(import.meta.url);

interface TitleSpec {
  label: string;
  /** True when this title is on the roadmap's 7 curated flagship roster. */
  curated: boolean;
  family: string;
  exePath: string;
  /** Every directory this title may actually run from (Steam multi-library). */
  searchDirs?: string[];
  processNameFallback?: string;
}

const TITLES: TitleSpec[] = [
  // ---- Curated flagship roster (ROADMAP line 558) ----
  {
    label: 'Stardew Valley',
    curated: true,
    family: 'XNA/MonoGame',
    exePath: 'Z:\\SteamLibrary\\steamapps\\common\\Stardew Valley\\Stardew Valley.exe',
    processNameFallback: 'Stardew Valley',
  },
  {
    label: 'DREDGE',
    curated: true,
    family: 'Unity',
    exePath: 'Z:\\SteamLibrary\\steamapps\\common\\DREDGE\\DREDGE.exe',
    searchDirs: [
      'Z:\\SteamLibrary\\steamapps\\common\\DREDGE',
      'D:\\SteamLibrary\\steamapps\\common\\DREDGE',
    ],
    processNameFallback: 'DREDGE',
  },
  // ---- Previously-canaried titles, kept for continuity with doc 127 ----
  {
    label: 'Bastion',
    curated: false,
    family: 'XNA',
    exePath: 'D:\\SteamLibrary\\steamapps\\common\\Bastion\\Bastion.exe',
  },
  {
    label: 'Godlike Burger',
    curated: false,
    family: 'Unity',
    exePath: 'D:\\SteamLibrary\\steamapps\\common\\Godlike Burger\\Godlike Burger.exe',
    searchDirs: [
      'D:\\SteamLibrary\\steamapps\\common\\Godlike Burger',
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Godlike Burger',
    ],
    processNameFallback: 'Godlike Burger',
  },
  {
    label: 'Aegis Defenders',
    curated: false,
    family: 'Unity',
    exePath: 'D:\\SteamLibrary\\steamapps\\common\\Aegis Defenders\\AegisDefenders.exe',
  },
];

const STABILIZE_MS = 25_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ps(command: string, timeout = 30_000): string {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
}

/** Largest-working-set process whose loaded image lives under one of `dirs`. */
function findPid(dirs: string[], processNameFallback?: string): number | null {
  const conditions = dirs
    .map((d) => `$_.Path.StartsWith('${d.replace(/'/g, "''")}', [System.StringComparison]::OrdinalIgnoreCase)`)
    .join(' -or ');

  const firstLineAsPid = (out: string): number | null => {
    const pid = Number(out.trim().split(/\r?\n/)[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  };

  try {
    const pid = firstLineAsPid(
      ps(
        'Get-Process | Where-Object { $_.Path -and (' +
          conditions +
          ') } | Sort-Object WS -Descending | Select-Object -First 1 -ExpandProperty Id',
      ),
    );
    if (pid !== null) return pid;
  } catch {
    /* fall through to the name match */
  }

  if (!processNameFallback) return null;
  try {
    return firstLineAsPid(
      ps(
        "Get-Process -Name '" +
          processNameFallback.replace(/'/g, "''") +
          "' -ErrorAction SilentlyContinue | Sort-Object WS -Descending | Select-Object -First 1 -ExpandProperty Id",
      ),
    );
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    return ps('if (Get-Process -Id ' + pid + " -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }", 20_000).trim() === 'yes';
  } catch {
    return false;
  }
}

function killPid(pid: number): void {
  try {
    ps('Stop-Process -Id ' + pid + ' -Force -ErrorAction SilentlyContinue', 20_000);
  } catch {
    /* best effort */
  }
}

function executablePath(pid: number): string {
  try {
    return ps('(Get-CimInstance Win32_Process -Filter "ProcessId = ' + pid + '").ExecutablePath', 20_000).trim();
  } catch {
    return '';
  }
}

interface EligibleRegionSummary {
  regions: number;
  bytes: bigint;
}

/**
 * Total bytes of memory in the target that the scanner's own eligibility
 * predicate accepts. Deliberately read through the same addon entry point and
 * the same predicate the native backend applies (see `scanner-backend-native.ts`
 * `exactScan`), so this is the scanner's definition of "eligible" rather than a
 * second opinion about it.
 */
function measureEligible(pid: number): EligibleRegionSummary {
  const addon = scriptRequire('solith-scanner-napi') as {
    NativeScanTarget: {
      attach(pid: number): {
        detach(): void;
        enumerateRegions(): Array<{ size: bigint; isReadable: boolean; isGuard: boolean; isNoaccess: boolean }>;
      };
    };
  };
  const target = addon.NativeScanTarget.attach(pid);
  try {
    const eligible = target.enumerateRegions().filter((r) => r.isReadable && !r.isGuard && !r.isNoaccess);
    return { regions: eligible.length, bytes: eligible.reduce((sum, r) => sum + r.size, 0n) };
  } finally {
    target.detach();
  }
}

function describeCompleteness(c: CanonicalCompleteness): string {
  switch (c.state) {
    case 'complete':
      return 'Complete';
    case 'complete_with_skipped_regions': {
      const detail = c.skipped
        .slice(0, 3)
        .map((r) => '0x' + r.baseAddress.toString(16) + '+' + r.size + ':' + r.reason)
        .join(', ');
      return 'CompleteWithSkippedRegions(' + c.skipped.length + (detail ? ' [' + detail + ']' : '') + ')';
    }
    case 'cancelled':
      return 'Cancelled(atByte=' + c.atByte + ')';
    case 'process_exited':
      return 'ProcessExited(atByte=' + c.atByte + ')';
    case 'resource_limit':
      return 'ResourceLimit(atByte=' + c.atByte + ')';
    case 'failed':
      return 'Failed(' + c.reason + ')';
  }
}

interface CoverageRow {
  label: string;
  curated: boolean;
  family: string;
  exe: string;
  pid: number;
  arch: string;
  backend: string;
  eligibleRegions: number;
  consideredRegions: number;
  regionsRead: number;
  regionsSkipped: number;
  eligibleBytes: bigint;
  attemptedBytes: bigint;
  readBytes: bigint;
  skippedBytes: bigint;
  coveragePercent: number;
  attemptedReadPercent: number;
  completeness: string;
  completenessState: CanonicalCompleteness['state'];
  durationMs: number;
  matches: number;
  truthOk: boolean;
  truthNote: string;
}

/**
 * §16 — the coverage number and the completeness state have to tell the same
 * story. Checked here rather than merely described, because "100% coverage"
 * printed next to "skipped eligible bytes" is precisely the kind of internally
 * inconsistent claim this phase exists to stop producing.
 */
function checkCoverageTruth(row: Omit<CoverageRow, 'truthOk' | 'truthNote'>): { truthOk: boolean; truthNote: string } {
  const problems: string[] = [];

  if (row.coveragePercent >= 100 && row.skippedBytes > 0n) {
    problems.push('reports full process coverage while also reporting skipped eligible bytes');
  }
  if (row.coveragePercent >= 100 && row.completenessState !== 'complete') {
    problems.push('reports full process coverage but completeness is ' + row.completeness);
  }
  // `complete` means nothing was left out at all, so anything short of full
  // coverage contradicts it. `complete_with_skipped_regions` is the honest
  // state for partial coverage and is not a contradiction.
  if (row.coveragePercent < 100 && row.completenessState === 'complete') {
    problems.push('reports ' + row.coveragePercent.toFixed(2) + '% process coverage but claims Complete');
  }
  if (row.readBytes > row.eligibleBytes) {
    problems.push('read more bytes than the target reports as eligible');
  }
  if (row.attemptedBytes > row.eligibleBytes) {
    problems.push('attempted more bytes than the target reports as eligible');
  }
  if (row.regionsRead + row.regionsSkipped !== row.consideredRegions) {
    problems.push(
      'region accounting does not balance: ' +
        row.regionsRead +
        ' read + ' +
        row.regionsSkipped +
        ' skipped != ' +
        row.consideredRegions +
        ' considered',
    );
  }

  return problems.length === 0
    ? { truthOk: true, truthNote: 'coverage and completeness agree' }
    : { truthOk: false, truthNote: problems.join('; ') };
}

type MeasureOutcome = CoverageRow | { label: string; error: string };

async function measure(spec: TitleSpec): Promise<MeasureOutcome> {
  if (!existsSync(spec.exePath)) {
    return { label: spec.label, error: 'executable not found: ' + spec.exePath };
  }

  const dirs = spec.searchDirs ?? [path.dirname(spec.exePath)];
  const child = spawn(spec.exePath, [], {
    cwd: path.dirname(spec.exePath),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  let pid: number | null = null;
  try {
    await sleep(STABILIZE_MS);
    pid = findPid(dirs, spec.processNameFallback);
    if (pid === null) return { label: spec.label, error: 'game process not found after launch' };

    const session = new LiveMemorySession(nativeMemoryDriver);
    const attach = await session.attach({ pid, executableName: path.basename(spec.exePath) }, true);
    if (!attach.success) {
      return { label: spec.label, error: 'attach failed: ' + JSON.stringify(attach) };
    }

    // Measured BEFORE the scan, so the denominator is the address space that
    // was actually there to be covered, not whatever survived the scan.
    const eligible = measureEligible(pid);

    // A real production exact scan on the DEFAULT backend. No routing override
    // anywhere in this script. The target value is irrelevant to coverage —
    // what is measured is how much of the process the scan could read — so a
    // plain int32 sentinel is used and the match count is recorded only as a
    // sanity signal.
    const started = Date.now();
    const result = await session.scanExactViaBackend('int32', 1_000_000);
    const durationMs = Date.now() - started;

    const eligibleBytes = eligible.bytes;
    const attemptedBytes = result.metrics.bytesRequested;
    const readBytes = result.metrics.bytesRead;
    const skippedBytes = eligibleBytes > readBytes ? eligibleBytes - readBytes : 0n;
    const pct = (num: bigint, den: bigint) => (den === 0n ? 0 : Number((num * 1_000_000n) / den) / 10_000);

    const exe = executablePath(pid);
    const base = {
      label: spec.label,
      curated: spec.curated,
      family: spec.family,
      exe: exe.length > 0 ? path.basename(exe) : path.basename(spec.exePath),
      pid,
      arch: process.arch === 'x64' ? 'x64 host; 64-bit read path' : process.arch,
      backend: result.backend,
      eligibleRegions: eligible.regions,
      consideredRegions: result.metrics.regionsConsidered,
      regionsRead: result.metrics.regionsRead,
      regionsSkipped: result.metrics.regionsSkipped,
      eligibleBytes,
      attemptedBytes,
      readBytes,
      skippedBytes,
      coveragePercent: pct(readBytes, eligibleBytes),
      attemptedReadPercent: pct(readBytes, attemptedBytes),
      completeness: describeCompleteness(result.completeness),
      completenessState: result.completeness.state,
      durationMs,
      matches: result.matches.length,
    };

    session.destroy?.();
    return { ...base, ...checkCoverageTruth(base) };
  } finally {
    if (pid !== null) {
      killPid(pid);
      await sleep(2_000);
      if (isRunning(pid)) {
        killPid(pid);
        await sleep(2_000);
      }
    }
    try {
      if (child.pid && isRunning(child.pid)) killPid(child.pid);
    } catch {
      /* best effort */
    }
  }
}

function fmtBytes(n: bigint): string {
  return n + ' (' + (Number(n) / (1024 * 1024)).toFixed(1) + ' MiB)';
}

async function main(): Promise<void> {
  const onlyCurated = process.argv.includes('--curated-only');
  const titles = onlyCurated ? TITLES.filter((t) => t.curated) : TITLES;

  console.log('SOLITH Phase 1 — real-game scan coverage');
  console.log('titles: ' + titles.length + '  backend: DEFAULT (no routing override)  mode: READ-ONLY');
  console.log('');

  const rows: CoverageRow[] = [];
  const failures: Array<{ label: string; error: string }> = [];

  for (const spec of titles) {
    console.log('--- ' + spec.label + ' ---');
    const outcome = await measure(spec);
    if ('error' in outcome) {
      console.log('  FAILED: ' + outcome.error);
      failures.push(outcome);
      console.log('');
      continue;
    }
    rows.push(outcome);
    console.log('  curated roster   : ' + (outcome.curated ? 'YES' : 'no') + ' (' + outcome.family + ')');
    console.log('  exe / pid / arch : ' + outcome.exe + ' / ' + outcome.pid + ' / ' + outcome.arch);
    console.log('  backend          : ' + outcome.backend);
    console.log(
      '  regions          : eligible ' +
        outcome.eligibleRegions +
        '  considered ' +
        outcome.consideredRegions +
        '  read ' +
        outcome.regionsRead +
        '  skipped ' +
        outcome.regionsSkipped,
    );
    console.log('  eligible bytes   : ' + fmtBytes(outcome.eligibleBytes));
    console.log('  attempted bytes  : ' + fmtBytes(outcome.attemptedBytes));
    console.log('  read bytes       : ' + fmtBytes(outcome.readBytes));
    console.log('  skipped bytes    : ' + fmtBytes(outcome.skippedBytes));
    console.log('  PROCESS COVERAGE : ' + outcome.coveragePercent.toFixed(2) + '%   (read / eligible)');
    console.log('  attempted read % : ' + outcome.attemptedReadPercent.toFixed(2) + '%   (read / attempted)');
    console.log('  completeness     : ' + outcome.completeness);
    console.log('  duration         : ' + outcome.durationMs + ' ms   matches: ' + outcome.matches);
    console.log('  coverage truth   : ' + (outcome.truthOk ? 'OK' : 'VIOLATION') + ' — ' + outcome.truthNote);
    console.log('');
  }

  console.log('=== SUMMARY ===');
  for (const r of rows) {
    console.log(
      r.label.padEnd(18) +
        (r.curated ? 'CURATED ' : '        ') +
        r.coveragePercent.toFixed(2).padStart(7) +
        '%  ' +
        r.completenessState.padEnd(32) +
        r.backend,
    );
  }
  for (const f of failures) console.log(f.label.padEnd(18) + 'FAILED — ' + f.error);

  const curatedRows = rows.filter((r) => r.curated);
  const truthViolations = rows.filter((r) => !r.truthOk);
  const satisfied = curatedRows.length >= 1 && truthViolations.length === 0;

  console.log('');
  console.log('curated titles measured  : ' + curatedRows.length);
  console.log('coverage truth violations: ' + truthViolations.length);
  console.log(
    'ROADMAP line 281 (>=1 curated title with a recorded, honest coverage percentage): ' +
      (satisfied ? 'SATISFIED' : 'NOT SATISFIED'),
  );

  if (!satisfied) process.exitCode = 1;
}

await main();
