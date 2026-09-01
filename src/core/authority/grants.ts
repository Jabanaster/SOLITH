/**
 * Capability-scoped, target-scoped, time-bounded authority grants.
 *
 * Mirrors the pattern in src/core/consent/write-consent.ts (short-lived,
 * single-use, session-revocable) but generalized to any Capability rather
 * than the fixed memory/injector operation union. Used for REQUIRE_APPROVAL
 * outcomes that are not already covered by the existing write-consent
 * token flow (e.g. process.attach, process.launch, process.kill,
 * hook.install) — it does NOT replace write-consent.ts for capabilities
 * that already have a scoped consent mechanism (memory.write, savefile.modify).
 *
 * Grants are in-memory only and are never persisted — an app restart
 * implicitly expires every outstanding grant. This module deliberately has
 * no "approve everything" shape: every grant is bound to one capability and
 * one target identifier, and MUST be re-issued for a different target.
 */
import { randomUUID } from 'node:crypto';
import type { Capability } from './capabilities.js';

export const GRANT_TTL_MS = 5 * 60 * 1000;

export interface GrantBinding {
  capability: Capability;
  targetIdentifier: string;
  sessionKey: string;
}

export interface AuthorityGrant {
  grantId: string;
  capability: Capability;
  targetIdentifier: string;
  sessionKey: string;
  createdAt: string;
  expiresAt: string;
}

interface StoredGrant {
  capability: Capability;
  targetIdentifier: string;
  sessionKey: string;
  expiresAtMs: number;
  consumed: boolean;
}

const store = new Map<string, StoredGrant>();

export function issueGrant(binding: GrantBinding, options: { ttlMs?: number; nowMs?: number } = {}): AuthorityGrant {
  if (!binding.sessionKey.trim() || !binding.targetIdentifier.trim()) {
    throw new Error('Grant requires a non-empty sessionKey and targetIdentifier.');
  }
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? GRANT_TTL_MS;
  const grantId = randomUUID();
  const expiresAtMs = nowMs + ttlMs;
  store.set(grantId, {
    capability: binding.capability,
    targetIdentifier: binding.targetIdentifier,
    sessionKey: binding.sessionKey,
    expiresAtMs,
    consumed: false,
  });
  return {
    grantId,
    capability: binding.capability,
    targetIdentifier: binding.targetIdentifier,
    sessionKey: binding.sessionKey,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export type ConsumeGrantResult = { ok: true } | { ok: false; reason: string };

/** Validates capability/target match, expiry, and single-use; consumes on success. */
export function consumeGrant(
  grantId: string,
  binding: GrantBinding,
  options: { nowMs?: number } = {},
): ConsumeGrantResult {
  const entry = store.get(grantId);
  if (!entry) {
    return { ok: false, reason: 'Unknown or already-used grant.' };
  }
  if (entry.consumed) {
    return { ok: false, reason: 'Grant already consumed.' };
  }
  const nowMs = options.nowMs ?? Date.now();
  if (entry.expiresAtMs <= nowMs) {
    store.delete(grantId);
    return { ok: false, reason: 'Grant expired.' };
  }
  if (entry.capability !== binding.capability || entry.targetIdentifier !== binding.targetIdentifier || entry.sessionKey !== binding.sessionKey) {
    return { ok: false, reason: 'Grant does not match this capability/target/session.' };
  }
  entry.consumed = true;
  store.delete(grantId);
  return { ok: true };
}

export function revokeGrant(grantId: string): boolean {
  return store.delete(grantId);
}

/** Revokes all unconsumed grants owned by one session (mirrors revokeWriteConsentsForSession). */
export function revokeGrantsForSession(sessionKey: string): number {
  let revoked = 0;
  for (const [grantId, entry] of store) {
    if (entry.sessionKey === sessionKey) {
      store.delete(grantId);
      revoked += 1;
    }
  }
  return revoked;
}

export function clearGrantStore(): void {
  store.clear();
}
