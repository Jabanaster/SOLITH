/**
 * Live Windows process identity for PID-reuse mitigation.
 * Fail-closed for destructive ops: missing required metadata is an error.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface WindowsProcessIdentity {
  pid: number;
  executableName: string;
  executablePath: string;
  /** UTC ISO-8601 creation time. */
  startTimeIso: string;
  volumeSerialNumber: string | null;
  fileIndex: string | null;
  exeSha256: string | null;
}

export interface AttachedProcessIdentity {
  pid: number;
  executableName: string;
  executablePath: string;
  startTime: string;
  volumeSerialNumber?: string;
  fileIndex?: string;
  exeSha256?: string;
}

function normalizePath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function hashFileSha256(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

// Gate 2.1: narrow test-only seam so the packaged lifecycle harness can
// certify PID-reuse/identity-mismatch rejection without needing to force
// real OS PID recycling (which cannot be reproduced deterministically).
// Unavailable unless SOLITH_TEST_BUILD=1 is set in the process env — normal
// packaged launches never set this, so the setter throws and the map stays
// undefined, meaning queryWindowsProcessIdentity always takes the real path.
const IS_TEST_BUILD = process.env.SOLITH_TEST_BUILD === '1';
const testIdentityOverrides = IS_TEST_BUILD
  ? new Map<number, WindowsProcessIdentity | null>()
  : undefined;

export function __setTestProcessIdentityOverride(
  pid: number,
  identity: WindowsProcessIdentity | null,
): void {
  if (!testIdentityOverrides) {
    throw new Error('__setTestProcessIdentityOverride is only available when SOLITH_TEST_BUILD=1.');
  }
  testIdentityOverrides.set(pid, identity);
}

export function __clearTestProcessIdentityOverrides(): void {
  if (!testIdentityOverrides) {
    throw new Error('__clearTestProcessIdentityOverrides is only available when SOLITH_TEST_BUILD=1.');
  }
  testIdentityOverrides.clear();
}

if (IS_TEST_BUILD) {
  (globalThis as Record<string, unknown>).__solithSetTestProcessIdentityOverride =
    __setTestProcessIdentityOverride;
  (globalThis as Record<string, unknown>).__solithClearTestProcessIdentityOverrides =
    __clearTestProcessIdentityOverrides;
}

/**
 * Query live OS identity. Returns null only when the PID does not exist.
 * Missing path/creation time yields an incomplete identity object that
 * callers must reject for destructive operations.
 */
export function queryWindowsProcessIdentity(pid: number): WindowsProcessIdentity | null {
  if (testIdentityOverrides?.has(pid)) return testIdentityOverrides.get(pid) ?? null;
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform !== 'win32') return null;

  // Core identity first (path + creation time). Avoid Get-Volume — it can hang and
  // fail the entire query, which incorrectly fail-closes attach when path/start exist.
  const coreScript = [
    `$ErrorActionPreference = 'Stop'`,
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
    `if (-not $p) { '' ; exit 0 }`,
    `$start = ''`,
    `try {`,
    `  if ($p.CreationDate -is [datetime]) { $start = ([datetime]$p.CreationDate).ToUniversalTime().ToString('o') }`,
    `  elseif ($p.CreationDate) { $start = [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$p.CreationDate).ToUniversalTime().ToString('o') }`,
    `} catch {}`,
    `if (-not $start) { try { $start = (Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o') } catch {} }`,
    `$path = if ($p.ExecutablePath) { $p.ExecutablePath } else { '' }`,
    `$name = if ($p.Name) { $p.Name } else { '' }`,
    `Write-Output (($name) + [char]9 + ($path) + [char]9 + ($start))`,
  ].join('; ');

  try {
    const raw = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', coreScript],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
    ).trim();
    if (!raw) return null;
    const [name, exePath, startTimeIso] = raw.split('\t');
    if (!name?.trim()) return null;
    const resolvedPath = exePath?.trim() ? path.resolve(exePath.trim()) : '';

    let volumeSerialNumber: string | null = null;
    let fileIndex: string | null = null;
    if (resolvedPath) {
      const enrichScript = [
        `$ErrorActionPreference = 'Continue'`,
        `$path = ${JSON.stringify(resolvedPath)}`,
        `$vol = ''`,
        `$fidx = ''`,
        `try {`,
        `  $root = [System.IO.Path]::GetPathRoot($path)`,
        `  if ($root) {`,
        `    $letter = $root.Substring(0,1)`,
        `    $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $letter + ":'") -ErrorAction SilentlyContinue`,
        `    if ($disk -and $disk.VolumeSerialNumber) { $vol = [string]$disk.VolumeSerialNumber }`,
        `  }`,
        `} catch {}`,
        `try {`,
        `  $out = & fsutil file queryfileid $path 2>$null`,
        `  if ($out) { $fidx = (($out | Out-String).Trim() -replace '\\s+',' ') }`,
        `} catch {}`,
        `Write-Output (($vol) + [char]9 + ($fidx))`,
      ].join('; ');
      try {
        const enrichRaw = execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', enrichScript],
          { encoding: 'utf8', timeout: 3_000, windowsHide: true },
        ).trim();
        const [vol, fidx] = enrichRaw.split('\t');
        volumeSerialNumber = vol?.trim() || null;
        fileIndex = fidx?.trim() || null;
      } catch {
        // Optional enrichment — never erase core path/start identity.
      }
    }

    return {
      pid,
      executableName: name.trim(),
      executablePath: resolvedPath,
      startTimeIso: startTimeIso?.trim() || '',
      volumeSerialNumber,
      fileIndex,
      exeSha256: resolvedPath ? hashFileSha256(resolvedPath) : null,
    };
  } catch {
    return null;
  }
}

export function isCompleteProcessIdentity(
  identity: Pick<WindowsProcessIdentity, 'executableName' | 'executablePath' | 'startTimeIso'>,
): boolean {
  return Boolean(
    identity.executableName?.trim() &&
      identity.executablePath?.trim() &&
      identity.startTimeIso?.trim() &&
      !Number.isNaN(Date.parse(identity.startTimeIso)),
  );
}

/**
 * Fail-closed comparison for destructive confirm.
 * Missing required live or expected metadata → reject (no silent downgrade).
 */
export function compareProcessIdentity(
  expected: AttachedProcessIdentity,
  live: WindowsProcessIdentity | null,
): string | null {
  if (!live) {
    return 'Unable to re-read live process identity (process may have exited).';
  }
  if (!isCompleteProcessIdentity(live)) {
    return 'Live process identity is incomplete (path or creation time unavailable); failing closed.';
  }
  if (!expected.executablePath?.trim() || !expected.startTime?.trim()) {
    return 'Attached session is missing required process path or creation time; failing closed.';
  }
  if (live.pid !== expected.pid) {
    return `Live PID ${live.pid} does not match attached PID ${expected.pid}.`;
  }
  if (live.executableName.toLowerCase() !== expected.executableName.toLowerCase()) {
    return `Attached process identity mismatch: expected ${expected.executableName}, found ${live.executableName}.`;
  }
  if (normalizePath(live.executablePath) !== normalizePath(expected.executablePath)) {
    return `Attached process path mismatch: expected ${expected.executablePath}, found ${live.executablePath}.`;
  }
  if (Date.parse(live.startTimeIso) !== Date.parse(expected.startTime)) {
    return 'Attached process creation time mismatch (possible PID reuse).';
  }
  if (expected.volumeSerialNumber) {
    if (!live.volumeSerialNumber) {
      return 'Unable to verify volume serial number; failing closed.';
    }
    if (live.volumeSerialNumber !== expected.volumeSerialNumber) {
      return 'Attached process volume serial mismatch (possible PID reuse).';
    }
  }
  if (expected.fileIndex) {
    if (!live.fileIndex) {
      return 'Unable to verify file index; failing closed.';
    }
    if (live.fileIndex !== expected.fileIndex) {
      return 'Attached process file index mismatch (possible PID reuse).';
    }
  }
  if (expected.exeSha256) {
    if (!live.exeSha256) {
      return 'Unable to re-hash attached executable; failing closed.';
    }
    if (live.exeSha256.toLowerCase() !== expected.exeSha256.toLowerCase()) {
      return 'Attached executable hash changed since attach; failing closed.';
    }
  }
  return null;
}

export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizePath(a) === normalizePath(b);
}

// Gate 2.1: expose the two read-only identity functions on globalThis too
// (in addition to the module export) so the packaged lifecycle harness can
// reach them via electronApp.evaluate — Electron's utility-script evaluation
// context does not support dynamic import(). Read-only, no new behavior;
// still gated behind SOLITH_TEST_BUILD=1 and unreachable from any renderer.
if (IS_TEST_BUILD) {
  (globalThis as Record<string, unknown>).__solithQueryWindowsProcessIdentity = queryWindowsProcessIdentity;
  (globalThis as Record<string, unknown>).__solithCompareProcessIdentity = compareProcessIdentity;
}
