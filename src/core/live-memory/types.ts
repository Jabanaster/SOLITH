/**
 * Live Memory Trainer — Domain Types
 *
 * Scope (see PROJECT_SPEC.md Section 42 / Section 3):
 * - Local/offline single-player sessions only.
 * - Standard ReadProcessMemory/WriteProcessMemory only — no DLL injection,
 *   no code injection, no kernel drivers, no anti-cheat interaction.
 * - Every write requires: an attached target, a passed online-session guard
 *   check (rechecked immediately before the write, not just at attach time),
 *   and an explicit user-confirmed proposal — mirroring the file-based
 *   proposal → dry-run → apply → rollback flow used elsewhere in the app.
 */

export type LiveValueType = 'int32' | 'uint32' | 'float' | 'double' | 'int64' | 'byte';

/** Identifies the OS process Solith is attached to. */
export interface LiveProcessTarget {
  pid: number;
  executableName: string;
  /** Absolute executable path — required for destructive confirm (fail-closed). */
  executablePath?: string;
  /** ISO 8601 creation time — required for destructive confirm (fail-closed). */
  startTime?: string;
  volumeSerialNumber?: string;
  fileIndex?: string;
  /** SHA-256 of the executable image at attach time. */
  exeSha256?: string;
}

/** A single resolved memory location inside the attached process. */
export interface LiveMemoryAddress {
  /** Absolute address, or a module-relative offset resolved against `moduleName`. */
  address: bigint;
  moduleName?: string;
  dataType: LiveValueType;
}

// ── Online-session guard ─────────────────────────────────────────────────────

export interface RemoteConnectionEvidence {
  availability: 'available' | 'unavailable' | 'permission_denied' | 'error';
  /** Established connections owned by the target PID with a non-loopback remote address. */
  remoteConnectionCount: number;
  error?: string;
  observedAt: string;
}

export interface OnlineGuardInput {
  /** The user must explicitly confirm offline/single-player play for this attach session. */
  userConfirmedOffline: boolean;
  remoteConnections: RemoteConnectionEvidence;
  /**
   * Declared "known platform overhead" connection count for this specific game (e.g. Steamworks
   * cloud saves/presence), evidence-based and manually reviewed — NOT a generic relaxation.
   * Defaults to 0 (today's strict "any remote connection blocks" behavior) for any game without
   * a reviewed entry. A count at or under this baseline is treated as background noise; a count
   * above it still blocks, since that means something new appeared beyond the reviewed baseline.
   * See PerGameConnectionBaseline / Docs/KNOWN_ISSUES.md KI-017.
   */
  acceptedConnectionBaseline?: number;
}

/**
 * A single reviewed baseline entry: "this game was observed to hold up to N non-loopback
 * ESTABLISHED connections during genuine single-player/offline play, on this date, via this
 * evidence." Each entry must be backed by a real observation, not a guess — see the Stardew
 * Valley entry in game-connection-baselines.ts for the format this is meant to follow.
 */
export interface PerGameConnectionBaseline {
  executableName: string;
  acceptedConnectionBaseline: number;
  reviewedAt: string;
  evidence: string;
}

export interface OnlineGuardResult {
  allowed: boolean;
  reason: string;
}

// ── Memory driver (native boundary) ──────────────────────────────────────────

/**
 * Narrow seam over the native memory backend (e.g. `memoryjs`). Production code
 * uses NativeMemoryDriver; tests inject a FakeMemoryDriver so orchestration
 * logic (guard checks, proposal/rollback flow) is fully testable without a
 * real OS process or a compiled native addon.
 */
export interface MemoryDriver {
  openProcess(pid: number): LiveProcessHandle;
  readMemory(handle: LiveProcessHandle, address: bigint, dataType: LiveValueType): number;
  writeMemory(handle: LiveProcessHandle, address: bigint, dataType: LiveValueType, value: number): void;
  closeProcess(handle: LiveProcessHandle): void;
  /** Resolve the current executable name for a live attached process handle. */
  getProcessExecutableName(handle: LiveProcessHandle): string | null;
  /** Absolute path of the live process image, when the OS exposes it. */
  getProcessExecutablePath(handle: LiveProcessHandle): string | null;
  /** UTC ISO-8601 process creation time, when the OS exposes it. */
  getProcessStartTime(handle: LiveProcessHandle): string | null;
  /** Volume serial for the executable's volume, when available. */
  getProcessVolumeSerial?(handle: LiveProcessHandle): string | null;
  /** Stable file index for the executable image, when available. */
  getProcessFileIndex?(handle: LiveProcessHandle): string | null;
  /** Enumerate committed memory regions for scanning. Bounded/filtered by the caller, not here. */
  getRegions(handle: LiveProcessHandle): MemoryRegion[];
  /** Bulk-read raw bytes for scanning. Throws if the read fails (e.g. region unmapped mid-scan). */
  readBuffer(handle: LiveProcessHandle, address: bigint, size: number): Buffer;
  /**
   * Bulk-write raw bytes at an address, bypassing typed value encoding.
   * (Gate 2) Backs exact-byte-fidelity rollback: restoring the literal bytes
   * read before a write reproduces the original bit pattern exactly (matters
   * for distinguishing NaN payloads / signed zero), unlike re-encoding a
   * decoded `number` through `writeMemory`.
   */
  writeBuffer(handle: LiveProcessHandle, address: bigint, buffer: Buffer): void;
  /** Enumerate loaded modules (exe/dlls) — used to build restart-stable, module-relative pointer paths. */
  getModules(handle: LiveProcessHandle): MemoryModule[];
  /**
   * Reads a 64-bit pointer value, returned as `bigint` (not `number` —
   * `readMemory`'s declared `number` return type does not actually hold for
   * memoryjs's native int64/uint64 handling, which returns a JS `bigint`;
   * this method exists so pointer-chain code never has to rely on that
   * mismatch). Use this, not readMemory('int64'/'uint64', ...), whenever the
   * value being read is itself a memory address.
   */
  readPointer(handle: LiveProcessHandle, address: bigint): bigint;
}

/** A loaded module (the main executable or a DLL) inside the attached process. */
export interface MemoryModule {
  name: string;
  baseAddress: bigint;
  size: number;
  /** P2-8 memory map — full on-disk path, when the driver can report it (optional: not every driver/fixture populates this). */
  path?: string | null;
}

/** A single committed virtual-memory region inside the attached process. */
export interface MemoryRegion {
  baseAddress: bigint;
  size: number;
  /** True if the region is writable (required for anything the scanner should treat as a write candidate). */
  writable: boolean;
  /** P2-8 memory map — real Win32 protection/type detail, optional: not every driver/fixture populates this (existing consumers never needed it). */
  readable?: boolean;
  executable?: boolean;
  guarded?: boolean;
  /** Raw PAGE_* protection flags, for a truthful low-level display — never fabricated from `writable` alone. */
  rawProtect?: number;
  regionType?: 'image' | 'mapped' | 'private' | 'unknown';
}

export interface LiveProcessHandle {
  readonly pid: number;
  readonly opaque: unknown;
}

// ── Proposal / rollback (mirrors the file-based proposal engine) ────────────

export interface LiveWriteProposal {
  proposalId: string;
  target: LiveMemoryAddress;
  currentValue: number;
  requestedValue: number;
  createdAt: string;
}

export interface LiveWriteManifest {
  proposalId: string;
  target: LiveMemoryAddress;
  valueBefore: number;
  valueAfter: number;
  appliedAt: string;
}

/** A staged, not-yet-authorized freeze request — mirrors LiveWriteProposal. */
export interface FreezeProposal {
  proposalId: string;
  target: LiveMemoryAddress;
  value: number;
  intervalMs: number;
  createdAt: string;
}

// ── Memory scanning (Cheat-Engine-style first-scan / next-scan) ─────────────

/** A single scanned candidate: an address and the value observed there at scan time. */
export interface ScanMatch {
  address: bigint;
  value: number;
}

/**
 * A scanned candidate from a multi-datatype unknown-value scan — the same raw
 * bytes can be validly interpreted as int32, float, etc., and a "no visible
 * number" stat (a bar with no digits) could be stored as any of them. Tags
 * each match with which interpretation produced it, since a candidate list
 * mixing types needs to know how to re-read/write each address correctly.
 */
export interface TypedScanMatch extends ScanMatch {
  dataType: LiveValueType;
}

/**
 * Next-scan comparison mode, applied against a prior candidate set:
 * - exact: value now equals `value`.
 * - changed / unchanged: value differs from / matches its own previous scan value.
 * - increased / decreased: value moved in that direction versus its own previous scan value.
 * - increasedBy / decreasedBy: value moved in that direction by exactly `value` (e.g. "took
 *   exactly 12 damage") — tighter than plain increased/decreased when the exact delta is known.
 * - greaterThan / lessThan: value's *current* reading compares against `value`, independent of
 *   its previous value (e.g. "still above half health").
 * - between: value's current reading falls within [min, max] inclusive.
 */
export type ScanComparison =
  | { kind: 'exact'; value: number }
  | { kind: 'changed' }
  | { kind: 'unchanged' }
  | { kind: 'increased' }
  | { kind: 'decreased' }
  | { kind: 'increasedBy'; value: number }
  | { kind: 'decreasedBy'; value: number }
  | { kind: 'greaterThan'; value: number }
  | { kind: 'lessThan'; value: number }
  | { kind: 'between'; min: number; max: number };

export interface ScanBounds {
  /** Skip any single region larger than this (bytes). Default 64 MiB. */
  maxRegionBytes?: number;
  /** Stop scanning once this many total bytes have been read across all regions. Default 512 MiB. */
  maxTotalBytes?: number;
  /** Cap on returned matches for a first scan, to keep the result set usable. Default 10000. */
  maxMatches?: number;
  /**
   * Cooperative cancellation, checked between regions. A cancelled scan
   * reports `completeness: { state: 'cancelled' }` and is never an
   * authoritative absence — partial results stay, the claim of completeness
   * does not.
   */
  signal?: { aborted: boolean };
}

// ── Freeze (continuous re-write, mirrors mainstream "Infinite X" toggles) ──

export interface FreezeTarget {
  address: LiveMemoryAddress;
  value: number;
}

export type FreezeStopReason =
  | 'user_stopped'
  | 'guard_blocked'
  | 'identity_mismatch'
  | 'write_failed'
  | 'detached'
  | 'max_duration_exceeded'
  | 'feature_disabled';

export interface FreezeStatus {
  active: boolean;
  target: FreezeTarget | null;
  lastGuard: OnlineGuardResult | null;
  stopReason?: FreezeStopReason;
  tickCount: number;
}
