/**
 * Live Windows process identity for PID-reuse mitigation.
 * Queries OS process metadata independently of the attach handle.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface WindowsProcessIdentity {
  pid: number;
  executableName: string;
  executablePath: string | null;
  /** UTC ISO-8601 creation time when available. */
  startTimeIso: string | null;
}

function normalizePath(value: string): string {
  return path.resolve(value).toLowerCase();
}

/**
 * Best-effort identity lookup via PowerShell CIM.
 * Returns null when the PID does not exist or the query fails.
 */
export function queryWindowsProcessIdentity(pid: number): WindowsProcessIdentity | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform !== 'win32') return null;

  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
    `if (-not $p) { '' ; exit 0 }`,
    `$start = ''`,
    `try {`,
    `  $start = [System.Management.ManagementDateTimeConverter]::ToDateTime($p.CreationDate).ToUniversalTime().ToString('o')`,
    `} catch {}`,
    `$path = if ($p.ExecutablePath) { $p.ExecutablePath } else { '' }`,
    `$name = if ($p.Name) { $p.Name } else { '' }`,
    `Write-Output (($name) + [char]9 + ($path) + [char]9 + ($start))`,
  ].join('; ');

  try {
    const raw = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
    ).trim();
    if (!raw) return null;
    const [name, exePath, startTimeIso] = raw.split('\t');
    if (!name?.trim()) return null;
    return {
      pid,
      executableName: name.trim(),
      executablePath: exePath?.trim() ? path.resolve(exePath.trim()) : null,
      startTimeIso: startTimeIso?.trim() || null,
    };
  } catch {
    return null;
  }
}

export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizePath(a) === normalizePath(b);
}
