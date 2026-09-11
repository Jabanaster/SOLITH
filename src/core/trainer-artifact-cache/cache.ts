/**
 * ROADMAP §online-foundation Mission 9 — local trainer-artifact cache.
 *
 * Flow (per the owner's spec):
 *   1. Check `trainer_artifacts` (via getTrainerArtifact) for a row matching
 *      `artifactHash` whose `localPath` points at a file that REALLY exists
 *      on disk (fs.existsSync) -> 'cache-hit', no network call at all.
 *   2. Otherwise (no row, or the row's file is missing/stale) -> fetch via
 *      the injected fetchImpl. Network/transport failures never throw; they
 *      come back as a typed 'network-error' result.
 *   3. Hash the downloaded bytes with the SAME real SHA-256 the rest of the
 *      artifact store uses (computeArtifactHash) and compare against the
 *      EXPECTED hash the caller asked for. A mismatch means a corrupted or
 *      tampered download — it is never written to disk and never
 *      registered; the result is 'hash-mismatch'.
 *   4. On a match, write the bytes to a deterministic path (a function of
 *      the hash, so a re-fetch after local file loss lands at the exact
 *      path the store already has on record) and register the artifact via
 *      registerTrainerArtifact. Result is 'fetched'.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { computeArtifactHash, getTrainerArtifact, registerTrainerArtifact } from '../trainer-artifact-store/store.js';
import type { ResolveTrainerArtifactInput, ResolveTrainerArtifactResult } from './types.js';

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Trainer artifacts (native packages/binaries) can legitimately be larger
 * than artwork; 256 MiB is a generous ceiling that still bounds memory/disk
 * exhaustion from a malicious or compromised sync source. Security-review
 * finding (Phase 1 online-foundation hostile review): this module previously
 * had NO cap at all, unlike the artwork-cache pipeline it claims to mirror.
 */
const MAX_TRAINER_ARTIFACT_BYTES = 256 * 1024 * 1024;

function defaultCacheDir(): string {
  return path.join(os.tmpdir(), 'solith-trainer-artifact-cache');
}

/** Deterministic on-disk location for a given content hash — self-healing across cache-loss/re-fetch cycles. */
function localPathForHash(cacheDir: string, artifactHash: string): string {
  return path.join(cacheDir, `${artifactHash}.artifact`);
}

/**
 * Security-review finding (Phase 1 online-foundation hostile review): this
 * module passed `remoteUrl` straight to `fetchImpl` with zero validation —
 * no scheme check, no private-network guard — unlike the sibling artwork
 * pipeline's `isAllowedArtworkUrl`. `remoteUrl` is expected to originate from
 * server-controlled sync-manifest data, making this an SSRF-adjacent risk: a
 * malicious/compromised sync source could point a client at an internal or
 * loopback address. Blocks non-http(s) schemes and, unless the caller
 * explicitly opts in for a local mock/dev server, any host that resolves to
 * a loopback/private/link-local literal IP. This is a best-effort literal-IP
 * check, not a DNS-resolution check — it does not protect against DNS
 * rebinding, which would require resolving the hostname before connecting
 * (out of scope for this pass; `fetchImpl` remains the actual network layer).
 */
function isBlockedRemoteUrl(rawUrl: string, allowPrivateNetworkHosts: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }
  if (allowPrivateNetworkHosts) {
    return false;
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost') {
    return true;
  }
  if (net.isIP(hostname) === 4) {
    const octets = hostname.split('.').map(Number);
    const [a, b] = octets;
    if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return true;
    }
  } else if (net.isIP(hostname) === 6) {
    const lower = hostname.toLowerCase();
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves a trainer artifact to a real local file, preferring an existing
 * valid local copy over any network access. Never throws for an ordinary
 * network/transport failure or a hash mismatch — both are typed results.
 */
export async function resolveTrainerArtifact(
  input: ResolveTrainerArtifactInput,
): Promise<ResolveTrainerArtifactResult> {
  const existing = getTrainerArtifact(input.artifactHash);
  if (existing?.localPath && fs.existsSync(existing.localPath)) {
    return { status: 'cache-hit', localPath: existing.localPath };
  }

  if (isBlockedRemoteUrl(input.remoteUrl, input.allowPrivateNetworkHosts ?? false)) {
    return { status: 'blocked-url', error: `Refused to fetch from disallowed URL: ${input.remoteUrl}` };
  }

  // Miss, or a stale row whose file was deleted/moved out from under it —
  // either way, fall through to a real fetch rather than crashing.
  let response: Awaited<ReturnType<ResolveTrainerArtifactInput['fetchImpl']>>;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await input.fetchImpl(input.remoteUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return { status: 'network-error', error: error instanceof Error ? error.message : String(error) };
  }

  if (!response.ok) {
    return { status: 'network-error', error: `HTTP ${response.status} fetching ${input.remoteUrl}` };
  }

  const declaredLength = Number(response.headers?.get('content-length') ?? NaN);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TRAINER_ARTIFACT_BYTES) {
    return { status: 'too-large', error: `Declared Content-Length ${declaredLength} exceeds cap of ${MAX_TRAINER_ARTIFACT_BYTES} bytes` };
  }

  let buffer: Buffer;
  try {
    const arrayBuffer = await response.arrayBuffer();
    // A declared Content-Length can lie (or be absent) — the real byte
    // length of the downloaded body is checked unconditionally, not just
    // when the header happened to be present and honest.
    if (arrayBuffer.byteLength > MAX_TRAINER_ARTIFACT_BYTES) {
      return { status: 'too-large', error: `Downloaded ${arrayBuffer.byteLength} bytes exceeds cap of ${MAX_TRAINER_ARTIFACT_BYTES} bytes` };
    }
    buffer = Buffer.from(arrayBuffer);
  } catch (error) {
    return { status: 'network-error', error: error instanceof Error ? error.message : String(error) };
  }

  const actualHash = computeArtifactHash(buffer);
  if (actualHash !== input.artifactHash) {
    // Corrupted or tampered download — must never silently pass, and must
    // never be persisted to disk or registered in the store.
    return { status: 'hash-mismatch' };
  }

  const cacheDir = input.cacheDir ?? defaultCacheDir();
  fs.mkdirSync(cacheDir, { recursive: true });
  const localPath = localPathForHash(cacheDir, actualHash);

  try {
    fs.writeFileSync(localPath, buffer);
  } catch (error) {
    return { status: 'network-error', error: `Disk write failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  registerTrainerArtifact({
    artifactHash: actualHash,
    trainerId: input.trainerId ?? 'unknown-trainer',
    gameId: input.gameId,
    gameBuild: input.gameBuild,
    sizeBytes: buffer.byteLength,
    localPath,
    rightsClass: input.rightsClass ?? 'remote-unverified-rights',
  });

  return { status: 'fetched', localPath };
}
