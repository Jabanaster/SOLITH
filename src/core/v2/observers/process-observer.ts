import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { ProcessObservationResult, ProcessIdentity } from '../lifecycle/types.js';

/**
 * Read-only process observer.
 *
 * Observes whether the configured game executable is currently running.
 * Returns a stable ProcessIdentity including start time so callers can
 * detect PID reuse (same PID, different creation time = new process).
 *
 * No memory access. No module enumeration. No handle retention.
 */
export function observeProcess(executableName: string): ProcessObservationResult {
  const observedAt = new Date().toISOString();

  if (!executableName || typeof executableName !== 'string') {
    return { availability: 'error', identity: null, error: 'Invalid executable name', observedAt };
  }

  // Sanitize: only allow safe filename characters (no shell metacharacters)
  if (!/^[\w\-. ]+\.exe$/i.test(executableName) && !/^[\w\-. ]+$/i.test(executableName)) {
    return { availability: 'error', identity: null, error: 'Executable name failed safety check', observedAt };
  }

  const os = platform();
  if (os !== 'win32') {
    return observeProcessUnix(executableName, observedAt);
  }

  return observeProcessWindows(executableName, observedAt);
}

function observeProcessWindows(executableName: string, observedAt: string): ProcessObservationResult {
  try {
    // Get-CimInstance returns structured JSON we can parse.
    // We request only: ProcessId, Name, CreationDate, ExecutablePath.
    // The executableName is already sanitized above so shell injection is not possible.
    const safeName = executableName.replace(/'/g, '');
    const cmd = `powershell -NoProfile -NonInteractive -Command "` +
      `Get-CimInstance Win32_Process -Filter \\"Name='${safeName}'\\" | ` +
      `Select-Object -First 1 ProcessId,Name,CreationDate,ExecutablePath | ` +
      `ConvertTo-Json -Compress"`;

    const raw = execSync(cmd, { encoding: 'utf-8', timeout: 6000, windowsHide: true }).trim();

    if (!raw || raw === 'null' || raw === '') {
      return { availability: 'available', identity: null, observedAt };
    }

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ProcessId) {
      return { availability: 'available', identity: null, observedAt };
    }

    const identity: ProcessIdentity = {
      pid: Number(parsed.ProcessId),
      name: String(parsed.Name ?? executableName),
      startTime: normalizeWmiDate(parsed.CreationDate),
      executablePath: parsed.ExecutablePath ? String(parsed.ExecutablePath) : undefined,
      observedAt,
    };

    return { availability: 'available', identity, observedAt };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('Access') || msg.includes('access')) {
      return { availability: 'permission_denied', identity: null, error: msg.slice(0, 120), observedAt };
    }
    // Process simply not found (exit code 0 with empty output handled above; non-zero = error)
    return { availability: 'available', identity: null, observedAt };
  }
}

function observeProcessUnix(executableName: string, observedAt: string): ProcessObservationResult {
  try {
    const base = executableName.replace(/\.exe$/i, '').replace(/'/g, '');
    const raw = execSync(
      `ps -eo pid,lstart,comm | grep -i "${base}" | grep -v grep | head -1`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    if (!raw) {
      return { availability: 'available', identity: null, observedAt };
    }

    // Format: "  PID  Day Mon DD HH:MM:SS YYYY  command"
    const parts = raw.trim().split(/\s+/);
    const pid = parseInt(parts[0], 10);
    // lstart: parts 1-5 = "Day Mon DD HH:MM:SS YYYY"
    const startTime = parts.slice(1, 6).join(' ');

    return {
      availability: 'available',
      identity: { pid, name: executableName, startTime, observedAt },
      observedAt,
    };
  } catch {
    return { availability: 'available', identity: null, observedAt };
  }
}

/**
 * Normalize a WMI/CIM date value to an ISO string.
 * CIM dates can come as a JS object with "DateTime" field or a raw string like
 * "/Date(1234567890000)/" or an ISO string already.
 */
function normalizeWmiDate(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') {
    // /Date(ms)/ format from older WMI
    const match = raw.match(/\/Date\((\d+)\)\//);
    if (match) return new Date(parseInt(match[1], 10)).toISOString();
    return raw;
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj['DateTime'] === 'string') return obj['DateTime'];
    if (typeof obj['value'] === 'string') return obj['value'];
  }
  return String(raw);
}
