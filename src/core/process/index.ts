import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { CompatibilityProfile } from '../profiles/schema.js';

/**
 * Game-Running Detection
 *
 * Conservative, read-only process check. No injection, no memory manipulation,
 * no handle retention — just a simple question: is this game currently running?
 *
 * Strategy:
 * - Windows: single `tasklist` query for executable names
 * - macOS/Linux: `ps` command search
 * - Only matches registered executable names from profile
 * - Returns human-readable evidence
 *
 * Constraint: must be safe to call repeatedly without side effects.
 */

interface GameRunningCheck {
  running: boolean;
  evidence: string;
}

/**
 * Check if a game is currently running
 *
 * Uses process listing only (tasklist on Windows, ps on Unix).
 * Returns a conservative answer: true only if we find a clear match.
 *
 * Evidence string is human-readable for UI display.
 */
export function isGameRunning(profile: CompatibilityProfile): GameRunningCheck {
  const executableNames = profile.executableNames || [];

  if (!executableNames.length) {
    return {
      running: false,
      evidence: 'No executable names registered for this game',
    };
  }

  try {
    return checkProcessList(executableNames);
  } catch (err) {
    // If process check fails (permission, command not found), assume not running
    // Better safe than sorry — assume game is NOT running if we can't verify
    return {
      running: false,
      evidence: `Unable to verify (${String(err).slice(0, 50)}...); assuming not running`,
    };
  }
}

/**
 * Platform-specific process list check
 */
function checkProcessList(executableNames: string[]): GameRunningCheck {
  const osType = platform();

  if (osType === 'win32') {
    return checkWindowsProcessList(executableNames);
  } else if (osType === 'darwin') {
    return checkMacProcessList(executableNames);
  } else {
    return checkLinuxProcessList(executableNames);
  }
}

/**
 * Windows: tasklist /V /FO CSV
 * Parse CSV output and match executable names
 */
function checkWindowsProcessList(executableNames: string[]): GameRunningCheck {
  try {
    // Use tasklist to get current processes
    // Output format: "Image Name","PID","Session Name","Session Number","Memory Usage"
    const output = execSync('tasklist /V /FO CSV', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const lines = output.split('\n');
    const normalizedNames = executableNames.map(n => n.toLowerCase());

    for (const line of lines) {
      // Parse CSV (handle quoted fields)
      const match = line.match(/"([^"]+)"/);
      if (!match) continue;

      const imageName = match[1].toLowerCase();
      for (const name of normalizedNames) {
        // Match full name or without .exe
        const baseNameWithoutExt = name.replace(/\.exe$/i, '');
        if (imageName === name || imageName === `${baseNameWithoutExt}.exe` || imageName.startsWith(baseNameWithoutExt)) {
          return {
            running: true,
            evidence: `Found running process: ${match[1]}`,
          };
        }
      }
    }

    return {
      running: false,
      evidence: `Process not found in tasklist (checked: ${executableNames.join(', ')})`,
    };
  } catch (err) {
    throw new Error(`tasklist check failed: ${String(err)}`);
  }
}

/**
 * macOS: ps aux | grep
 * Match process by executable name
 */
function checkMacProcessList(executableNames: string[]): GameRunningCheck {
  try {
    const normalizedNames = executableNames.map(n => n.toLowerCase());

    for (const name of normalizedNames) {
      // Avoid matching the grep process itself with explicit filter
      const baseName = name.replace(/\.exe$/i, '');
      const output = execSync(`ps aux | grep -i "${baseName}" | grep -v grep`, {
        encoding: 'utf-8',
        timeout: 5000,
      });

      if (output.trim().length > 0) {
        return {
          running: true,
          evidence: `Found running process: ${baseName}`,
        };
      }
    }

    return {
      running: false,
      evidence: `Process not found (checked: ${executableNames.join(', ')})`,
    };
  } catch (err) {
    // grep returns exit code 1 if no match found (not an error)
    return {
      running: false,
      evidence: `Process check completed; not found`,
    };
  }
}

/**
 * Linux: ps aux | grep
 * Match process by executable name
 */
function checkLinuxProcessList(executableNames: string[]): GameRunningCheck {
  try {
    const normalizedNames = executableNames.map(n => n.toLowerCase());

    for (const name of normalizedNames) {
      const baseName = name.replace(/\.exe$/i, '');
      const output = execSync(`ps aux | grep -i "${baseName}" | grep -v grep`, {
        encoding: 'utf-8',
        timeout: 5000,
      });

      if (output.trim().length > 0) {
        return {
          running: true,
          evidence: `Found running process: ${baseName}`,
        };
      }
    }

    return {
      running: false,
      evidence: `Process not found (checked: ${executableNames.join(', ')})`,
    };
  } catch (err) {
    // grep returns exit code 1 if no match found (not an error)
    return {
      running: false,
      evidence: `Process check completed; not found`,
    };
  }
}
