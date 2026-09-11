import { randomUUID } from 'node:crypto';
import { upsertCanonicalGame, upsertGameInstallation } from './store.js';
import type { CanonicalGame, GameInstallation } from './types.js';
import type { InstallPlatform } from '../install-discovery/types.js';

/**
 * ROADMAP §online-foundation (Mission 13) — custom (user-authored) game creation.
 *
 * A superset of InstallPlatform: 'standalone' and 'other'/'unknown' cover games
 * with no real launcher/provider at all (the whole point of this flow — it must
 * NOT require any launcher). The five real-provider values below overlap with
 * InstallPlatform's set that actually has scanners
 * (install-discovery/provider-capabilities.ts's LinkedLibraryProvider); when one
 * of those is given together with providerGameId, an optional GameInstallation
 * link is created.
 */
export type CustomGamePlatform =
  | 'standalone'
  | 'steam'
  | 'gog'
  | 'epic'
  | 'ubisoft'
  | 'ea'
  | 'xbox'
  | 'battlenet'
  | 'other'
  | 'unknown';

const LINKABLE_PROVIDER_PLATFORMS: ReadonlySet<CustomGamePlatform> = new Set([
  'steam',
  'gog',
  'epic',
  'ubisoft',
  'ea',
  'xbox',
  'battlenet',
]);

export interface CreateCustomGameInput {
  displayName: string;
  executablePath?: string;
  installPath?: string;
  platform: CustomGamePlatform;
  /** Only used when `platform` is a real provider (see LINKABLE_PROVIDER_PLATFORMS) — ignored otherwise. */
  providerGameId?: string;
}

export interface CreateCustomGameResult {
  canonicalGame: CanonicalGame;
  /** Present only when `platform` was a real provider AND providerGameId was given. */
  installation?: GameInstallation;
}

/**
 * Creates a durable local canonical identity for a user-authored game.
 *
 * Never requires a launcher: `platform` may be 'standalone'/'other'/'unknown',
 * in which case no GameInstallation is created at all — the canonical row
 * alone is a complete, valid, listable entity (mirrors the existing
 * "canonical game with no installations" invariant covered by
 * tests/canonical-games.test.ts).
 *
 * Never silently merges: this always mints a brand-new id (locally generated,
 * not derived from any identity-grouping key), so a name collision with an
 * existing (custom or non-custom) canonical game NEVER causes a merge or
 * reuse of the existing row — custom games are explicit user intent, not
 * auto-dedup candidates. Callers who want to attach a custom game to an
 * existing canonical identity must do so through an explicit, confirmed flow
 * (see offerIdentityLink below), never through this function.
 */
export function createCustomGame(input: CreateCustomGameInput): CreateCustomGameResult {
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new Error('createCustomGame requires a non-empty displayName');
  }

  const nowIso = new Date().toISOString();
  // Locally-generated, random identity — deliberately NOT derived from any
  // identity-grouping key (see canonical-games/identity.ts), so it can never
  // collide with or be reinterpreted as a trusted-identity canonical id.
  const id = `canonical:custom:${randomUUID()}`;

  const canonicalGame: CanonicalGame = {
    id,
    displayName,
    normalizedTitle: displayName.toLowerCase(),
    aliases: [],
    genres: [],
    playModes: [],
    eligibility: 'listed',
    supportState: 'unknown',
    // The user explicitly created this identity themselves — no ambiguity to resolve.
    identityStatus: 'verified',
    isCustomGame: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  upsertCanonicalGame(canonicalGame);

  let installation: GameInstallation | undefined;
  if (LINKABLE_PROVIDER_PLATFORMS.has(input.platform) && input.providerGameId) {
    installation = {
      id: `install:${id}:${randomUUID()}`,
      canonicalGameId: id,
      launcher: input.platform as InstallPlatform,
      launcherGameId: input.providerGameId,
      installPath: input.installPath,
      executablePath: input.executablePath,
      // Unique-by-construction — this is a fresh user-declared link, never a
      // real scan-derived install identity from install-discovery/identity.ts.
      installIdentity: `custom-link:${id}:${input.platform}:${input.providerGameId}`,
      detectedAt: nowIso,
      lastSeenAt: nowIso,
    };
    upsertGameInstallation(installation);
  }

  return { canonicalGame, installation };
}

export type IdentityLinkSuggestionStatus = 'proposed';

/**
 * A proposed link between a custom game and a provider-discovered game,
 * returned for the user to explicitly confirm — never applied automatically.
 */
export interface IdentityLinkSuggestion {
  customGameId: string;
  discoveredProviderGameId: string;
  status: IdentityLinkSuggestionStatus;
  suggestedAt: string;
}

/**
 * ROADMAP §online-foundation (Mission 13) — "never silently merge uncertain
 * identities." Builds and returns a proposed link between an existing custom
 * game and a newly-discovered provider game id, WITHOUT writing anything to
 * the database. The caller (UI layer) is responsible for presenting this to
 * the user and, only on explicit confirmation, performing the actual write
 * (e.g. a real upsertGameInstallation call) through a separate, deliberate
 * code path — this function itself never mutates state.
 */
export function offerIdentityLink(customGameId: string, discoveredProviderGameId: string): IdentityLinkSuggestion {
  return {
    customGameId,
    discoveredProviderGameId,
    status: 'proposed',
    suggestedAt: new Date().toISOString(),
  };
}
