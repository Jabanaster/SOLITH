/**
 * Main-process-maintained "user selected this process" state (Batch B1.1).
 *
 * Replaces trusting a renderer-supplied `userSelectedProcess: true` boolean.
 * A renderer may REQUEST a selection (electron/registry-verification-ipc.ts
 * verifies the claimed pid/executableName against the live OS process
 * before ever creating a record), but the record itself — and therefore
 * which pid/executable a later privileged operation actually targets — is
 * maintained entirely server-side. A privileged operation then references
 * the selection by its server-generated `selectionId`; it never re-supplies
 * pid/executableName directly.
 *
 * Kept dependency-free (no Electron import) so it is unit-testable without
 * a real Electron/Windows runtime.
 */
import { randomUUID } from 'node:crypto';

/**
 * How long a selection remains usable before it must be re-created.
 * Centralized, documented judgment call (Batch B1.1): long enough to run
 * several verification passes against the same selected process in one
 * debugging sitting without re-selecting every time, short enough to bound
 * how long a stale selection (naming a process that may have since exited,
 * restarted, or been replaced) remains accepted.
 */
export const PROCESS_SELECTION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Selections are REUSABLE within their TTL, not single-use — deliberate
 * choice (Batch B1.1). registry-run-readonly-verification is a diagnostic
 * tool typically re-run several times against the same selected process;
 * forcing a fresh "select process" round-trip before every run would be
 * pure friction with no security benefit (the identity re-check happens at
 * verification time regardless — see registry-verification-ipc.ts).
 */
export interface ProcessSelectionRecord {
  selectionId: string;
  pid: number;
  executableName: string;
  executablePath?: string;
  processStartTime?: string;
  volumeSerialNumber?: string;
  fileIndex?: string;
  exeSha256?: string;
  /** The WebContents id that created this selection — resolveProcessSelection enforces same-window use. */
  windowId: number;
  createdAtMs: number;
  expiresAtMs: number;
}

const selections = new Map<string, ProcessSelectionRecord>();

export function createProcessSelection(input: {
  pid: number;
  executableName: string;
  executablePath?: string;
  processStartTime?: string;
  volumeSerialNumber?: string;
  fileIndex?: string;
  exeSha256?: string;
  windowId: number;
  nowMs?: number;
  ttlMs?: number;
}): ProcessSelectionRecord {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? PROCESS_SELECTION_TTL_MS;
  const record: ProcessSelectionRecord = {
    selectionId: randomUUID(),
    pid: input.pid,
    executableName: input.executableName,
    executablePath: input.executablePath,
    processStartTime: input.processStartTime,
    volumeSerialNumber: input.volumeSerialNumber,
    fileIndex: input.fileIndex,
    exeSha256: input.exeSha256,
    windowId: input.windowId,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
  selections.set(record.selectionId, record);
  return record;
}

export type ResolveSelectionResult =
  | { ok: true; selection: ProcessSelectionRecord }
  | { ok: false; reason: 'unknown_selection' | 'expired' | 'wrong_window' };

/**
 * Looks up a selection by id, enforcing expiration and same-window use.
 * Fails closed: an unknown id, an expired record, or a request from a
 * DIFFERENT window than the one that created the selection are all rejected.
 */
export function resolveProcessSelection(
  selectionId: string,
  windowId: number,
  nowMs: number = Date.now(),
): ResolveSelectionResult {
  const record = selections.get(selectionId);
  if (!record) return { ok: false, reason: 'unknown_selection' };
  if (record.expiresAtMs <= nowMs) {
    selections.delete(selectionId);
    return { ok: false, reason: 'expired' };
  }
  if (record.windowId !== windowId) {
    return { ok: false, reason: 'wrong_window' };
  }
  return { ok: true, selection: record };
}

/** Explicitly discards a selection (e.g. the owning window was destroyed). */
export function consumeProcessSelection(selectionId: string): void {
  selections.delete(selectionId);
}

/** Removes every selection created by a given window (e.g. on window destruction). */
export function clearSelectionsForWindow(windowId: number): void {
  for (const [key, record] of selections) {
    if (record.windowId === windowId) selections.delete(key);
  }
}

/** Removes expired entries. Never removes a still-valid entry. */
export function purgeExpiredSelections(nowMs: number = Date.now()): void {
  for (const [key, record] of selections) {
    if (record.expiresAtMs <= nowMs) selections.delete(key);
  }
}

/** Testing seam only. */
export function _clearAllSelectionsForTests(): void {
  selections.clear();
}

export function clearAllProcessSelections(): void {
  selections.clear();
}
