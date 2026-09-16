/**
 * Provider normalization (ROADMAP.md Phase 3: "Provider normalization").
 *
 * Audited for the described chaos (arbitrary "Steam"/"steam"/"STEAM"/
 * "Valve" string variants scattered across the codebase) and found the real
 * defect is structural, not casing: three independently-declared,
 * overlapping-but-incompatible provider enumerations exist with no bridge
 * between them —
 *   - InstallPlatform (install-discovery/types.ts): steam/epic/gog/xbox/
 *     ubisoft/ea/battlenet/manual
 *   - ModPack.platform (trainer-catalog/types.ts): steam/epic/xbox-game-pass/
 *     standalone/unknown
 *   - bundled-community-games.ts's own inline platform union: steam/epic/
 *     xbox-game-pass/standalone
 * Each is already a real TypeScript literal union (not a raw string), so
 * casing chaos cannot occur at any individual call site — but nothing
 * connects "an install discovered as InstallPlatform 'xbox'" to "a mod-pack
 * declared for ModPack.platform 'xbox-game-pass'" as the same real-world
 * provider. This module is that bridge: one canonical representation, with
 * explicit typed mappings (not string-matching) from each existing union,
 * so neither existing type has to change (no persisted-schema migration).
 */
import type { InstallPlatform } from './types.js';
import type { ModPack } from '../trainer-catalog/types.js';

export type CanonicalProvider =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'xbox'
  | 'ubisoft'
  | 'ea'
  | 'battlenet'
  | 'standalone'
  | 'unknown';

/** Never destroys the original value — every normalization result keeps it for diagnostics. */
export interface NormalizedProvider {
  canonical: CanonicalProvider;
  raw: string;
}

const INSTALL_PLATFORM_TO_CANONICAL: Record<InstallPlatform, CanonicalProvider> = {
  steam: 'steam',
  epic: 'epic',
  gog: 'gog',
  xbox: 'xbox',
  ubisoft: 'ubisoft',
  ea: 'ea',
  battlenet: 'battlenet',
  manual: 'standalone',
};

const MOD_PACK_PLATFORM_TO_CANONICAL: Record<ModPack['platform'], CanonicalProvider> = {
  steam: 'steam',
  epic: 'epic',
  'xbox-game-pass': 'xbox',
  standalone: 'standalone',
  unknown: 'unknown',
};

export function normalizeInstallPlatform(platform: InstallPlatform): NormalizedProvider {
  return { canonical: INSTALL_PLATFORM_TO_CANONICAL[platform], raw: platform };
}

export function normalizeModPackPlatform(platform: ModPack['platform']): NormalizedProvider {
  return { canonical: MOD_PACK_PLATFORM_TO_CANONICAL[platform], raw: platform };
}

/**
 * Normalizes free-form provider text from a context that is not already one
 * of the two typed unions above (e.g. diagnostic logging, a future remote-
 * sync source that hasn't been given its own typed field yet). Real known
 * aliases only — never a fuzzy/partial match that could silently misfile an
 * unrelated provider. Returns 'unknown' (never throws) for anything not
 * recognized, with the original text preserved in `raw`.
 */
export function normalizeProviderLabel(rawLabel: string): NormalizedProvider {
  const key = rawLabel.trim().toLowerCase();
  const ALIASES: Record<string, CanonicalProvider> = {
    steam: 'steam',
    valve: 'steam',
    epic: 'epic',
    'epic games': 'epic',
    epicgames: 'epic',
    gog: 'gog',
    'gog.com': 'gog',
    xbox: 'xbox',
    'xbox game pass': 'xbox',
    'xbox-game-pass': 'xbox',
    'microsoft store': 'xbox',
    'ms store': 'xbox',
    ubisoft: 'ubisoft',
    'ubisoft connect': 'ubisoft',
    uplay: 'ubisoft',
    ea: 'ea',
    'ea app': 'ea',
    origin: 'ea',
    battlenet: 'battlenet',
    'battle.net': 'battlenet',
    manual: 'standalone',
    standalone: 'standalone',
  };
  return { canonical: ALIASES[key] ?? 'unknown', raw: rawLabel };
}

/**
 * Whether two providers from *either* of the typed unions (or free-form
 * text) refer to the same real-world storefront/launcher — the concrete
 * gap this module closes: previously nothing could answer "is this
 * install's platform the same provider as this trainer's declared
 * platform" across InstallPlatform vs ModPack.platform.
 */
export function sameCanonicalProvider(a: NormalizedProvider, b: NormalizedProvider): boolean {
  return a.canonical !== 'unknown' && a.canonical === b.canonical;
}
