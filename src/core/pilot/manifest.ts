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
