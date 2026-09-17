import { resolvePointerPath, type LivePointerPath } from './pointer-resolver.js';
import { isProcessGoneError } from './memory-scanner.js';
import type { LiveProcessHandle, MemoryDriver } from './types.js';

/**
 * Phase 2 P2-4 — pointer stability testing (ROADMAP "pointer stability
 * testing", a distinct named item from "pointer-chain visualization",
 * P2-3's scope). A saved pointer chain resolving to SOME readable address
 * after a restart is not proof it is stable — P2-1/P2-2's own
 * resolvePointerMap only proves the chain traverses without error; it never
 * reads the destination value, so it cannot tell a correct resolution from
 * one that happens to land on unrelated-but-readable memory. This module
 * adds the missing piece: independent ground-truth verification of what the
 * resolved address actually holds, and a truthful classification of what
 * happened across a restart — reusing resolvePointerPath (never re-deriving
 * pointer-chain semantics) rather than building a second resolver.
 */

export type StabilityStatus =
  | 'stable_exact'
  | 'stable_relocated'
  | 'target_moved_chain_valid'
  | 'chain_broken'
  | 'module_missing'
  | 'read_failed'
  | 'process_exited'
  | 'false_positive';

/**
 * "Not yet checked against the current process" — the default state for a
 * freshly-loaded map before the user has run a restart validation. Not
 * produced by classifyStabilityObservation itself (which always reflects a
 * real attempt); assigned by getNodeStability when a node has zero
 * observations for the current process generation.
 */
export const STALE_UNRESOLVED = 'stale_unresolved' as const;
export type NodeStabilityDisplayStatus = StabilityStatus | typeof STALE_UNRESOLVED;

/**
 * How to independently verify a resolved address actually holds the
 * intended semantic target — mission §4's "ground truth", not "resolved to
 * readable memory". Byte-level rather than type-specific so the same shape
 * covers a fixture's planted u32 sentinel and a real game's config value
 * equally, without inventing a second typed-read path alongside the
 * existing memory-scanner primitives.
 */
export interface StabilityGroundTruth {
  /** Bytes to read at the resolved address. */
  readSize: number;
  /** True iff these raw bytes represent the intended semantic target. */
  verify: (bytes: Buffer) => boolean;
  /** Human-readable description, kept on every observation for audit — e.g. "planted u32 sentinel 0x5A5A1234". */
  description: string;
}

/** The first successful observation for a node — every later restart is compared against this, never against raw historical absolute addresses. */
export interface StabilityBaseline {
  pid: number | null;
  moduleBase: string | null;
  resolvedAddress: string;
  recordedAt: string;
}

export interface StabilityObservation {
  launchNumber: number;
  pid: number | null;
  moduleBase: string | null;
  resolvedAddress: string | null;
  status: StabilityStatus;
  failureReason: string | null;
  observedAt: string;
}

export interface NodeStabilitySummary {
  attempts: number;
  correct: number;
  broken: number;
  falsePositive: number;
  /** correct / attempts, 0 when attempts is 0 — the denominator is always available alongside this, never hidden. */
  stabilityRate: number;
}

export interface NodeStabilityState {
  baseline: StabilityBaseline | null;
  observations: StabilityObservation[];
}

export function emptyStabilityState(): NodeStabilityState {
  return { baseline: null, observations: [] };
}

const CORRECT_STATUSES: ReadonlySet<StabilityStatus> = new Set([
  'stable_exact',
  'stable_relocated',
  'target_moved_chain_valid',
]);
const BROKEN_STATUSES: ReadonlySet<StabilityStatus> = new Set([
  'chain_broken',
  'module_missing',
  'read_failed',
  'process_exited',
]);

/** Aggregates observations into raw counts plus a rate — never a fabricated-precision label, always the numerator/denominator together (mission §10). */
export function summarizeNodeStability(observations: StabilityObservation[]): NodeStabilitySummary {
  const attempts = observations.length;
  let correct = 0;
  let broken = 0;
  let falsePositive = 0;
  for (const obs of observations) {
    if (CORRECT_STATUSES.has(obs.status)) correct += 1;
    else if (BROKEN_STATUSES.has(obs.status)) broken += 1;
    else if (obs.status === 'false_positive') falsePositive += 1;
  }
  return { attempts, correct, broken, falsePositive, stabilityRate: attempts > 0 ? correct / attempts : 0 };
}

/**
 * The single, testable classification decision (mission §2). Mutually
 * exclusive by construction — exactly one branch can produce any given
 * observation, so "which state does this resolve to" never depends on
 * evaluation order:
 *
 * 1. resolvePointerPath itself threw -> process_exited / module_missing /
 *    chain_broken (an intermediate dereference failed — a real broken
 *    link, not this node's "final read").
 * 2. it resolved, but reading the ground-truth bytes at that address
 *    failed -> read_failed (the chain is intact; the destination is not
 *    currently readable).
 * 3. it resolved and read, but the bytes are NOT the intended target ->
 *    false_positive (readable memory that happens to not be correct).
 * 4. it resolved, read, and matched -> stable_exact (module base AND
 *    resolved address identical to baseline), target_moved_chain_valid
 *    (module base identical, resolved address moved — pure heap
 *    relocation), or stable_relocated (module base itself moved).
 */
export function validateNodeAfterRestart(
  driver: MemoryDriver,
  handle: LiveProcessHandle,
  path: LivePointerPath,
  baseline: StabilityBaseline | null,
  groundTruth: StabilityGroundTruth,
  launchNumber: number,
  pid: number | null,
): StabilityObservation {
  const observedAt = new Date().toISOString();
  const moduleBase = getModuleBaseHex(driver, handle, path.moduleName);

  let resolvedAddress: bigint;
  try {
    resolvedAddress = resolvePointerPath(driver, handle, path);
  } catch (err) {
    const gone = isProcessGoneError(err);
    const message = err instanceof Error ? err.message : String(err);
    const status: StabilityStatus = gone
      ? 'process_exited'
      : message.includes('is not currently loaded')
        ? 'module_missing'
        : 'chain_broken';
    return { launchNumber, pid, moduleBase, resolvedAddress: null, status, failureReason: message, observedAt };
  }

  const resolvedHex = `0x${resolvedAddress.toString(16)}`;

  let bytes: Buffer;
  try {
    bytes = driver.readBuffer(handle, resolvedAddress, groundTruth.readSize);
  } catch (err) {
    const gone = isProcessGoneError(err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      launchNumber,
      pid,
      moduleBase,
      resolvedAddress: resolvedHex,
      status: gone ? 'process_exited' : 'read_failed',
      failureReason: message,
      observedAt,
    };
  }

  if (!groundTruth.verify(bytes)) {
    return {
      launchNumber,
      pid,
      moduleBase,
      resolvedAddress: resolvedHex,
      status: 'false_positive',
      failureReason: `resolved and readable, but did not match ground truth: ${groundTruth.description}`,
      observedAt,
    };
  }

  if (!baseline) {
    // First-ever successful, verified observation — this becomes the baseline
    // for every subsequent restart, so it is reported as the reference point
    // itself rather than compared against nothing.
    return { launchNumber, pid, moduleBase, resolvedAddress: resolvedHex, status: 'stable_exact', failureReason: null, observedAt };
  }

  if (moduleBase !== baseline.moduleBase) {
    return { launchNumber, pid, moduleBase, resolvedAddress: resolvedHex, status: 'stable_relocated', failureReason: null, observedAt };
  }
  if (resolvedHex !== baseline.resolvedAddress) {
    return { launchNumber, pid, moduleBase, resolvedAddress: resolvedHex, status: 'target_moved_chain_valid', failureReason: null, observedAt };
  }
  return { launchNumber, pid, moduleBase, resolvedAddress: resolvedHex, status: 'stable_exact', failureReason: null, observedAt };
}

/**
 * Serializable ground-truth spec — StabilityGroundTruth's `verify` is a
 * closure and cannot cross IPC as JSON, so this is the wire shape the
 * renderer actually sends. `u32`/`u64` cover the common numeric-sentinel
 * case (a fixture's planted value, a game's static config value like
 * screen resolution width); `u64` carries its expected value as a decimal
 * STRING, the same BigInt-safe-IPC convention every other address/value
 * crossing this boundary already uses, never a plain `number`.
 */
export type StabilityGroundTruthSpec =
  | { kind: 'u32'; expected: number; description: string }
  | { kind: 'u64'; expected: string; description: string };

/** Builds the real (closure-bearing) ground truth from the wire spec — server-side only, never sent back across IPC. */
export function groundTruthFromSpec(spec: StabilityGroundTruthSpec): StabilityGroundTruth {
  switch (spec.kind) {
    case 'u32':
      return { readSize: 4, verify: (bytes) => bytes.readUInt32LE(0) === spec.expected, description: spec.description };
    case 'u64': {
      const expected = BigInt(spec.expected);
      return { readSize: 8, verify: (bytes) => bytes.readBigUInt64LE(0) === expected, description: spec.description };
    }
  }
}

function getModuleBaseHex(driver: MemoryDriver, handle: LiveProcessHandle, moduleName: string): string | null {
  try {
    const modules = driver.getModules(handle);
    const module = modules.find((m) => m.name.toLowerCase() === moduleName.toLowerCase());
    return module ? `0x${module.baseAddress.toString(16)}` : null;
  } catch {
    return null;
  }
}
