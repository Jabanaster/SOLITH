import { z } from 'zod';
import path from 'node:path';

export const RealWorldPilotManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  pilotId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),

  game: z.object({
    title: z.string().min(1),
    version: z.string().min(1),
    store: z.enum(['steam', 'gog', 'epic', 'itch', 'disc', 'other']),
    singlePlayerConfirmed: z.literal(true),
  }),

  save: z.object({
    sourcePath: z.string().min(1),
    extension: z.string().min(1),
    format: z.enum(['json', 'ini', 'xml', 'csv', 'text', 'binary', 'unknown']),
    cloudSyncRisk: z.enum(['none', 'low', 'high']),
    sourceHashSha256: z.string().length(64),
  }),

  workspace: z.object({
    workspacePath: z.string().min(1),
    workspaceHashSha256: z.string().length(64),
    backupPath: z.string().min(1),
  }),

  confirmations: z.object({
    gameClosed: z.literal(true),
    userOwned: z.literal(true),
    copyPermission: z.literal(true),
    noGit: z.literal(true),
    cloudSyncDisabled: z.boolean(),
  }),

  formatStatus: z.enum(['ACCEPTED', 'REJECTED', 'PENDING']),
});

export type RealWorldPilotManifest = z.infer<typeof RealWorldPilotManifestSchema>;

export const REJECTED_FORMATS = new Set([
  'binary',
  'unknown',
]);

export const PILOT_SCHEMA_VERSION = '1.0' as const;

export interface PilotReadinessResult {
  ready: boolean;
  reasons: string[];
}

export type PilotGameClassification = 'offline_single_player' | 'online' | 'multiplayer';

export interface CompatibilityPilotReportInput {
  manifest: RealWorldPilotManifest;
  gameClassification: PilotGameClassification;
  fixtureEvidenceConfirmed: boolean;
}

export interface CompatibilityPilotReport {
  ready: boolean;
  gameName: string;
  format: RealWorldPilotManifest['save']['format'];
  sampleFileEvidence: {
    fileName: string;
    sha256: string;
  };
  cloudSyncRisk: RealWorldPilotManifest['save']['cloudSyncRisk'];
  supportedOperations: string[];
  blockedOperations: string[];
  requiredManualChecks: string[];
  executableControlsEnabled: false;
  errors: string[];
}

export function assessPilotReadiness(manifest: RealWorldPilotManifest): PilotReadinessResult {
  const reasons: string[] = [];

  if (!manifest.game.singlePlayerConfirmed) {
    reasons.push('single_player_not_confirmed');
  }
  if (!manifest.confirmations.gameClosed) {
    reasons.push('game_must_be_closed');
  }
  if (!manifest.confirmations.userOwned) {
    reasons.push('user_ownership_not_confirmed');
  }
  if (!manifest.confirmations.copyPermission) {
    reasons.push('copy_permission_not_confirmed');
  }
  if (!manifest.confirmations.noGit) {
    reasons.push('source_must_not_be_git_tracked');
  }
  if (manifest.save.cloudSyncRisk === 'high' && !manifest.confirmations.cloudSyncDisabled) {
    reasons.push('high_cloud_sync_risk_requires_disabled_sync');
  }
  if (REJECTED_FORMATS.has(manifest.save.format)) {
    reasons.push('save_format_not_ready_for_pilot');
  }
  if (manifest.formatStatus !== 'ACCEPTED') {
    reasons.push('format_status_not_accepted');
  }

  return { ready: reasons.length === 0, reasons };
}

function supportedReadOnlyOperations(format: RealWorldPilotManifest['save']['format']): string[] {
  if (REJECTED_FORMATS.has(format)) return [];
  if (format === 'json' || format === 'ini' || format === 'xml') {
    return ['inspect_sample', 'read_save_fields', 'proposal_preview'];
  }
  if (format === 'csv' || format === 'text') {
    return ['inspect_sample'];
  }
  return [];
}

export function createCompatibilityPilotReport(input: CompatibilityPilotReportInput): CompatibilityPilotReport {
  const readiness = assessPilotReadiness(input.manifest);
  const errors = [...readiness.reasons];
  const blockedOperations = ['write_execution', 'rollback_execution', 'executable_controls'];

  if (input.gameClassification !== 'offline_single_player') {
    errors.push('pilot_requires_offline_single_player_classification');
    blockedOperations.push('online_or_multiplayer_pilot');
  }

  if (!input.fixtureEvidenceConfirmed) {
    errors.push('fixture_or_safe_sample_evidence_required');
  }

  if (input.manifest.save.cloudSyncRisk === 'high') {
    blockedOperations.push('cloud_sync_risk_high');
  }

  return {
    ready: errors.length === 0,
    gameName: input.manifest.game.title,
    format: input.manifest.save.format,
    sampleFileEvidence: {
      fileName: path.basename(input.manifest.workspace.workspacePath),
      sha256: input.manifest.workspace.workspaceHashSha256,
    },
    cloudSyncRisk: input.manifest.save.cloudSyncRisk,
    supportedOperations: supportedReadOnlyOperations(input.manifest.save.format),
    blockedOperations: [...new Set(blockedOperations)].sort((a, b) => a.localeCompare(b)),
    requiredManualChecks: [
      'confirm_game_remains_offline_single_player',
      'review_cloud_sync_state_before_any_future_write_scope',
      'validate_profile_against_fixture_before_manual_approval',
      'keep executable controls disabled until separately accepted',
    ],
    executableControlsEnabled: false,
    errors: [...new Set(errors)].sort((a, b) => a.localeCompare(b)),
  };
}
