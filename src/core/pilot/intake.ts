import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  RealWorldPilotManifest,
  RealWorldPilotManifestSchema,
  REJECTED_FORMATS,
  PILOT_SCHEMA_VERSION,
} from './manifest.js';
import { validatePathSafety } from '../safety/path-safety.js';

// Directories that must never be used as pilot source
const ALWAYS_BLOCKED_SOURCE_PREFIXES = [
  path.resolve(process.cwd()),   // repo working tree / installation directory
];

export interface PilotIntakeInput {
  gameName: string;
  gameVersion: string;
  gameStore: 'steam' | 'gog' | 'epic' | 'itch' | 'disc' | 'other';
  sourceSavePath: string;
  workspaceRootDir: string;
  confirmations: {
    singlePlayerConfirmed: true;
    gameClosed: true;
    userOwned: true;
    copyPermission: true;
    noGit: true;
    cloudSyncDisabled: boolean;
  };
  cloudSyncRisk: 'none' | 'low' | 'high';
}

export interface PilotIntakeResult {
  success: true;
  manifest: RealWorldPilotManifest;
  manifestPath: string;
}

export interface PilotIntakeError {
  success: false;
  error: string;
}

function sha256(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function detectFormat(filePath: string): RealWorldPilotManifest['save']['format'] {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const map: Record<string, RealWorldPilotManifest['save']['format']> = {
    json: 'json', ini: 'ini', xml: 'xml', csv: 'csv', txt: 'text', cfg: 'ini', conf: 'ini',
    bin: 'binary', dat: 'binary', sav: 'binary',
  };
  return map[ext] ?? 'unknown';
}

function isBlockedSourcePath(sourcePath: string, workspaceRootDir: string): boolean {
  const canonical = path.resolve(sourcePath).toLowerCase();
  const blocked = [...ALWAYS_BLOCKED_SOURCE_PREFIXES, path.resolve(workspaceRootDir)];
  return blocked.some(prefix =>
    canonical.startsWith(prefix.toLowerCase() + path.sep) || canonical === prefix.toLowerCase()
  );
}

export async function intakePilotSave(
  input: PilotIntakeInput
): Promise<PilotIntakeResult | PilotIntakeError> {
  const { sourceSavePath, workspaceRootDir, confirmations } = input;

  // 1. Source must exist
  if (!fs.existsSync(sourceSavePath)) {
    return { success: false, error: `Source save file not found: ${sourceSavePath}` };
  }

  // 2. Source must not be inside blocked directories
  if (isBlockedSourcePath(sourceSavePath, workspaceRootDir)) {
    return { success: false, error: 'Source save must not be inside the repo, temp, or installation directories.' };
  }

  // 3. Path safety check on source
  const safety = validatePathSafety(sourceSavePath);
  if (!safety.safe) {
    return { success: false, error: `Source path rejected: ${safety.reason}` };
  }

  // 4. Detect format and reject binary/unknown early
  const format = detectFormat(sourceSavePath);

  // 5. Hash source before copy
  const sourceHash = sha256(sourceSavePath);

  // 6. Create workspace directory
  const pilotId = `pilot-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const workspaceDir = path.join(workspaceRootDir, pilotId, 'workspace');
  const backupDir    = path.join(workspaceRootDir, pilotId, 'backup');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(backupDir,    { recursive: true });

  // 7. Copy to workspace
  const ext = path.extname(sourceSavePath);
  const workspaceSavePath = path.join(workspaceDir, `save${ext}`);
  fs.copyFileSync(sourceSavePath, workspaceSavePath);

  // 8. Hash workspace copy
  const workspaceHash = sha256(workspaceSavePath);

  // 9. Verify source unchanged (hash still matches)
  const sourceHashAfter = sha256(sourceSavePath);
  if (sourceHashAfter !== sourceHash) {
    fs.rmSync(path.join(workspaceRootDir, pilotId), { recursive: true, force: true });
    return { success: false, error: 'Source file changed during copy — intake aborted.' };
  }

  // 10. Verify workspace copy matches source
  if (workspaceHash !== sourceHash) {
    fs.rmSync(path.join(workspaceRootDir, pilotId), { recursive: true, force: true });
    return { success: false, error: 'Workspace copy hash mismatch — copy failed or file was modified.' };
  }

  // 11. Create backup of workspace copy
  const backupPath = path.join(backupDir, `save-backup${ext}`);
  fs.copyFileSync(workspaceSavePath, backupPath);

  // 12. Build manifest
  const manifest: RealWorldPilotManifest = RealWorldPilotManifestSchema.parse({
    schemaVersion: PILOT_SCHEMA_VERSION,
    pilotId,
    createdAt: new Date().toISOString(),

    game: {
      title: input.gameName,
      version: input.gameVersion,
      store: input.gameStore,
      singlePlayerConfirmed: confirmations.singlePlayerConfirmed,
    },

    save: {
      sourcePath: sourceSavePath,
      extension: ext || '.unknown',
      format,
      cloudSyncRisk: input.cloudSyncRisk,
      sourceHashSha256: sourceHash,
    },

    workspace: {
      workspacePath: workspaceSavePath,
      workspaceHashSha256: workspaceHash,
      backupPath,
    },

    confirmations: {
      gameClosed: confirmations.gameClosed,
      userOwned: confirmations.userOwned,
      copyPermission: confirmations.copyPermission,
      noGit: confirmations.noGit,
      cloudSyncDisabled: confirmations.cloudSyncDisabled,
    },

    formatStatus: REJECTED_FORMATS.has(format) ? 'REJECTED' : 'ACCEPTED',
  });

  // 13. Write manifest
  const manifestPath = path.join(workspaceRootDir, pilotId, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return { success: true, manifest, manifestPath };
}
