import crypto from 'node:crypto';
import path from 'node:path';
import type {
  InstallIdentityStatus,
  InstallPlatform,
  RawInstalledGame,
} from './types.js';

export const INSTALL_IDENTITY_VERSION = 2;

export interface InstallIdentity {
  installIdentity: string;
  canonicalInstallPath: string;
  canonicalExecutablePath?: string;
  launcherAppId?: string;
  identityStatus: InstallIdentityStatus;
  needsReverification: boolean;
}

function canonicalPath(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function stableHash(parts: Array<string | undefined>): string {
  return crypto.createHash('sha256').update(parts.map((part) => part ?? '').join('\0')).digest('hex');
}

export function launcherIdentity(game: Pick<RawInstalledGame, 'platform' | 'steamAppId' | 'launcherAppId'>): string | undefined {
  if (game.launcherAppId?.trim()) return game.launcherAppId.trim().toLowerCase();
  if (game.steamAppId != null) return `steam:${game.steamAppId}`;
  return undefined;
}

export function createPreviewCandidateId(game: RawInstalledGame): string {
  const installPath = canonicalPath(game.installPath) ?? '';
  const executablePath = canonicalPath(game.executablePath) ?? '';
  const appId = launcherIdentity(game) ?? '';
  return `preview:v${INSTALL_IDENTITY_VERSION}:${stableHash([
    game.platform,
    installPath,
    executablePath,
    appId,
  ])}`;
}

export function createInstallIdentity(game: RawInstalledGame): InstallIdentity {
  const canonicalInstallPath = canonicalPath(game.installPath) ?? '';
  const canonicalExecutablePath = canonicalPath(game.executablePath);
  const appId = launcherIdentity(game);

  if (canonicalExecutablePath) {
    return {
      installIdentity: `install:v${INSTALL_IDENTITY_VERSION}:exe:${stableHash([
        game.platform,
        canonicalInstallPath,
        canonicalExecutablePath,
        appId,
      ])}`,
      canonicalInstallPath,
      canonicalExecutablePath,
      launcherAppId: appId,
      identityStatus: 'verified',
      needsReverification: false,
    };
  }

  if (appId && canonicalInstallPath) {
    return {
      installIdentity: `install:v${INSTALL_IDENTITY_VERSION}:launcher:${stableHash([
        game.platform,
        canonicalInstallPath,
        appId,
      ])}`,
      canonicalInstallPath,
      launcherAppId: appId,
      identityStatus: 'verified',
      needsReverification: false,
    };
  }

  if (canonicalInstallPath) {
    return {
      installIdentity: `install:v${INSTALL_IDENTITY_VERSION}:path:${stableHash([
        game.platform,
        canonicalInstallPath,
      ])}`,
      canonicalInstallPath,
      identityStatus: 'backfilled',
      needsReverification: true,
    };
  }

  return createLegacyInstallIdentity(game.platform, '', createPreviewCandidateId(game));
}

export function createLegacyInstallIdentity(
  platform: InstallPlatform,
  installPath: string,
  legacyRowId: string,
): InstallIdentity {
  const canonicalInstallPath = canonicalPath(installPath) ?? '';
  return {
    installIdentity: `legacy:${platform}:${stableHash([legacyRowId])}`,
    canonicalInstallPath,
    identityStatus: 'ambiguous',
    needsReverification: true,
  };
}

export type InstallDuplicateReason =
  | 'same_executable_path'
  | 'same_launcher_app_id_and_path'
  | 'same_install_identity';

export function sameConcreteInstall(
  left: InstallIdentity,
  right: InstallIdentity,
): InstallDuplicateReason | undefined {
  if (
    left.canonicalExecutablePath
    && right.canonicalExecutablePath
    && left.canonicalExecutablePath === right.canonicalExecutablePath
  ) {
    return 'same_executable_path';
  }
  if (
    left.launcherAppId
    && right.launcherAppId
    && left.launcherAppId === right.launcherAppId
    && left.canonicalInstallPath === right.canonicalInstallPath
  ) {
    return 'same_launcher_app_id_and_path';
  }
  if (left.installIdentity === right.installIdentity) {
    return 'same_install_identity';
  }
  return undefined;
}
