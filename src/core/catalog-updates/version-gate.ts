/**
 * ROADMAP §5.5/§5.7 replay/downgrade protection. The manifest's monotonic
 * `version` is the sole sequence defense — a version equal to (replay) or
 * less than (downgrade) the currently-applied version is always rejected,
 * independent of client wall-clock time.
 */
export function isAcceptableUpdateVersion(incomingVersion: number, currentVersion: number): boolean {
  return Number.isInteger(incomingVersion) && incomingVersion > currentVersion;
}
