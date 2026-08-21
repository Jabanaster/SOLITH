import path from 'node:path';

/**
 * Resolves a Windows system binary by absolute path under System32 rather
 * than trusting PATH resolution. PATH order is not a trust boundary — a
 * same-named executable earlier on PATH (a different `whoami.exe`,
 * `powershell.exe`, `reg.exe`, or `tasklist.exe`, for example) would
 * otherwise run instead of the real system binary. Originally added for
 * `whoami.exe`/`icacls.exe` in electron/gamebar-transport.ts (Phase 6); moved
 * here (Phase 7) so every bare-system-utility call site across the codebase
 * can share one resolver instead of each rolling its own.
 */
export function systemBinaryPath(name: string): string {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(systemRoot, 'System32', name);
}

/**
 * Windows PowerShell 5.1 lives one level deeper than the other System32
 * utilities this module resolves (`System32\WindowsPowerShell\v1.0\`), so it
 * gets its own resolver rather than being passed through systemBinaryPath.
 */
export function systemPowerShellPath(): string {
  return systemBinaryPath(path.join('WindowsPowerShell', 'v1.0', 'powershell.exe'));
}
