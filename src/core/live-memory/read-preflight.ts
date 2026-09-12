/**
 * Fail-closed read-only preflight: answers READY_FOR_READ / BLOCKED(reason)
 * for a resolved pointer card, without this module ever touching a real
 * process itself. All process-facing operations go through an injected
 * `ReadPreflightSessionProbe` — in production that probe would wrap
 * LiveMemorySession + nativeMemoryDriver (see live-memory-session.ts,
 * native-memory-driver.ts); in tests it's a deterministic fake. This module
 * never calls memoryjs/native code directly, so it is safe to exercise with
 * zero live process involvement.
 *
 * Write-readiness (READY_FOR_WRITE) is intentionally NOT implemented here —
 * per scope, this pass is read-only diagnostics only.
 */
import type { MemoryDataType } from '../definitions/schema.v1.js';

const HEX_OFFSET_RE = /^0x[0-9a-f]+$/i;
const SUPPORTED_DATA_TYPES = new Set<MemoryDataType>(['int32', 'int64', 'float', 'double', 'byte']);

export interface ReadPreflightCardInput {
  moduleName: string;
  baseOffset?: string;
  pointerChain: number[];
  dataType: MemoryDataType;
}

export interface ReadPreflightExpectedTarget {
  pid: number;
  executableName: string;
}

export interface ReadPreflightProcessIdentity {
  pid: number;
  executableName: string;
}

/**
 * Everything here may throw (simulating a vanished process, a driver error,
 * etc) — runReadPreflight treats any thrown error as a BLOCKED result, never
 * lets it escape uncaught.
 */
export interface ReadPreflightSessionProbe {
  getProcessIdentity(): ReadPreflightProcessIdentity | null;
  verifyIdentityStillMatches(expected: ReadPreflightExpectedTarget): boolean;
  isModuleLoaded(moduleName: string): boolean;
  resolveModuleBase(moduleName: string): bigint | null;
  /** Applies baseOffset then walks each pointerChain hop in order. Returns null on any failed dereference. */
  traversePointerChain(moduleBase: bigint, baseOffset: bigint, pointerChain: number[]): bigint | null;
  readValue(address: bigint, dataType: MemoryDataType): { ok: true; value: number } | { ok: false; reason: string };
  /** Always called exactly once at the end, success or failure — idempotent by contract. */
  detach(): void;
}

export type ReadPreflightBlockCode =
  | 'NO_SESSION'
  | 'IDENTITY_MISMATCH'
  | 'EXECUTABLE_MISMATCH'
  | 'MISSING_MODULE'
  | 'MODULE_NOT_LOADED'
  | 'MODULE_BASE_UNRESOLVED'
  | 'MALFORMED_BASE_OFFSET'
  | 'MALFORMED_POINTER_CHAIN'
  | 'UNSUPPORTED_DATA_TYPE'
  | 'FINAL_ADDRESS_UNRESOLVED'
  | 'READ_FAILED'
  | 'PROBE_ERROR';

export interface ReadPreflightDiagnostics {
  identityVerified: boolean;
  moduleLoaded: boolean;
  moduleBaseResolved: boolean;
  pointerChainStructurallyValid: boolean;
  finalAddressResolved: boolean;
  dataTypeSupported: boolean;
  readSucceeded: boolean;
}

const EMPTY_DIAGNOSTICS: ReadPreflightDiagnostics = {
  identityVerified: false,
  moduleLoaded: false,
  moduleBaseResolved: false,
  pointerChainStructurallyValid: false,
  finalAddressResolved: false,
  dataTypeSupported: false,
  readSucceeded: false,
};

export type ReadPreflightResult =
  | { status: 'READY_FOR_READ'; address: string; value: number; diagnostics: ReadPreflightDiagnostics }
  | { status: 'BLOCKED'; code: ReadPreflightBlockCode; reason: string; diagnostics: ReadPreflightDiagnostics };

function blocked(
  code: ReadPreflightBlockCode,
  reason: string,
  diagnostics: ReadPreflightDiagnostics,
): ReadPreflightResult {
  return { status: 'BLOCKED', code, reason, diagnostics };
}

/**
 * Structural-only check (no process/session required at all) — usable
 * before any attach even exists, e.g. to gate the "Add to Trainer Deck"
 * button. Mirrors evaluateCtLibraryEntryForPromotion's field checks.
 */
export function isCardStructurallyReadable(card: ReadPreflightCardInput): boolean {
  if (!card.moduleName || card.moduleName.trim().toLowerCase() === 'unknown-module.exe') return false;
  if (!card.baseOffset || !HEX_OFFSET_RE.test(card.baseOffset)) return false;
  if (!Array.isArray(card.pointerChain) || card.pointerChain.some((n) => !Number.isFinite(n))) return false;
  if (!SUPPORTED_DATA_TYPES.has(card.dataType)) return false;
  return true;
}

/**
 * Full session-aware preflight. Every probe call is wrapped so a thrown
 * error (vanished process, driver exception, SOLITH shutting down mid-call)
 * becomes a BLOCKED result — never an uncaught exception, never a read
 * against the wrong process. detach() is always invoked exactly once,
 * whatever the outcome.
 */
export function runReadPreflight(
  card: ReadPreflightCardInput,
  expectedTarget: ReadPreflightExpectedTarget,
  probe: ReadPreflightSessionProbe,
): ReadPreflightResult {
  const diagnostics: ReadPreflightDiagnostics = { ...EMPTY_DIAGNOSTICS };

  try {
    // 1. Session / PID / executable identity still current.
    const identity = probe.getProcessIdentity();
    if (!identity) {
      return blocked('NO_SESSION', 'No active session — process identity unavailable', diagnostics);
    }
    if (identity.pid !== expectedTarget.pid) {
      return blocked('IDENTITY_MISMATCH', `Expected PID ${expectedTarget.pid}, session reports ${identity.pid}`, diagnostics);
    }
    if (identity.executableName.toLowerCase() !== expectedTarget.executableName.toLowerCase()) {
      return blocked(
        'EXECUTABLE_MISMATCH',
        `Expected executable ${expectedTarget.executableName}, session reports ${identity.executableName} — PID likely reused by a different process`,
        diagnostics,
      );
    }
    if (!probe.verifyIdentityStillMatches(expectedTarget)) {
      return blocked('IDENTITY_MISMATCH', 'Session identity verification failed (drift or reuse detected)', diagnostics);
    }
    diagnostics.identityVerified = true;

    // 2. Card structural validity (module name / offset format / chain shape / data type).
    if (!card.moduleName || card.moduleName.trim().toLowerCase() === 'unknown-module.exe') {
      return blocked('MISSING_MODULE', 'Card has no real module name', diagnostics);
    }
    if (!SUPPORTED_DATA_TYPES.has(card.dataType)) {
      return blocked('UNSUPPORTED_DATA_TYPE', `Data type "${card.dataType}" is not supported`, diagnostics);
    }
    diagnostics.dataTypeSupported = true;
    if (!card.baseOffset || !HEX_OFFSET_RE.test(card.baseOffset)) {
      return blocked('MALFORMED_BASE_OFFSET', `Base offset "${card.baseOffset}" is not valid hex`, diagnostics);
    }
    if (!Array.isArray(card.pointerChain) || card.pointerChain.some((n) => !Number.isFinite(n) || n < 0)) {
      return blocked('MALFORMED_POINTER_CHAIN', 'Pointer chain contains a non-finite or negative offset', diagnostics);
    }
    diagnostics.pointerChainStructurallyValid = true;

    // 3. Module still loaded in the live process.
    if (!probe.isModuleLoaded(card.moduleName)) {
      return blocked('MODULE_NOT_LOADED', `Module "${card.moduleName}" is not currently loaded in the target process`, diagnostics);
    }
    diagnostics.moduleLoaded = true;

    // 4. Module base resolves.
    const moduleBase = probe.resolveModuleBase(card.moduleName);
    if (moduleBase === null) {
      return blocked('MODULE_BASE_UNRESOLVED', `Could not resolve base address for module "${card.moduleName}"`, diagnostics);
    }
    diagnostics.moduleBaseResolved = true;

    // 5. Pointer chain traversal reaches a final address.
    const baseOffset = BigInt(card.baseOffset);
    const finalAddress = probe.traversePointerChain(moduleBase, baseOffset, card.pointerChain);
    if (finalAddress === null) {
      return blocked('FINAL_ADDRESS_UNRESOLVED', 'Pointer chain traversal failed — a dereference along the chain returned an invalid address', diagnostics);
    }
    diagnostics.finalAddressResolved = true;

    // 6. Read the value.
    const readResult = probe.readValue(finalAddress, card.dataType);
    if (!readResult.ok) {
      return blocked('READ_FAILED', readResult.reason, diagnostics);
    }
    diagnostics.readSucceeded = true;

    return {
      status: 'READY_FOR_READ',
      address: `0x${finalAddress.toString(16)}`,
      value: readResult.value,
      diagnostics,
    };
  } catch (error) {
    return blocked('PROBE_ERROR', error instanceof Error ? error.message : String(error), diagnostics);
  } finally {
    try {
      probe.detach();
    } catch {
      // Detach must never throw into the caller — a failed cleanup is not
      // grounds to escalate past a preflight result. Best-effort only.
    }
  }
}
