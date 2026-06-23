import { z } from 'zod';

/**
 * Compatibility Profile Schema
 *
 * A versioned profile captures everything ResourceForge knows about a game's
 * compatibility, save format, and validation history. Profiles are never mutated
 * in-place; updates always create new versions.
 *
 * Constraint: schemaVersion must always match the running version of ResourceForge
 * to prevent drift. Recipes link to profiles via gameId + fingerprintHash to detect
 * when the game's executable or save structure has changed.
 */

export const CompatibilityProfileSchema = z.object({
  // Profile identity & versioning
  schemaVersion: z.string().default('1.0.0'),
  id: z.string().uuid(),
  gameId: z.string().uuid(),
  gameName: z.string().min(1, 'Game name required'),

  // Store and registration
  store: z.enum(['Steam', 'Epic', 'GOG', 'Custom', 'Unknown']).default('Unknown'),
  storeAppId: z.string().optional(),

  // Executable metadata (for process detection and fingerprinting)
  executableNames: z.array(z.string()).default([]),
  executableHash: z.string().optional(), // SHA-256 of main executable for drift detection

  // Game structure metadata
  engine: z.enum(['Unity', 'Unreal', 'Custom', 'Unknown']).default('Unknown'),
  publisherHints: z.array(z.string()).default([]),
  developerHints: z.array(z.string()).default([]),

  // Save and config locations (from scanner evidence)
  saveLocationPatterns: z.array(z.string()).default([]),
  configLocationPatterns: z.array(z.string()).default([]),

  // Adapter support
  supportedAdapters: z.array(z.string()).default([]),

  // Game and save format version
  gameVersion: z.string().optional(),
  saveFormatVersion: z.string().optional(),

  // Fingerprint for drift detection
  fingerprint: z.object({
    executableHashSHA256: z.string().optional(),
    saveStructureSignature: z.string().optional(),
    saveFormatVersion: z.string().optional(),
    adapterVersions: z.record(z.string(), z.string()).optional(),
    markerValues: z.record(z.string(), z.unknown()).optional(),
  }).default({}),

  // Validation status and history
  validationStatus: z.enum([
    'VERIFIED',     // End-to-end tested against specific game version and save format
    'SUPPORTED',    // Adapter compatible, limited testing
    'READ_ONLY',    // Detect/inspect/compare only, cannot safely write
    'EXPERIMENTAL', // Limited sandbox-only, clear warning
    'UNSUPPORTED',  // No safe adapter
    'BLOCKED',      // Requires prohibited behavior (e.g., anti-cheat, DRM)
  ]).default('UNSUPPORTED'),

  // Compatibility limitations and warnings
  limitations: z.array(z.string()).default([]),

  // Metadata
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  lastValidatedAt: z.string().datetime().optional(),

  // Cloud sync detection
  hasCloudSync: z.boolean().default(false),
  cloudSyncWarning: z.string().optional(),
});

export type CompatibilityProfile = z.infer<typeof CompatibilityProfileSchema>;

/**
 * Profile validation schema — for runtime checks
 */
export const ProfileValidationSchema = z.object({
  id: z.string().uuid(),
  status: CompatibilityProfileSchema.shape.validationStatus,
  checkedAt: z.string().datetime(),
  passed: z.boolean(),
  evidence: z.array(z.string()).default([]),
  fingerprint: CompatibilityProfileSchema.shape.fingerprint,
});

export type ProfileValidation = z.infer<typeof ProfileValidationSchema>;
