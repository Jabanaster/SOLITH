/**
 * Personal Library — normalized personal game model (Mission 1, Personal
 * Library Completion Pass, Phase 1).
 *
 * This is a DERIVED PROJECTION, not a new persisted table. Every field below
 * is computed from stores that already own their own truth:
 *   - install evidence:      src/core/canonical-games/store.ts (GameInstallation),
 *                             itself derived from src/core/install-discovery/*
 *   - ownership evidence:    trainer_catalog_games.ownedConfirmed
 *                             (src/core/trainer-catalog/store.ts) — the ONLY
 *                             ownership signal that exists today: an explicit
 *                             user click, never inferred.
 *   - favorite:               src/core/favorites/store.ts
 *   - trainer availability:  src/core/trainer-catalog/store.ts (catalog entry
 *                             + mod pack / definition metadata)
 *   - trainer accuracy:      src/core/trainer-catalog/trainer-accuracy.ts,
 *                             fed by src/core/validation-receipts/store.ts
 *   - running:                caller-supplied signal (electron/catalog-process-watch.ts
 *                             lives in the Electron main-process layer; core
 *                             modules do not reach up into electron/, so
 *                             "is this game currently running" is injected by
 *                             the caller rather than queried here)
 *
 * Nothing here re-stores install/ownership/favorite/trainer state — it only
 * composes what already exists. Do not add a new SQL table for this model;
 * if a field needs new persisted truth, it belongs in the store that already
 * owns that concern (or a new dedicated store), never duplicated here.
 *
 * `owned` is intentionally a tri-state (`true | false | 'unknown'`), never a
 * plain boolean: `'unknown'` is a real, distinct value and is the ONLY
 * correct result when no explicit ownership evidence exists. `owned` must
 * never be fabricated from installed-ness, catalog presence, or any other
 * inferred signal — see src/core/install-discovery/provider-capabilities.ts's
 * ownership-capability audit (Mission 6) for why no other local signal is
 * trustworthy enough to promote to `true`/`false` today.
 */

import type { InstallPlatform } from '../install-discovery/types.js';
import type { CanonicalGame, GameInstallation } from '../canonical-games/types.js';
import type { TrainerCatalogEntry } from '../trainer-catalog/types.js';
import { resolveCatalogCoverUrl } from '../trainer-catalog/cover-url.js';
import {
  computeTrainerAccuracy,
  type TrainerAccuracyEvidence,
  type TrainerAccuracyState,
} from '../trainer-catalog/trainer-accuracy.js';
import type { ValidationReceipt } from '../validation-receipts/store.js';

/** Real, distinct third state — never conflate with `false`. */
export type OwnershipStatus = true | false | 'unknown';

export type CanonicalConfidence = 'EXACT' | 'HIGH' | 'POSSIBLE' | 'UNKNOWN';

/**
 * NONE = no usable trainer content at all.
 * COMMUNITY = catalog has this game, community-tier verification/content only.
 * VERIFIED = catalog verification status is 'verified' (SOLITH-curated).
 * LOCAL = a user-authored / imported (ct-import) definition exists for this
 *         game, taking precedence over catalog-sourced tiers since it is the
 *         most directly user-controlled content.
 */
export type TrainerAvailability = 'NONE' | 'COMMUNITY' | 'VERIFIED' | 'LOCAL';

export interface InstallEvidenceItem {
  launcher: InstallPlatform;
  installPath?: string;
  executablePath?: string;
  buildVersion?: string;
  detectedAt: string;
  lastSeenAt: string;
  active: boolean;
}

export type OwnershipEvidenceConfidence = 'CONFIRMED';

export interface OwnershipEvidenceItem {
  /** Always 'user-confirmed' today — see trainer-catalog/store.ts setCatalogEntryOwnedConfirmed(). */
  source: 'user-confirmed';
  confidence: OwnershipEvidenceConfidence;
  owned: boolean;
}

export interface VersionEvidenceItem {
  source: 'install' | 'validation-receipt';
  executableVersion?: string;
  executableHash?: string;
  observedAt: string;
}

export interface PersonalLibraryGame {
  gameId: string;
  title: string;
  running: boolean;
  installed: boolean;
  owned: OwnershipStatus;
  favorite: boolean;
  /** True when any install evidence was detected within the recency window supplied to the projector. */
  recentlyDetected: boolean;
  launchers: InstallPlatform[];
  installEvidence: InstallEvidenceItem[];
  ownershipEvidence: OwnershipEvidenceItem[];
  canonicalConfidence: CanonicalConfidence;
  trainerAvailability: TrainerAvailability;
  trainerCount: number;
  trainerAccuracy: TrainerAccuracyState;
  versionEvidence: VersionEvidenceItem[];
  /**
   * Artwork audit (Mission 7, Visual Library 2.0 Final Hardening) — real
   * artwork audit found HomePage/MyGamesPage never passed a catalog entry
   * to GameCard, so every card on Home and My Games rendered the branded
   * fallback regardless of whether real cover art was actually resolvable
   * (confirmed via a real-Electron DOM audit: 28/28 Home cards and 11/11 My
   * Games cards fell back). This mirrors the SAME confidence-gated
   * resolution DetailBanner.tsx and canonical-games/render-model.ts already
   * do — 'trusted' only for an EXACT/HIGH canonical identity match, 'weak'
   * (no provider-derived CDN art) otherwise — computed once here so every
   * consumer of PersonalLibraryGame gets real artwork for free instead of
   * needing its own resolver wiring. undefined = no real artwork resolvable
   * (or catalogEntry is null); GameCard renders its branded fallback then.
   */
  artworkUrl?: string;
}

/**
 * Pure input bag for the projector — every field is evidence the caller has
 * already gathered from the real stores listed above. Keeping this pure
 * (no DB access inside projectPersonalLibraryGame) makes the projection
 * fully unit-testable, mirroring the established pattern in
 * src/core/trainer-catalog/library-sections.ts (LibraryGameEvidence ->
 * assignLibrarySection).
 */
export interface PersonalLibraryProjectionInput {
  gameId: string;
  title: string;
  running: boolean;
  installations: GameInstallation[];
  /** trainer_catalog_games.ownedConfirmed — undefined/null means "never touched". */
  ownedConfirmed: boolean | null | undefined;
  favorite: boolean;
  canonicalIdentityStatus: CanonicalGame['identityStatus'] | undefined;
  catalogEntry: TrainerCatalogEntry | null;
  hasUserAuthoredDefinition: boolean;
  latestValidationReceipt: ValidationReceipt | null;
  trainerAccuracyEvidence: TrainerAccuracyEvidence;
  /** Now, and the recency window (ms) used to compute `recentlyDetected`. */
  nowIso: string;
  recentWindowMs?: number;
}

const DEFAULT_RECENT_WINDOW_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function resolveOwnership(ownedConfirmed: boolean | null | undefined): {
  owned: OwnershipStatus;
  ownershipEvidence: OwnershipEvidenceItem[];
} {
  if (ownedConfirmed === true) {
    return { owned: true, ownershipEvidence: [{ source: 'user-confirmed', confidence: 'CONFIRMED', owned: true }] };
  }
  if (ownedConfirmed === false) {
    // An explicit user declaration ("I do not own this") is still real
    // evidence, distinct from the absence of any signal at all.
    return { owned: false, ownershipEvidence: [{ source: 'user-confirmed', confidence: 'CONFIRMED', owned: false }] };
  }
  return { owned: 'unknown', ownershipEvidence: [] };
}

function resolveCanonicalConfidence(status: CanonicalGame['identityStatus'] | undefined): CanonicalConfidence {
  switch (status) {
    case 'verified':
      return 'EXACT';
    case 'backfilled':
      return 'HIGH';
    case 'ambiguous':
      return 'POSSIBLE';
    default:
      return 'UNKNOWN';
  }
}

function resolveTrainerAvailability(
  catalogEntry: TrainerCatalogEntry | null,
  hasUserAuthoredDefinition: boolean,
): TrainerAvailability {
  if (hasUserAuthoredDefinition) return 'LOCAL';
  if (!catalogEntry) return 'NONE';
  if (catalogEntry.verificationStatus === 'verified') return 'VERIFIED';
  if (catalogEntry.hasModPack || catalogEntry.verificationStatus === 'community') return 'COMMUNITY';
  return 'NONE';
}

function toInstallEvidence(installations: GameInstallation[]): InstallEvidenceItem[] {
  return installations.map((installation) => ({
    launcher: installation.launcher,
    installPath: installation.installPath,
    executablePath: installation.executablePath,
    buildVersion: installation.buildVersion,
    detectedAt: installation.detectedAt,
    lastSeenAt: installation.lastSeenAt,
    // install-discovery has no row-removal/prune capability today (upsert-only,
    // see canonical-games/render-model.ts) — every detected installation stays
    // known once seen, so this is always true for install-discovery-sourced
    // installations. Kept as an explicit field (rather than assumed) so a
    // future removal-aware source can set it honestly without changing shape.
    active: true,
  }));
}

function toVersionEvidence(
  installations: GameInstallation[],
  receipt: ValidationReceipt | null,
): VersionEvidenceItem[] {
  const items: VersionEvidenceItem[] = [];
  for (const installation of installations) {
    if (installation.buildVersion) {
      items.push({ source: 'install', executableVersion: installation.buildVersion, observedAt: installation.lastSeenAt });
    }
  }
  if (receipt && (receipt.executableVersion || receipt.executableHash)) {
    items.push({
      source: 'validation-receipt',
      executableVersion: receipt.executableVersion,
      executableHash: receipt.executableHash,
      observedAt: receipt.validatedAt,
    });
  }
  return items;
}

function isRecentlyDetected(installations: GameInstallation[], nowIso: string, windowMs: number): boolean {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return false;
  return installations.some((installation) => {
    const detected = Date.parse(installation.detectedAt);
    return Number.isFinite(detected) && now - detected <= windowMs && now - detected >= 0;
  });
}

/**
 * Pure projector: composes one PersonalLibraryGame from already-gathered
 * evidence. No I/O, no DB access, no game/process access — deterministic
 * given its input, and fully unit-testable in isolation.
 */
export function projectPersonalLibraryGame(input: PersonalLibraryProjectionInput): PersonalLibraryGame {
  const { owned, ownershipEvidence } = resolveOwnership(input.ownedConfirmed);
  const launchers = [...new Set(input.installations.map((i) => i.launcher))];
  const trainerAccuracy = computeTrainerAccuracy(input.trainerAccuracyEvidence);
  const canonicalConfidence = resolveCanonicalConfidence(input.canonicalIdentityStatus);
  // Same trust rule DetailBanner.tsx already applies: only EXACT/HIGH
  // canonical-identity confidence is trusted enough for provider-derived
  // (Steam CDN) artwork — a POSSIBLE/UNKNOWN match may be linked to the
  // wrong edition/remaster, so provider-derived art must not be shown.
  const artworkConfidence = canonicalConfidence === 'EXACT' || canonicalConfidence === 'HIGH' ? 'trusted' : 'weak';
  const artworkUrl = input.catalogEntry
    ? resolveCatalogCoverUrl(input.catalogEntry, { canonicalConfidence: artworkConfidence })
    : undefined;

  return {
    gameId: input.gameId,
    title: input.title,
    running: input.running,
    installed: input.installations.length > 0,
    owned,
    favorite: input.favorite,
    recentlyDetected: isRecentlyDetected(
      input.installations,
      input.nowIso,
      input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS,
    ),
    launchers,
    installEvidence: toInstallEvidence(input.installations),
    ownershipEvidence,
    canonicalConfidence,
    trainerAvailability: resolveTrainerAvailability(input.catalogEntry, input.hasUserAuthoredDefinition),
    trainerCount: input.catalogEntry?.cheatCount ?? 0,
    trainerAccuracy,
    versionEvidence: toVersionEvidence(input.installations, input.latestValidationReceipt),
    artworkUrl,
  };
}
