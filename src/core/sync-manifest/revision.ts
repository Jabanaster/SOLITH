/**
 * ROADMAP §online-foundation Phase 1.5 Mission A1 — sync revision ordering.
 *
 * SECURITY CONTEXT (verbatim gap from a prior hostile security review):
 * "applySyncManifestDelta and recordSyncManifestState unconditionally
 * overwrite catalogRevision/trainerRevision with whatever the server just
 * returned, with no comparison against the previously stored cursor. A
 * compromised or malicious sync server can send a revision number OLDER
 * than the client's current cursor, and the client will happily accept
 * it... no `if (newRevision <= storedRevision) reject` anywhere in this
 * path."
 *
 * This module is the fix. It is deliberately pure and dependency-free (no
 * DB, no fetch) so the ordering rule itself — the security-critical part —
 * can be unit-tested in isolation from client.ts's persistence/network
 * plumbing.
 *
 * REVISION FORMAT DECISION: `catalogRevision`/`trainerRevision` are already
 * (per mock-server.ts's `String(this.revisionCounter)`) unpadded
 * base-10 non-negative integers serialized as strings — i.e. genuinely a
 * monotonically-increasing integer counter, just transported as text. That
 * representation is NOT safe to compare lexically ("9" > "10" as strings,
 * which is the wrong answer), so this module does not invent string
 * comparison. Instead the protocol is tightened by giving the existing
 * format an explicit, enforced grammar (REVISION_PATTERN below — no sign,
 * no leading zeros, digits only) and always comparing the parsed integer
 * value (via BigInt, so arbitrarily large counters stay exact). This is the
 * "simplest safe choice" the owner described: keep the wire-compatible
 * string, add the missing rule instead of a new representation, since the
 * counter underneath was already totally ordered — only the comparison
 * logic was missing.
 */

export type SyncRevisionVerdict = 'newer' | 'equal' | 'older' | 'invalid';

/**
 * Canonical revision grammar: the literal "0", or a non-zero digit followed
 * by zero or more digits. No sign, no leading zeros, no whitespace, no
 * decimal point/exponent. This is what makes numeric-order comparison safe:
 * every string that matches has exactly one integer value and no
 * "9" vs "10" ambiguity ever reaches BigInt().
 */
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * True only for a syntactically valid revision per the canonical grammar.
 * Anything else — non-string, empty, whitespace, leading zeros, a negative
 * sign, a decimal point, non-digit characters — is invalid. Callers must
 * fail closed (reject) on an invalid revision; never coerce or guess.
 */
export function isValidSyncRevision(value: unknown): value is string {
  return typeof value === 'string' && REVISION_PATTERN.test(value);
}

/**
 * Compares an incoming revision against the locally stored cursor.
 *
 * - `stored === null` means there is no prior cursor for this service yet
 *   (e.g. the very first sync) — any syntactically valid `incoming` is
 *   'newer' because there is nothing to roll back.
 * - A malformed value on EITHER side is 'invalid'. This is the fail-closed
 *   default the owner required: a stored cursor should never be malformed
 *   in practice (this module is the only writer), but if it somehow were,
 *   treating that as "cannot determine order" and refusing to apply is
 *   safer than guessing.
 * - Otherwise the parsed integer values are compared exactly (BigInt, not
 *   Number, so this stays correct past Number.MAX_SAFE_INTEGER).
 */
export function compareSyncRevisions(stored: string | null, incoming: unknown): SyncRevisionVerdict {
  if (!isValidSyncRevision(incoming)) return 'invalid';
  if (stored === null) return 'newer';
  if (!isValidSyncRevision(stored)) return 'invalid';

  const storedValue = BigInt(stored);
  const incomingValue = BigInt(incoming);

  if (incomingValue > storedValue) return 'newer';
  if (incomingValue === storedValue) return 'equal';
  return 'older';
}

/**
 * Combines the independent verdicts for `catalogRevision` and
 * `trainerRevision` into one accept/reject decision for the whole delta.
 * Fail-closed priority order: any 'invalid' wins outright, then any
 * 'older' wins (never roll either cursor back even if the other advanced —
 * a delta with a genuinely malicious/broken revision pair like
 * catalog=newer/trainer=older should not partially apply), then 'equal'
 * only if BOTH sides are exactly unchanged, otherwise 'newer'.
 */
export function combineSyncRevisionVerdicts(a: SyncRevisionVerdict, b: SyncRevisionVerdict): SyncRevisionVerdict {
  if (a === 'invalid' || b === 'invalid') return 'invalid';
  if (a === 'older' || b === 'older') return 'older';
  if (a === 'equal' && b === 'equal') return 'equal';
  return 'newer';
}
