/**
 * Cross-session freeze concurrency limits (Batch B1.1).
 *
 * `LiveMemorySession.startFreeze` already enforces "one freeze per session
 * instance." That alone does not stop a DIFFERENT session (e.g. the main
 * window and the wisp overlay window, which share the same preload/API
 * surface — see electron/main.ts and electron/wisp-overlay.ts) from each
 * independently attaching to the SAME target process and each starting
 * their own freeze, including at the identical address. This module tracks
 * active freezes across ALL sessions in the process so those cases can be
 * rejected.
 *
 * Dependency-free (no Electron import) so it's unit-testable directly.
 */

/**
 * Maximum simultaneously active freezes on any single target process,
 * across all sessions. Arbitrary judgment call (Batch B1.1), not derived
 * from measured usage or documented policy: high enough that a real user
 * freezing several independent stats at once (health, ammo, stamina) is
 * never blocked, low enough to bound worst-case CPU/IO load from runaway
 * freeze loops against one process.
 */
export const MAX_FREEZES_PER_PROCESS = 8;

/**
 * Maximum simultaneously active freezes across the entire application,
 * regardless of how many processes are targeted. Arbitrary judgment call,
 * same reasoning as MAX_FREEZES_PER_PROCESS — this is a coarser outer
 * bound in case multiple processes are attached to concurrently.
 */
export const MAX_FREEZES_GLOBAL = 32;

interface ActiveFreezeKey {
  pid: number;
  /** Decimal address string — callers must normalize (see normalizeAddressKey) before calling. */
  address: string;
  dataType: string;
}

/** A freeze registered by a specific session (identified by an opaque owner token, e.g. sender.id). */
const activeFreezes = new Map<string, ActiveFreezeKey & { owner: string }>();

function keyFor(owner: string, pid: number, address: string, dataType: string): string {
  return `${owner}|${pid}|${address}|${dataType}`;
}

export type RegisterFreezeResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate_address' | 'process_limit_exceeded' | 'global_limit_exceeded' };

/**
 * Attempts to register a new active freeze. Fails (without side effects) if
 * the exact (pid, address, dataType) is already frozen by ANY session, or
 * either concurrency ceiling would be exceeded.
 */
export function registerActiveFreeze(owner: string, pid: number, address: string, dataType: string): RegisterFreezeResult {
  for (const entry of activeFreezes.values()) {
    if (entry.pid === pid && entry.address === address && entry.dataType === dataType) {
      return { ok: false, reason: 'duplicate_address' };
    }
  }
  const perProcessCount = Array.from(activeFreezes.values()).filter((e) => e.pid === pid).length;
  if (perProcessCount >= MAX_FREEZES_PER_PROCESS) {
    return { ok: false, reason: 'process_limit_exceeded' };
  }
  if (activeFreezes.size >= MAX_FREEZES_GLOBAL) {
    return { ok: false, reason: 'global_limit_exceeded' };
  }
  activeFreezes.set(keyFor(owner, pid, address, dataType), { owner, pid, address, dataType });
  return { ok: true };
}

/** Removes a specific owner's freeze registration (on stop, error, or any other termination reason). */
export function unregisterActiveFreeze(owner: string, pid: number, address: string, dataType: string): void {
  activeFreezes.delete(keyFor(owner, pid, address, dataType));
}

/** Removes every freeze registered by a given owner (e.g. on session detach/dispose). */
export function unregisterAllFreezesForOwner(owner: string): void {
  for (const [key, entry] of activeFreezes) {
    if (entry.owner === owner) activeFreezes.delete(key);
  }
}

export function countActiveFreezesForPid(pid: number): number {
  return Array.from(activeFreezes.values()).filter((e) => e.pid === pid).length;
}

export function countActiveFreezesGlobal(): number {
  return activeFreezes.size;
}

/** Testing seam only. */
export function _clearActiveFreezesForTests(): void {
  activeFreezes.clear();
}
