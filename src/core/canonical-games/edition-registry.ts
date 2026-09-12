/**
 * SOLITH Phase 3 — curated cross-provider identity data for
 * cross-provider-match.ts.
 *
 * Two deliberately separate lists:
 *
 * 1. EDITION_DISTINCTIONS — titles that are known to be DISTINCT games/
 *    editions despite similar/overlapping normalized titles, so title-based
 *    matching can never merge them even when publisher/year would otherwise
 *    look corroborating (e.g. "Oblivion" vs "Oblivion Remastered", "DOOM" vs
 *    "DOOM Eternal", base "The Witcher 3" vs "Game of the Year Edition" is
 *    intentionally NOT distinguished here — same game, same canonical
 *    identity, edition suffix does not change what game it is; but "The
 *    Witcher 3" vs "The Witcher 3: Wild Hunt" IS the same normalized title
 *    by design, not a distinguishing case).
 *
 * 2. KNOWN_PROVIDER_ALIASES — explicit, human-verified "these exact
 *    (provider, providerGameId) pairs are the same game" assertions. This
 *    list starts EMPTY. Populating it with real Steam/GOG/Epic IDs is a data
 *    curation task requiring someone to actually confirm the IDs are
 *    correct — this module does not fabricate or guess real-world IDs.
 *    Tests populate this list with clearly-fake test fixture IDs to exercise
 *    the matching mechanism; that is not a claim about real IDs.
 */

export interface EditionFamilyMember {
  editionId: string;
  /** Case-insensitive patterns matched against the normalized title. */
  matches: RegExp[];
}

export interface EditionFamily {
  familyId: string;
  members: EditionFamilyMember[];
}

export const EDITION_DISTINCTIONS: EditionFamily[] = [
  {
    familyId: 'elder-scrolls-4',
    members: [
      { editionId: 'oblivion-remastered', matches: [/^the elder scrolls iv[:\s-]+oblivion remastered$/i, /^oblivion remastered$/i] },
      { editionId: 'oblivion-original', matches: [/^the elder scrolls iv[:\s-]+oblivion$/i, /^oblivion$/i] },
    ],
  },
  {
    familyId: 'doom',
    members: [
      { editionId: 'doom-2016', matches: [/^doom$/i] },
      { editionId: 'doom-eternal', matches: [/^doom eternal$/i] },
      { editionId: 'doom-3', matches: [/^doom 3$/i, /^doom iii$/i] },
    ],
  },
  {
    familyId: 'dark-souls',
    members: [
      { editionId: 'dark-souls-1', matches: [/^dark souls$/i, /^dark souls[:\s-]+remastered$/i] },
      { editionId: 'dark-souls-2', matches: [/^dark souls ii$/i, /^dark souls 2$/i] },
      { editionId: 'dark-souls-3', matches: [/^dark souls iii$/i, /^dark souls 3$/i] },
    ],
  },
  {
    familyId: 'final-fantasy-7-remake-project',
    members: [
      { editionId: 'ff7-remake', matches: [/^final fantasy vii remake$/i, /^final fantasy 7 remake$/i] },
      { editionId: 'ff7-rebirth', matches: [/^final fantasy vii rebirth$/i, /^final fantasy 7 rebirth$/i] },
      { editionId: 'ff7-original', matches: [/^final fantasy vii$/i, /^final fantasy 7$/i] },
    ],
  },
  {
    familyId: 'hitman-trilogy',
    members: [
      { editionId: 'hitman-1', matches: [/^hitman$/i, /^hitman \(2016\)$/i] },
      { editionId: 'hitman-2', matches: [/^hitman 2$/i, /^hitman ii$/i] },
      { editionId: 'hitman-3', matches: [/^hitman 3$/i, /^hitman iii$/i, /^hitman world of assassination$/i] },
    ],
  },
];

/**
 * Phase 3.1 Mission 16 — one verified cross-provider identity member.
 * `evidenceSource` and `verifiedAt` exist so this can never be confused with
 * an auto-generated/fuzzy-matched entry: every row here is a human-asserted
 * fact about a SPECIFIC (provider, providerGameId) pair, with an audit trail
 * of who/what verified it and when. This is a SEED system for a small,
 * deliberately-curated set — not a target for bulk/fuzzy alias generation
 * (see the module doc comment above).
 */
export interface KnownProviderAliasMember {
  provider: string;
  providerGameId: string;
  /** How this exact mapping was confirmed — e.g. 'manual-verification', 'official-storefront-cross-link', 'sku-database'. Never 'title-match' or similar heuristic — that belongs in cross-provider-match.ts's POSSIBLE tier, not here. */
  evidenceSource: string;
  /** ISO timestamp of when this specific mapping was verified. */
  verifiedAt: string;
  notes?: string;
}

export interface KnownProviderAlias {
  /** Stable canonical key for this asserted-same game (not a random ID — deterministic per curated entry). */
  canonicalKey: string;
  members: KnownProviderAliasMember[];
}

export const KNOWN_PROVIDER_ALIASES: KnownProviderAlias[] = [];

/**
 * A record's type/title strongly suggests DEMO content, which must never be
 * collapsed into the full game's canonical identity even if the title
 * otherwise matches exactly (Phase 3 Mission 4: "if demos need to remain
 * searchable, store them with type=DEMO and keep them distinct").
 */
export function looksLikeDemoTitle(normalizedTitle: string): boolean {
  return /\bdemo\b/i.test(normalizedTitle) || /\btrial\b/i.test(normalizedTitle) || /\btest drive\b/i.test(normalizedTitle);
}
