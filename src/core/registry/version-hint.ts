/**
 * Mission 17 — optional, non-authoritative version hint extraction.
 *
 * The CT import schema has never tracked a "game version" field at all —
 * this doesn't redesign that. It only pulls a best-effort, purely
 * informational string out of a table's filename/archive path when one is
 * visibly present (a version number, an ISO date, a platform tag), for
 * display/provenance purposes.
 *
 * Explicitly NOT authoritative: a present hint is not a compatibility
 * claim, and its absence is not evidence of anything. Never affects
 * resolver eligibility (liveResolution / native-readiness) in any way —
 * this module has no knowledge of pointers, offsets, or the classifier.
 */

const VERSION_NUMBER_RE = /\bv?(\d+\.\d+(?:\.\d+){0,3})\b/i;
const ISO_DATE_RE = /\b(20\d{2}[-_]\d{2}[-_]\d{2})\b/;
const PLATFORM_TAG_RE = /\b(steam|gog|epic|xbox|ps[45]|switch)\b/i;

export type VersionHintKind = 'explicit_version' | 'date' | 'platform_only' | 'none';

export interface VersionHintResult {
  kind: VersionHintKind;
  hint: string | null;
}

/**
 * Extracts a version hint from a table name or archive path. Checks, in
 * priority order: explicit version number > ISO date > bare platform tag.
 * Returns { kind: 'none', hint: null } when nothing recognizable is present
 * — this is the common case and is not an error.
 */
export function extractVersionHint(...sources: Array<string | undefined>): VersionHintResult {
  // Underscores are pure separators in these filenames (e.g. "v3.4.0"
  // preceded by "_") but count as \w characters, which defeats \b boundary
  // matching below — normalize them to spaces first so boundaries work.
  const text = sources
    .filter((s): s is string => Boolean(s))
    .join(' ')
    .replace(/_/g, ' ');
  if (!text.trim()) return { kind: 'none', hint: null };

  const versionMatch = text.match(VERSION_NUMBER_RE);
  if (versionMatch) return { kind: 'explicit_version', hint: versionMatch[1] };

  const dateMatch = text.match(ISO_DATE_RE);
  if (dateMatch) return { kind: 'date', hint: dateMatch[1].replace(/_/g, '-') };

  const platformMatch = text.match(PLATFORM_TAG_RE);
  if (platformMatch) return { kind: 'platform_only', hint: platformMatch[1].toLowerCase() };

  return { kind: 'none', hint: null };
}
