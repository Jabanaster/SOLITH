import { z } from 'zod';

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
