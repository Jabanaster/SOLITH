import { platform } from 'node:os';
import { runCommand } from '../v2/observers/command-runner.js';
import type { RemoteConnectionEvidence } from './types.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

/**
 * Read-only observer: counts ESTABLISHED TCP connections owned by `pid` whose
 * foreign (remote) address is not loopback. Used as evidence for the
 * online-session guard — a game process with active non-loopback connections
 * is treated as potentially online/multiplayer, blocking live memory writes.
 *
 * Queries `Get-NetTCPConnection` scoped server-side to a single PID and the
 * `Established` state, rather than parsing the full system-wide `netstat -ano`
 * table client-side. The earlier netstat-based implementation was found (via
 * real-machine testing against a live game process) to exceed the shared
 * command-runner output cap on ordinary Windows machines with many active
 * connections, which made the guard fail closed on `output_size_exceeded`
 * regardless of the target process's actual network state — a false
 * "unavailable" that happened to be safe here but would make the guard
 * effectively unusable in practice. Scoping the query to one PID keeps output
 * bounded to that process's own connections no matter how busy the rest of
 * the machine is.
 */
export async function observeRemoteConnections(
  pid: number,
  signal?: AbortSignal,
): Promise<RemoteConnectionEvidence> {
  const observedAt = new Date().toISOString();
  const os = platform();

  if (os !== 'win32') {
    // Non-Windows observation is not implemented for this feature yet.
    // Fail closed: report unavailable rather than guessing.
    return { availability: 'unavailable', remoteConnectionCount: 0, observedAt };
  }

  if (!Number.isInteger(pid) || pid <= 0) {
    // Defensive: pid is interpolated into a PowerShell script string below.
    // Reject anything that isn't a plain positive integer before it gets near
    // the command line, rather than relying on spawn's shell:false alone.
    return { availability: 'error', remoteConnectionCount: 0, error: 'invalid_pid', observedAt };
  }

  // -Command script text is fixed except for the validated integer `pid`.
  // spawn() runs with shell:false (see command-runner.ts), so this never
  // passes through cmd.exe; the integer guard above prevents PowerShell
  // script injection via a crafted pid value.
  const script =
    `Get-NetTCPConnection -OwningProcess ${pid} -State Established -ErrorAction SilentlyContinue | ` +
    `Select-Object -Property RemoteAddress | ConvertTo-Json -Compress`;

  let raw: string;
  try {
    raw = await runCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {},
      6000,
      signal,
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes('aborted')) {
      return { availability: 'unavailable', remoteConnectionCount: 0, observedAt };
    }
    if (msg.includes('permission_denied')) {
      return { availability: 'permission_denied', remoteConnectionCount: 0, error: msg.slice(0, 120), observedAt };
    }
    return { availability: 'error', remoteConnectionCount: 0, error: msg.slice(0, 120), observedAt };
  }

  return parsePowerShellConnections(raw, observedAt);
}

/** Exported for direct unit testing of the JSON-parsing logic (no real OS process required). */
export function parsePowerShellConnections(raw: string, observedAt: string): RemoteConnectionEvidence {
  const trimmed = raw.trim();

  // No established connections for this PID: ConvertTo-Json emits nothing.
  if (trimmed.length === 0) {
    return { availability: 'available', remoteConnectionCount: 0, observedAt };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      availability: 'error',
      remoteConnectionCount: 0,
      error: `Failed to parse PowerShell output: ${String(err)}`.slice(0, 120),
      observedAt,
    };
  }

  // ConvertTo-Json emits a bare object (not an array) when exactly one
  // connection matches — normalize to an array either way.
  const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

  let count = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const remoteAddress = (entry as { RemoteAddress?: unknown }).RemoteAddress;
    if (typeof remoteAddress !== 'string') continue;
    if (LOOPBACK_HOSTS.has(remoteAddress)) continue;
    count += 1;
  }

  return { availability: 'available', remoteConnectionCount: count, observedAt };
}
