import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import type { CompatibilityProfile } from '../profiles/schema.js';
import { systemBinaryPath } from '../safety/system-binary.js';

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
    // execFileSync (array args, no shell) — no command/shell interpolation, only fixed literal args.
    //
    // Root-caused via a real hostile-fix investigation (SOLITH Phase 3.2
    // Owner Follow-up Mission 3), not assumed: `/V` (verbose) makes
    // `tasklist` enumerate per-process module/service detail, which measured
    // ~8s on real hardware under ordinary (non-adversarial) load — already
    // past the previous 5000ms timeout on its own, with no test concurrency
    // or contention involved. That made `tests/process.test.ts`'s idempotency
    // check flaky (a timeout mid-run silently falls back to "assuming not
    // running" with different evidence text than a completed call), but the
    // SAME timeout sits in front of every real caller of `isGameRunning`, so
    // this was a genuine production correctness bug, not merely a test
    // artifact: a real running game could be reported as not-running under
    // ordinary system load. 15000ms leaves real margin above the measured
    // ~8s baseline.
    const output = execFileSync(systemBinaryPath('tasklist.exe'), ['/V', '/FO', 'CSV'], {
      encoding: 'utf-8',
      timeout: 15000,
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
  return checkUnixProcessListViaPs(executableNames);
}

/**
 * Linux: ps aux | grep
 * Match process by executable name
 */
function checkLinuxProcessList(executableNames: string[]): GameRunningCheck {
  return checkUnixProcessListViaPs(executableNames);
}

/**
 * Shared macOS/Linux path. Fixed literal `ps aux` invocation only (execFileSync,
 * array args, no shell) — matching is done in JS against the captured output,
 * never by interpolating the renderer-settable executable name into a shell
 * command (the prior `ps aux | grep -i "${baseName}"` form allowed shell/command
 * injection via a crafted profile.executableNames entry containing `"`/`;`/`$()`).
 */
function checkUnixProcessListViaPs(executableNames: string[]): GameRunningCheck {
  try {
    const normalizedNames = executableNames.map((n) => n.toLowerCase().replace(/\.exe$/i, ''));
    const output = execFileSync('ps', ['aux'], { encoding: 'utf-8', timeout: 5000 });
    const lines = output.split('\n').filter((line) => line.trim().length > 0);

    for (const baseName of normalizedNames) {
      const match = lines.find((line) => line.toLowerCase().includes(baseName));
      if (match) {
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
    return {
      running: false,
      evidence: `Process check completed; not found`,
    };
  }
}
