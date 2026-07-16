/**
 * @deprecated Phase 3 authoring cutover — do NOT add new game profiles or
 * executable save controls here as the capability SoT. Author schema.v1
 * `saveEditor.saveFields` (bundled definition / YAML import) instead, keeping
 * Milestone J field paths for Stardew. This catalog remains for support-matrix
 * UX and Phase 2 dual-read fallback until Phase 4 deletion approval.
 */
import type { GameProfile } from './types.js';
import { validateGameProfile } from './types.js';
import stardewProfileData from './profiles/stardew-valley.json';

export type ProfileSupportStatus = 'supported' | 'preview-only' | 'read-only' | 'blocked' | 'needs-review';
export type ProfileEvidenceLevel = 'none' | 'fixture-detected' | 'fixture-parsed' | 'fixture-validated' | 'backup-rollback-verified';
export type ProfileParserStatus = ProfileSupportStatus;
export type ProfileWriteSupportStatus = ProfileSupportStatus;
export type ProfileUnsupportedReason =
  | 'unknown-format'
  | 'missing-parser'
  | 'write-not-supported'
  | 'unsafe-path'
  | 'no-backup-strategy'
  | 'no-fixture'
  | 'no-rollback-proof'
  | 'outside-local-single-player-scope';

/**
 * @deprecated Phase 3 — do not add new profile catalog entries as capability SoT.
 * Author schema.v1 saveEditor definitions instead.
 */
export interface GameProfileCatalogEntry {
  catalogId: string;
  gameId: string;
  displayName: string;
  supportStatus: ProfileSupportStatus;
  parserStatus: ProfileParserStatus;
  writeSupportStatus: ProfileWriteSupportStatus;
  evidenceLevel: ProfileEvidenceLevel;
  supportedFormats: GameProfile['saveFormat'][];
  unsupportedReasons: ProfileUnsupportedReason[];
  fixtureReferences: string[];
  notes: string[];
  warnings: string[];
  localOnly: true;
  offlineOnly: true;
  singlePlayerOnly: true;
  profile: GameProfile;
}

export interface GameProfileCatalogValidationError {
  field: string;
  message: string;
}

const STATUS_ORDER: Record<ProfileSupportStatus, number> = {
  supported: 0,
  'preview-only': 1,
  'read-only': 2,
  'needs-review': 3,
  blocked: 4,
};

const VALID_SUPPORT_STATUSES = new Set<ProfileSupportStatus>([
  'supported',
  'preview-only',
  'read-only',
  'blocked',
  'needs-review',
]);

const VALID_EVIDENCE_LEVELS = new Set<ProfileEvidenceLevel>([
  'none',
  'fixture-detected',
  'fixture-parsed',
  'fixture-validated',
  'backup-rollback-verified',
]);

const VALID_UNSUPPORTED_REASONS = new Set<ProfileUnsupportedReason>([
  'unknown-format',
  'missing-parser',
  'write-not-supported',
  'unsafe-path',
  'no-backup-strategy',
  'no-fixture',
  'no-rollback-proof',
  'outside-local-single-player-scope',
]);

const VALID_SAVE_FORMATS = new Set<GameProfile['saveFormat']>([
  'xml',
  'json',
  'ini',
  'binary',
  'other',
]);

function isSafeBundledReference(value: string): boolean {
  if (!value || value.trim() !== value) return false;
  if (/^[a-z]+:\/\//i.test(value)) return false;
  if (/^[a-z]:[\\/]/i.test(value)) return false;
  if (value.startsWith('\\\\') || value.startsWith('/')) return false;
  if (value.split(/[\\/]+/).includes('..')) return false;
  return true;
}

function cloneProfile(profile: GameProfile): GameProfile {
  return JSON.parse(JSON.stringify(profile)) as GameProfile;
}

const STARDEW_PROFILE: GameProfile = cloneProfile(stardewProfileData as GameProfile);

const DEMO_PREVIEW_PROFILE: GameProfile = {
  profileVersion: '1.0.0',
  gameId: 'demo-rpg-preview',
  displayName: 'Demo RPG Quest Preview',
  saveFormat: 'json',
  saveRootHints: {
    windows: 'demo-game\\save',
  },
  gameVersionNotes: 'Bundled demo fixtures provide a read-only preview only. No executable write path is defined.',
  controls: [
    {
      id: 'demo-preview-gold',
      label: 'Gold (Preview)',
      description: 'Read-only value from the bundled JSON fixture.',
      category: 'PLAYER',
      controlType: 'readonly_value',
      backend: 'unsupported',
      safetyStatus: 'disabled',
      metadata: {
        valueType: 'number',
        defaultValue: 100,
        safeTestValue: 250,
        riskNotes: 'Preview only; no write path is defined for this catalog entry.',
      },
    },
    {
      id: 'demo-preview-level',
      label: 'Level (Preview)',
      description: 'Read-only preview of the player level value.',
      category: 'PLAYER',
      controlType: 'readonly_value',
      backend: 'unsupported',
      safetyStatus: 'disabled',
      metadata: {
        valueType: 'number',
        defaultValue: 15,
        safeTestValue: 18,
        riskNotes: 'Preview only; used for offline review workflows.',
      },
    },
  ],
};

const DEMO_BLOCKED_PROFILE: GameProfile = {
  profileVersion: '1.0.0',
  gameId: 'demo-data-blocked',
  displayName: 'Demo Data Blocked Profile',
  saveFormat: 'other',
  gameVersionNotes: 'Bundled data fixtures exist, but no safe parser/write path is available for this profile.',
  controls: [
    {
      id: 'demo-blocked-stats',
      label: 'Stats (Blocked)',
      description: 'Read-only placeholder that highlights unsupported data handling.',
      category: 'STATS',
      controlType: 'readonly_value',
      backend: 'unsupported',
      safetyStatus: 'disabled',
      metadata: {
        valueType: 'string',
        defaultValue: 'unavailable',
        safeTestValue: 'unavailable',
        riskNotes: 'Blocked because the format is unsupported for safe writes.',
      },
    },
  ],
};

export const BUNDLED_GAME_PROFILE_CATALOG: readonly GameProfileCatalogEntry[] = [
  {
    catalogId: 'stardew-valley',
    gameId: STARDEW_PROFILE.gameId,
    displayName: STARDEW_PROFILE.displayName,
    supportStatus: 'supported',
    parserStatus: 'supported',
    writeSupportStatus: 'supported',
    evidenceLevel: 'backup-rollback-verified',
    supportedFormats: ['xml'],
    unsupportedReasons: [],
    fixtureReferences: ['demo-game/save/stardew-fixture.xml'],
    notes: ['Existing supported XML profile with backup and rollback verification.'],
    warnings: [],
    localOnly: true,
    offlineOnly: true,
    singlePlayerOnly: true,
    profile: STARDEW_PROFILE,
  },
  {
    catalogId: 'demo-rpg-preview',
    gameId: DEMO_PREVIEW_PROFILE.gameId,
    displayName: DEMO_PREVIEW_PROFILE.displayName,
    supportStatus: 'preview-only',
    parserStatus: 'read-only',
    writeSupportStatus: 'blocked',
    evidenceLevel: 'fixture-parsed',
    supportedFormats: ['json'],
    unsupportedReasons: ['write-not-supported', 'no-backup-strategy', 'no-rollback-proof'],
    fixtureReferences: ['demo-game/save/save1.json', 'demo-game/save/save2.json'],
    notes: ['Bundled demo profile for offline preview and review only.'],
    warnings: ['No executable write path is defined for this profile.'],
    localOnly: true,
    offlineOnly: true,
    singlePlayerOnly: true,
    profile: DEMO_PREVIEW_PROFILE,
  },
  {
    catalogId: 'demo-data-blocked',
    gameId: DEMO_BLOCKED_PROFILE.gameId,
    displayName: DEMO_BLOCKED_PROFILE.displayName,
    supportStatus: 'blocked',
    parserStatus: 'blocked',
    writeSupportStatus: 'blocked',
    evidenceLevel: 'fixture-detected',
    supportedFormats: ['other'],
    unsupportedReasons: ['unknown-format', 'missing-parser', 'write-not-supported', 'no-backup-strategy'],
    fixtureReferences: ['demo-game/data/items.json', 'demo-game/data/player_stats.ini'],
    notes: ['Unsupported data profile used to exercise blocked-review handling.'],
    warnings: ['Unsupported format stays advisory only.'],
    localOnly: true,
    offlineOnly: true,
    singlePlayerOnly: true,
    profile: DEMO_BLOCKED_PROFILE,
  },
];

export function validateGameProfileCatalogEntry(entry: unknown): GameProfileCatalogValidationError[] {
  const errors: GameProfileCatalogValidationError[] = [];

  if (typeof entry !== 'object' || entry === null) {
    return [{ field: 'entry', message: 'Catalog entry must be a non-null object' }];
  }

  const e = entry as Partial<GameProfileCatalogEntry>;

  if (typeof e.catalogId !== 'string' || !e.catalogId.trim()) {
    errors.push({ field: 'catalogId', message: 'catalogId must be a non-empty string' });
  }
  if (typeof e.gameId !== 'string' || !e.gameId.trim()) {
    errors.push({ field: 'gameId', message: 'gameId must be a non-empty string' });
  }
  if (typeof e.displayName !== 'string' || !e.displayName.trim()) {
    errors.push({ field: 'displayName', message: 'displayName must be a non-empty string' });
  }
  if (!VALID_SUPPORT_STATUSES.has(e.supportStatus as ProfileSupportStatus)) {
    errors.push({ field: 'supportStatus', message: `supportStatus must be one of: ${[...VALID_SUPPORT_STATUSES].join(', ')}` });
  }
  if (!VALID_SUPPORT_STATUSES.has(e.parserStatus as ProfileParserStatus)) {
    errors.push({ field: 'parserStatus', message: `parserStatus must be one of: ${[...VALID_SUPPORT_STATUSES].join(', ')}` });
  }
  if (!VALID_SUPPORT_STATUSES.has(e.writeSupportStatus as ProfileWriteSupportStatus)) {
    errors.push({ field: 'writeSupportStatus', message: `writeSupportStatus must be one of: ${[...VALID_SUPPORT_STATUSES].join(', ')}` });
  }
  if (!VALID_EVIDENCE_LEVELS.has(e.evidenceLevel as ProfileEvidenceLevel)) {
    errors.push({ field: 'evidenceLevel', message: `evidenceLevel must be one of: ${[...VALID_EVIDENCE_LEVELS].join(', ')}` });
  }
  if (e.localOnly !== true) {
    errors.push({ field: 'localOnly', message: 'localOnly must be true' });
  }
  if (e.offlineOnly !== true) {
    errors.push({ field: 'offlineOnly', message: 'offlineOnly must be true' });
  }
  if (e.singlePlayerOnly !== true) {
    errors.push({ field: 'singlePlayerOnly', message: 'singlePlayerOnly must be true' });
  }

  const profileErrors = validateGameProfile(e.profile);
  for (const err of profileErrors) {
    errors.push({ field: `profile.${err.field}`, message: err.message });
  }
  if (typeof e.profile === 'object' && e.profile !== null) {
    const profile = e.profile as GameProfile;
    if (typeof profile.gameId === 'string' && profile.gameId !== e.gameId) {
      errors.push({ field: 'gameId', message: 'gameId must match profile.gameId' });
    }
    if (typeof profile.displayName === 'string' && profile.displayName !== e.displayName) {
      errors.push({ field: 'displayName', message: 'displayName must match profile.displayName' });
    }
    if (Array.isArray(e.supportedFormats) && !e.supportedFormats.includes(profile.saveFormat)) {
      errors.push({ field: 'supportedFormats', message: 'supportedFormats must include profile.saveFormat' });
    }
  }

  if (!Array.isArray(e.supportedFormats) || e.supportedFormats.length === 0) {
    errors.push({ field: 'supportedFormats', message: 'supportedFormats must be a non-empty array' });
  } else {
    for (let i = 0; i < e.supportedFormats.length; i++) {
      const format = e.supportedFormats[i];
      if (!VALID_SAVE_FORMATS.has(format)) {
        errors.push({ field: `supportedFormats[${i}]`, message: `Unsupported save format: ${String(format)}` });
      }
    }
  }

  if (!Array.isArray(e.unsupportedReasons)) {
    errors.push({ field: 'unsupportedReasons', message: 'unsupportedReasons must be an array' });
  } else {
    for (let i = 0; i < e.unsupportedReasons.length; i++) {
      const reason = e.unsupportedReasons[i];
      if (!VALID_UNSUPPORTED_REASONS.has(reason)) {
        errors.push({ field: `unsupportedReasons[${i}]`, message: `Unsupported reason: ${String(reason)}` });
      }
    }
  }

  if (!Array.isArray(e.fixtureReferences) || e.fixtureReferences.length === 0) {
    errors.push({ field: 'fixtureReferences', message: 'fixtureReferences must be a non-empty array' });
  } else {
    for (let i = 0; i < e.fixtureReferences.length; i++) {
      const ref = e.fixtureReferences[i];
      if (typeof ref !== 'string' || !ref.trim()) {
        errors.push({ field: `fixtureReferences[${i}]`, message: 'fixture reference must be a non-empty string' });
      } else if (!isSafeBundledReference(ref)) {
        errors.push({ field: `fixtureReferences[${i}]`, message: 'fixture reference must be bundled and relative' });
      }
    }
  }

  if (!Array.isArray(e.notes)) {
    errors.push({ field: 'notes', message: 'notes must be an array' });
  }
  if (!Array.isArray(e.warnings)) {
    errors.push({ field: 'warnings', message: 'warnings must be an array' });
  }

  return errors;
}

export function validateBundledGameProfileCatalog(): GameProfileCatalogValidationError[] {
  const errors: GameProfileCatalogValidationError[] = [];
  const ids = new Set<string>();

  for (let i = 0; i < BUNDLED_GAME_PROFILE_CATALOG.length; i++) {
    const entry = BUNDLED_GAME_PROFILE_CATALOG[i];
    const entryErrors = validateGameProfileCatalogEntry(entry);
    for (const err of entryErrors) {
      errors.push({ field: `catalog[${i}].${err.field}`, message: err.message });
    }

    if (ids.has(entry.catalogId)) {
      errors.push({ field: `catalog[${i}].catalogId`, message: `Duplicate catalogId: ${entry.catalogId}` });
    }
    ids.add(entry.catalogId);
  }

  return errors;
}

export function getBundledGameProfileCatalog(): readonly GameProfileCatalogEntry[] {
  return [...BUNDLED_GAME_PROFILE_CATALOG].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.supportStatus] - STATUS_ORDER[b.supportStatus];
    if (byStatus !== 0) return byStatus;
    const byName = a.displayName.localeCompare(b.displayName);
    if (byName !== 0) return byName;
    return a.catalogId.localeCompare(b.catalogId);
  });
}

export function getBundledGameProfileCatalogEntry(catalogId: string): GameProfileCatalogEntry | undefined {
  return getBundledGameProfileCatalog().find(entry => entry.catalogId === catalogId);
}
