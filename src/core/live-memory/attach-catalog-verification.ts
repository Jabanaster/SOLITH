/**
 * Mission 20 — pure, directly-testable verification for the attach flow.
 *
 * A renderer-supplied `catalogGameId` hint at attach time (see
 * LiveMemoryTrainerPage.tsx, derived from process-picker.ts's
 * matchedGameId) must NEVER be trusted verbatim — the Trainer Deck read
 * bridge's game-binding gate (trainer-deck-read.ts) relies entirely on the
 * session's bound catalogGameId being genuine. This independently
 * re-derives the executable's real catalog identity (the same way
 * catalog-process-watch.ts's background poller does) and only returns the
 * claimed id when it actually agrees.
 */
export interface CatalogVerificationEntry {
  catalogGameId: string;
  displayName: string;
  executables: string[];
}

export type MatchCatalogProcessFn = (
  processes: Array<{ pid: number; name: string }>,
  catalog: CatalogVerificationEntry[],
) => { catalogGameId: string } | null;

export function verifyCatalogGameIdForExecutable(
  claimedCatalogGameId: string,
  executableName: string,
  pid: number,
  catalogEntries: CatalogVerificationEntry[],
  matchFn: MatchCatalogProcessFn,
): string | undefined {
  if (!claimedCatalogGameId) return undefined;
  const detection = matchFn([{ pid, name: executableName }], catalogEntries);
  return detection?.catalogGameId === claimedCatalogGameId ? claimedCatalogGameId : undefined;
}
