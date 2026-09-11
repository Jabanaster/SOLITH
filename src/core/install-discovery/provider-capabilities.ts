/**
 * Linked Game Libraries — provider capability descriptor (Mission 9/10/12).
 *
 * This is a STATIC, honest description of what SOLITH can actually do per
 * launcher today, sourced directly from the real scanners in this directory
 * (steam.ts, gog.ts, epic.ts, ubisoft.ts, ea.ts, xbox.ts, battle-net.ts,
 * index.ts's shallow XboxGames folder scan) — not aspirational. A provider with
 * `localDiscoverySupported: false` either has no scanner in this codebase,
 * or has one whose output is judged unreliable enough that it should not be
 * presented as working in any UI built on this (see each entry's comment).
 *
 * fullOwnershipSupported is separate from local discovery: local discovery
 * only proves a game is INSTALLED on this machine, never that the account
 * OWNS every game on the platform (uninstalled-but-owned titles). Full
 * ownership requires account-authorized API access SOLITH does not
 * implement yet for any provider — never fabricate ownership beyond what
 * local discovery evidences.
 *
 * ---------------------------------------------------------------------
 * Mission 6 — ownership capability audit (Steam / GOG / Epic)
 * ---------------------------------------------------------------------
 * Audited whether a genuinely trustworthy LOCAL-ONLY signal exists to
 * distinguish "confirmed owned" from "installed only." Conclusion for all
 * three: no, not for this pass. Local discovery in this codebase proves
 * INSTALL only, never full account ownership (owned-but-uninstalled titles
 * are invisible to it, and in Steam's case even installed-via-family-
 * sharing titles are not "owned" by the local account). Nothing here
 * implements or calls any network/account integration — this section is
 * documentation of what real ownership detection would require, for a
 * future pass.
 *
 * - Steam: `appmanifest_*.acf` files (already parsed by steam.ts) only
 *   prove install. There is no trustworthy local-only Steam ownership
 *   signal beyond "it's installed." Real ownership detection would require
 *   the Steam Web API `GetOwnedGames`
 *   (https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/)
 *   using a user-provided Steam Web API key plus the user's own SteamID64 —
 *   explicit account authorization, not implemented here.
 *
 * - GOG: the GOG Galaxy client caches a local SQLite database at
 *   `%LOCALAPPDATA%\GOG.com\Galaxy\storage\galaxy-2.0.db` that CAN include
 *   owned-but-not-installed titles from the user's synced GOG library, IF
 *   GOG Galaxy has been run and synced. This is a more promising local
 *   signal than Steam's, but it depends on the user having GOG Galaxy
 *   installed and having actually synced their library (not guaranteed),
 *   and the schema is an internal/undocumented Galaxy client implementation
 *   detail subject to change without notice. Given that fragility, this
 *   pass treats it as NOT reliable enough to implement — documented here as
 *   a possibility for a future pass (read-only, wrapped in try/catch,
 *   tolerant of schema drift, contributing ownership evidence explicitly
 *   marked non-CONFIRMED), not implemented now.
 *
 * - Epic: no known local-only ownership cache beyond install manifests
 *   (already parsed by epic.ts). Real ownership detection would require
 *   Epic's authenticated Games API (account-authorized OAuth), not
 *   implemented here.
 */
export type LinkedLibraryProvider = 'steam' | 'gog' | 'epic' | 'ubisoft' | 'ea' | 'xbox' | 'battlenet';

/**
 * Three-level honesty scale (Mission 19, Personal Library Completion pass,
 * Phase 2) — replaces the binary true/false framing for UI purposes where a
 * PARTIAL implementation (real code exists, output judged not reliable
 * enough to present as working — see xbox.ts/ea.ts doc comments) needs to
 * be distinguishable from both SUPPORTED and UNSUPPORTED. The underlying
 * booleans (`localDiscoverySupported`, `fullOwnershipSupported`) are kept
 * unchanged for existing callers/tests — these are additive fields.
 */
export type CapabilityLevel = 'supported' | 'partial' | 'unsupported';

/** Where local ownership-adjacent evidence, if any, actually comes from. Never claims an account connection that does not exist. */
export type OwnershipEvidenceSource = 'local metadata' | 'authorized account' | 'unavailable';

/**
 * ROADMAP §online-foundation (Mission 4) — four-level honesty scale for the FULL
 * capability set below, richer than CapabilityLevel because it distinguishes
 * "would work today if the user connected an account" (REQUIRES_AUTH) from
 * "genuinely not implemented/available" (UNSUPPORTED). Never claim SUPPORTED
 * for a capability with no real, wired-up code path in this codebase today.
 */
export type ExtendedCapabilityStatus = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'REQUIRES_AUTH';

/**
 * ROADMAP §online-foundation (Mission 4) — the full capability surface the
 * owner's online-foundation prompt asks to be modeled honestly per provider,
 * beyond the existing installedDetectionLevel/ownershipDetectionLevel pair:
 *  - catalogDiscovery: browsing the provider's full PUBLIC catalog (not just
 *    what's installed/owned locally) — e.g. Steam's public app list. No
 *    provider has this wired up in this codebase today.
 *  - installedDiscovery: mirrors installedDetectionLevel above, restated in
 *    the four-level scale for a single unified capability matrix.
 *  - ownedLibrarySync: pulling the full OWNED library (including
 *    uninstalled titles) from the provider's account API.
 *  - recentlyPlayed / playtime: per-title recent-activity and playtime
 *    stats, which (where they exist at all) come from the same
 *    account-authorized API surface as ownedLibrarySync.
 *  - artwork: fetching box art/headers/icons from a provider's real CDN.
 *  - storeMetadata: store-page metadata (long description, screenshots,
 *    system requirements, etc.) beyond the basic fields already covered by
 *    provider_catalog_records.
 *  - ratings / popularity: any reproducible rating or popularity signal
 *    actually ingested from the provider.
 */
export type ExtendedCapabilityName =
  | 'catalogDiscovery'
  | 'installedDiscovery'
  | 'ownedLibrarySync'
  | 'recentlyPlayed'
  | 'playtime'
  | 'artwork'
  | 'storeMetadata'
  | 'ratings'
  | 'popularity';

export interface ProviderCapability {
  provider: LinkedLibraryProvider;
  displayName: string;
  /** Can SOLITH detect an INSTALLED copy on this machine without any account auth? */
  localDiscoverySupported: boolean;
  /** Can SOLITH determine the full OWNED library (including uninstalled titles)? Requires account auth SOLITH does not implement for any provider today. */
  fullOwnershipSupported: boolean;
  /** Would enabling full ownership require the user to authorize an account connection? */
  accountAuthorizationRequired: boolean;
  /** Where this is implemented, for provenance — null when nothing exists yet. */
  implementationFile: string | null;
  /**
   * Mission 19 — three-level installed-detection honesty scale, derived
   * from (never contradicting) `localDiscoverySupported` plus each
   * provider's real documented reliability caveat: 'supported' means a
   * real, reasonably reliable scanner exists (localDiscoverySupported:
   * true); 'partial' means real code exists and runs but its output is not
   * reliable enough to present as working (xbox.ts's opaque AppX package
   * enumeration, ea.ts's unverified-for-new-installs registry key,
   * battle-net.ts's non-exhaustive shared-Uninstall-key signal —
   * localDiscoverySupported stays false for all three, matching this
   * level); 'unsupported' means no implementation attempt exists at all
   * (no provider currently falls in this category).
   */
  installedDetectionLevel: CapabilityLevel;
  /**
   * Mission 19 — three-level ownership-detection honesty scale. Every
   * provider is 'unsupported' today: no provider has a real, wired-up
   * ownership signal (fullOwnershipSupported is false everywhere — see the
   * Mission 6 audit above). GOG's local Galaxy client DB is a real
   * possibility for a FUTURE 'partial' level per that audit, but is
   * explicitly NOT implemented in this pass, so it stays 'unsupported' here
   * too — never claim a capability code doesn't actually have.
   */
  ownershipDetectionLevel: CapabilityLevel;
  /**
   * Mission 19 — honest label for where ANY ownership-adjacent evidence
   * would come from for this provider today. Always 'unavailable' while
   * ownershipDetectionLevel is 'unsupported' for every provider — installed-
   * only local metadata is evidence of INSTALL, never of ownership (see
   * personal-library/model.ts's resolveOwnership), so it must never be
   * mislabeled as an ownership source.
   */
  ownershipSource: OwnershipEvidenceSource;
  /**
   * ROADMAP §online-foundation (Mission 4) — the full honest capability matrix
   * (see ExtendedCapabilityName). Additive to the fields above; never
   * contradicts them (e.g. a provider whose installedDetectionLevel is
   * 'unsupported'/'partial' cannot have installedDiscovery: 'SUPPORTED' here).
   */
  capabilities: Record<ExtendedCapabilityName, ExtendedCapabilityStatus>;
}

export const PROVIDER_CAPABILITIES: Record<LinkedLibraryProvider, ProviderCapability> = {
  steam: {
    provider: 'steam',
    displayName: 'Steam',
    localDiscoverySupported: true,
    fullOwnershipSupported: false,
    accountAuthorizationRequired: true,
    implementationFile: 'src/core/install-discovery/steam.ts',
    installedDetectionLevel: 'supported',
    ownershipDetectionLevel: 'unsupported',
    ownershipSource: 'unavailable',
    capabilities: {
      // No app-list/catalog fetcher exists in this codebase today.
      catalogDiscovery: 'UNSUPPORTED',
      installedDiscovery: 'SUPPORTED',
      // Steam Web API GetOwnedGames is a real, documented path (see Mission 6
      // audit above) but requires a user-provided API key + public profile —
      // not implemented here yet.
      ownedLibrarySync: 'REQUIRES_AUTH',
      recentlyPlayed: 'REQUIRES_AUTH',
      playtime: 'REQUIRES_AUTH',
      // Real, wired-up today: fetch-policy.ts allowlists Steam's CDN hosts
      // and steamCdnImages() is actually used.
      artwork: 'SUPPORTED',
      storeMetadata: 'UNSUPPORTED',
      ratings: 'UNSUPPORTED',
      popularity: 'UNSUPPORTED',
    },
  },
  gog: {
    provider: 'gog',
    displayName: 'GOG',
    localDiscoverySupported: true,
    fullOwnershipSupported: false,
    accountAuthorizationRequired: true,
    implementationFile: 'src/core/install-discovery/gog.ts',
    installedDetectionLevel: 'supported',
    ownershipDetectionLevel: 'unsupported',
    ownershipSource: 'unavailable',
    capabilities: {
      catalogDiscovery: 'UNSUPPORTED',
      installedDiscovery: 'SUPPORTED',
      // GOG Galaxy's local synced-library DB is a real possibility (Mission 6
      // audit) but explicitly NOT implemented — undocumented schema, depends
      // on the user having run/synced Galaxy.
      ownedLibrarySync: 'REQUIRES_AUTH',
      recentlyPlayed: 'UNSUPPORTED',
      playtime: 'UNSUPPORTED',
      artwork: 'UNSUPPORTED',
      storeMetadata: 'UNSUPPORTED',
      ratings: 'UNSUPPORTED',
      popularity: 'UNSUPPORTED',
    },
  },
  epic: {
    provider: 'epic',
    displayName: 'Epic Games',
    localDiscoverySupported: true,
    fullOwnershipSupported: false,
    accountAuthorizationRequired: true,
    implementationFile: 'src/core/install-discovery/epic.ts',
    installedDetectionLevel: 'supported',
    ownershipDetectionLevel: 'unsupported',
    ownershipSource: 'unavailable',
    capabilities: {
      catalogDiscovery: 'UNSUPPORTED',
      installedDiscovery: 'SUPPORTED',
      // Epic's authenticated Games API is a real, documented path (Mission 6
      // audit) but requires account-authorized OAuth — not implemented here.
      ownedLibrarySync: 'REQUIRES_AUTH',
      recentlyPlayed: 'UNSUPPORTED',
      playtime: 'UNSUPPORTED',
      artwork: 'UNSUPPORTED',
      storeMetadata: 'UNSUPPORTED',
      ratings: 'UNSUPPORTED',
      popularity: 'UNSUPPORTED',
    },
  },
  xbox: {
    provider: 'xbox',
    displayName: 'Xbox / Microsoft Store',
    // PARTIAL: xbox.ts reads the real AppX/MSIX package registration key
    // (HKCR\...\AppModel\Repository\Packages\<PackageFullName>,
    // PackageRootFolder value) via the same registry-win.ts helpers as
    // every other provider — no PowerShell, no elevation. Subkey names are
    // still opaque, not human-readable game titles, and the same key
    // enumerates every AppX package on the machine — system components and
    // Store apps alongside actual games. A prior pass filtered only via a
    // blacklist of known Microsoft framework/runtime package prefixes,
    // which left every non-blacklisted non-game (Calculator, Photos,
    // Camera, third-party utilities/codecs) passing through as a
    // "plausible game." xbox.ts now additionally requires a genuine
    // positive signal: it reads each candidate's `AppxManifest.xml` (a
    // mandatory, always-present file at the package's install root for any
    // AppX/MSIX package — not a guess) and only accepts the package if
    // that manifest declares a `PackageDependency` on a known Xbox Live /
    // Gaming Services runtime family, or the documented
    // `gamingDeviceInformation` `DeviceCapability` — real signals that the
    // package integrates with Xbox/Gaming Services APIs, which non-game
    // apps have no reason to declare. No undocumented/guessed field is
    // read, and no genre/category metadata is used (that data does not
    // exist locally — only in the Store's server-side catalog). Still kept
    // at PARTIAL rather than promoted to SUPPORTED: the corroboration
    // requirement is fail-closed, so a real game with no Xbox Live/Gaming
    // Services integration at all (very old or minimal indie UWP titles)
    // could now be missed — trading the previous false-positive-heavy
    // behavior for a more conservative one that can still be wrong in the
    // opposite direction. `implementationFile` is still set because a
    // real, corroborated attempt exists and its output is a real signal
    // even though it is not presented as SUPPORTED.
    localDiscoverySupported: false,
    fullOwnershipSupported: false,
    accountAuthorizationRequired: true,
    implementationFile: 'src/core/install-discovery/xbox.ts',
    installedDetectionLevel: 'partial',
    ownershipDetectionLevel: 'unsupported',
    ownershipSource: 'unavailable',
    capabilities: {
      catalogDiscovery: 'UNSUPPORTED',
      installedDiscovery: 'PARTIAL',
      ownedLibrarySync: 'UNSUPPORTED',
      recentlyPlayed: 'UNSUPPORTED',
      playtime: 'UNSUPPORTED',
      artwork: 'UNSUPPORTED',
      storeMetadata: 'UNSUPPORTED',
      ratings: 'UNSUPPORTED',
      popularity: 'UNSUPPORTED',
    },
  },
  ubisoft: {
    provider: 'ubisoft',
    displayName: 'Ubisoft Connect',
    // SUPPORTED: ubisoft.ts reads HKLM\SOFTWARE\WOW6432Node\Ubisoft\
    // Launcher\Installs\<gameId>, an InstallDir string value per installed
    // title. This is the same well-established registry-subkey shape GOG
    // uses (see gog.ts) and is reasonably confident to work across common
    // real Ubisoft Connect installs. Executable resolution falls back to a
    // shallow top-level .exe scan (no per-title executable name list
    // exists for Ubisoft titles in this codebase), which is a real but
    // acceptable limitation, not a reliability blocker for the install
    // signal itself.
    localDiscoverySupported: true,
    fullOwnershipSupported: false,
    accountAuthorizationRequired: true,
    implementationFile: 'src/core/install-discovery/ubisoft.ts',
    installedDetectionLevel: 'supported',
    ownershipDetectionLevel: 'unsupported',
    ownershipSource: 'unavailable',
    capabilities: {
      catalogDiscovery: 'UNSUPPORTED',
      installedDiscovery: 'SUPPORTED',
      ownedLibrarySync: 'UNSUPPORTED',
      recentlyPlayed: 'UNSUPPORTED',
      playtime: 'UNSUPPORTED',
      artwork: 'UNSUPPORTED',
      storeMetadata: 'UNSUPPORTED',
      ratings: 'UNSUPPORTED',
      popularity: 'UNSUPPORTED',
    },
  },
  ea: {
    provider: 'ea',
    displayName: 'EA app',
    // PARTIAL: ea.ts now reads two independently-verifiable sources: (1)
    // the classic Origin registry shape, HKLM\SOFTWARE\WOW6432Node\Origin
    // Games\<offerId> with an `Install Dir` value (same registry-subkey
    // pattern as gog.ts), and (2) the standard, Microsoft-documented
    // Windows uninstall registry
    // (HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\
    // Uninstall\<ProductCode>), filtered to Publisher containing
    // "Electronic Arts" and with EA's own launcher/service/redistributable
    // entries excluded by name — a real signal for EA Desktop-native
    // titles that never touch any EA-proprietary format. Still marked
    // PARTIAL rather than SUPPORTED because source (2)'s game-vs-non-game
    // filtering is a name-based heuristic (same category of limitation as
    // xbox.ts's AppX package filtering) rather than a field that reliably
    // and structurally distinguishes "game" from "other EA-published
    // software" the way GOG's/Ubisoft's dedicated registry keys do.
    // Deliberately still NOT implemented: parsing `%PROGRAMDATA%\Origin\
    // LocalContent\<offerId>\*.mfst` manifests or `%PROGRAMDATA%\EA
    // Desktop\`'s own local database/manifest files — no publicly
    // documented, stable schema exists for either, and EA has changed the
    // EA Desktop local manifest shape across client versions without
    // notice (see the doc comment at the top of ea.ts).
    localDiscoverySupported: false,
    fullOwnershipSupported: false,
    accountAuthorizationRequired: true,
    implementationFile: 'src/core/install-discovery/ea.ts',
    installedDetectionLevel: 'partial',
    ownershipDetectionLevel: 'unsupported',
    ownershipSource: 'unavailable',
    capabilities: {
      catalogDiscovery: 'UNSUPPORTED',
      installedDiscovery: 'PARTIAL',
      ownedLibrarySync: 'UNSUPPORTED',
      recentlyPlayed: 'UNSUPPORTED',
      playtime: 'UNSUPPORTED',
      artwork: 'UNSUPPORTED',
      storeMetadata: 'UNSUPPORTED',
      ratings: 'UNSUPPORTED',
      popularity: 'UNSUPPORTED',
    },
  },
  battlenet: {
    provider: 'battlenet',
    displayName: 'Battle.net',
    // PARTIAL (re-investigated): `%PROGRAMDATA%\Battle.net\Agent\
    // product.db` stays rejected as an undocumented protobuf format with no
    // bundled schema — reverse-engineering it remains out of scope. But
    // battle-net.ts found a real, documented, plain-string local signal:
    // Blizzard's shared uninstaller registers a standard Windows
    // "Programs and Features" entry per installed title under
    // HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\
    // <GameDisplayName> (and the non-WOW6432Node equivalent) — the same
    // documented Windows Installer Uninstall-key contract Steam/GOG-style
    // installers use, populated by Blizzard's own installer. DisplayIcon
    // typically carries the game's real executable path and/or
    // InstallLocation the install folder; UninstallString/Publisher give a
    // corroborating Blizzard-specific marker to reject the many unrelated
    // apps also registered under that same shared key.
    //
    // Marked PARTIAL rather than SUPPORTED because that Uninstall key holds
    // every installed Windows application (requires the per-subkey
    // corroboration check in battle-net.ts's looksLikeBattleNetEntry), and
    // because — unlike Ubisoft's launcher-written Installs registry key —
    // community reports describe titles occasionally missing from
    // Programs-and-Features after certain repair/update flows, so this
    // signal cannot be treated as exhaustive the way Ubisoft's is.
    localDiscoverySupported: false,
    fullOwnershipSupported: false,
    accountAuthorizationRequired: true,
    implementationFile: 'src/core/install-discovery/battle-net.ts',
    installedDetectionLevel: 'partial',
    ownershipDetectionLevel: 'unsupported',
    ownershipSource: 'unavailable',
    capabilities: {
      catalogDiscovery: 'UNSUPPORTED',
      installedDiscovery: 'PARTIAL',
      ownedLibrarySync: 'UNSUPPORTED',
      recentlyPlayed: 'UNSUPPORTED',
      playtime: 'UNSUPPORTED',
      artwork: 'UNSUPPORTED',
      storeMetadata: 'UNSUPPORTED',
      ratings: 'UNSUPPORTED',
      popularity: 'UNSUPPORTED',
    },
  },
};

export function listProviderCapabilities(): ProviderCapability[] {
  return Object.values(PROVIDER_CAPABILITIES);
}
