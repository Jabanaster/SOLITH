/**
 * ROADMAP §online-foundation Mission 9 — local trainer-artifact cache contract.
 *
 * Sits on top of src/core/trainer-artifact-store/ (the `trainer_artifacts`
 * table + `computeArtifactHash`). This module answers one question: "given
 * an expected content hash and a remote URL to fetch it from, how do we get
 * real local bytes onto disk without ever silently accepting a corrupted or
 * tampered download?"
 *
 * Mirrors the defensive shape of src/core/artwork-cache/fetch-executor.ts:
 * an injectable fetch implementation, a bounded timeout, and a
 * never-throws-for-ordinary-failure contract — every expected failure mode
 * (network error, hash mismatch) is a typed result, not a thrown exception.
 */

/**
 * Minimal fetch-like shape this module needs — deliberately narrower than
 * `typeof fetch` so a test (or the Mission 20 mock server) can implement it
 * without needing a full Fetch API polyfill. Matches the pattern already
 * used by src/core/artwork-cache/fetch-executor.ts's ArtworkFetchImpl.
 */
export type TrainerArtifactFetchImpl = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  /** Optional — when present, checked against the byte cap before the body is read. Absence never bypasses the post-download cap. */
  headers?: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type TrainerArtifactCacheStatus =
  | 'cache-hit'
  | 'fetched'
  | 'hash-mismatch'
  | 'network-error'
  | 'blocked-url'
  | 'too-large';

export interface ResolveTrainerArtifactInput {
  /** Expected SHA-256 hex digest of the artifact bytes — the content-addressing identity. */
  artifactHash: string;
  /** Where to fetch the bytes from when no valid local copy exists. */
  remoteUrl: string;
  fetchImpl: TrainerArtifactFetchImpl;
  /** Registration context used only when a fresh download is persisted (status 'fetched'). */
  trainerId?: string;
  gameId?: string;
  gameBuild?: string;
  /**
   * Rights classification recorded for a newly-fetched artifact. Defaults to
   * 'remote-unverified-rights' — a download from a remote URL is, by
   * definition, not yet a trusted local provenance signal on its own.
   */
  rightsClass?: 'solith-owned' | 'explicitly-licensed' | 'user-provided' | 'community-submitted' | 'remote-unverified-rights';
  /** Overrides the on-disk cache directory — for test isolation. */
  cacheDir?: string;
  /**
   * Allows a fetch target that resolves to a loopback/private/link-local
   * host (per RFC1918/RFC4193/etc). Defaults to false — a real remote
   * artifact source should never legitimately be a private-network address,
   * and `remoteUrl` is expected to come from server-controlled sync-manifest
   * data, so this is an SSRF guard by default. Set true ONLY for a local
   * mock/dev server explicitly under test.
   */
  allowPrivateNetworkHosts?: boolean;
}

export interface ResolveTrainerArtifactResult {
  status: TrainerArtifactCacheStatus;
  /** Present only for 'cache-hit' and 'fetched' — the real local file path bytes can be read from. */
  localPath?: string;
  /** Present for 'network-error' — human-readable diagnostic, never a thrown exception. */
  error?: string;
}
