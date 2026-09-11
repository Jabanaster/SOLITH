import db from '../database';
import { Settings, NavSectionBehaviorMode } from '../../shared/types';

const NAV_SECTION_BEHAVIOR_MODES: NavSectionBehaviorMode[] = [
  'remember', 'always-expand', 'always-collapse-inactive',
];

function isValidNavSectionBehaviorMode(value: unknown): value is NavSectionBehaviorMode {
  return typeof value === 'string' && (NAV_SECTION_BEHAVIOR_MODES as string[]).includes(value);
}

export function getSettings(): Settings {
  const settings: Partial<Settings> = {};
  
  const keys: (keyof Settings)[] = [
    'onboardingCompleted', 'aiProvider', 'aiEndpoint', 'aiModel',
    'scanSizeLimitMB', 'backupMode', 'backupLocation', 'backupRetentionCount',
    'theme', 'safetyAcknowledged', 'externalSaveScanEnabled',
    'v2LiveModeEnabled', 'v2HotkeysEnabled', 'v2OverlayEnabled',
    'v2SessionMonitorEnabled', 'trainerCapabilitiesUnlocked',
    'v2FreeformMemoryEnabled', 'v2RemoteCatalogSyncEnabled', 'trainerRemoteSyncCompleted',
    'onlineServicesEnabled',
    'communitySyncEnabled',
    'installDiscoveryEnabled', 'installDiscoveryLastScan',
    'inProcessScriptExecutionEnabled',
    'navSectionBehaviorMode', 'navCompactMode', 'navShowSectionLabels',
    'navRememberedSectionState',
    'notificationsToastEnabled', 'notificationsCatalogUpdateEnabled',
    'notificationsArtworkEnabled', 'notificationsTrainerProfileEnabled',
    'notificationsMaintenanceEnabled', 'notificationsShowUnreadBadge',
    'communitySyncEverSucceeded',
    'artworkNoticeAckPolicyVersion', 'artworkNoticeAckAt',
  ];
  
  keys.forEach(key => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row) {
      let parsed: any = row.value;
      if (row.value === 'true') parsed = true;
      else if (row.value === 'false') parsed = false;
      else if (!isNaN(Number(row.value)) && row.value !== '') parsed = Number(row.value);
      (settings as any)[key] = parsed;
    }
  });
  
  // Return defaults for missing settings
  const base: Settings = {
    onboardingCompleted: settings.onboardingCompleted ?? false,
    aiProvider: settings.aiProvider ?? 'None',
    aiEndpoint: settings.aiEndpoint ?? '',
    aiModel: settings.aiModel ?? '',
    scanSizeLimitMB: settings.scanSizeLimitMB ?? 100,
    backupMode: settings.backupMode ?? 'per-game',
    backupLocation: settings.backupLocation ?? '',
    backupRetentionCount: settings.backupRetentionCount ?? 10,
    theme: settings.theme ?? 'dark',
    safetyAcknowledged: settings.safetyAcknowledged ?? false,
    externalSaveScanEnabled: settings.externalSaveScanEnabled ?? false,
    v2LiveModeEnabled: settings.v2LiveModeEnabled ?? true,
    v2HotkeysEnabled: settings.v2HotkeysEnabled ?? true,
    v2OverlayEnabled: settings.v2OverlayEnabled ?? true,
    v2SessionMonitorEnabled: settings.v2SessionMonitorEnabled ?? false,
    trainerCapabilitiesUnlocked: settings.trainerCapabilitiesUnlocked ?? false,
    v2FreeformMemoryEnabled: settings.v2FreeformMemoryEnabled ?? true,
    v2RemoteCatalogSyncEnabled: settings.v2RemoteCatalogSyncEnabled ?? true,
    trainerRemoteSyncCompleted: settings.trainerRemoteSyncCompleted ?? false,
    onlineServicesEnabled: settings.onlineServicesEnabled ?? true,
    communitySyncEnabled: settings.communitySyncEnabled ?? false,
    installDiscoveryEnabled: settings.installDiscoveryEnabled ?? true,
    installDiscoveryLastScan: settings.installDiscoveryLastScan ?? '',
    inProcessScriptExecutionEnabled: settings.inProcessScriptExecutionEnabled ?? false,
    navSectionBehaviorMode: isValidNavSectionBehaviorMode(settings.navSectionBehaviorMode)
      ? settings.navSectionBehaviorMode
      : 'remember',
    navCompactMode: settings.navCompactMode === true,
    navShowSectionLabels: typeof settings.navShowSectionLabels === 'boolean'
      ? settings.navShowSectionLabels
      : true,
    navRememberedSectionState: typeof settings.navRememberedSectionState === 'string'
      ? settings.navRememberedSectionState
      : '{}',
    notificationsToastEnabled: settings.notificationsToastEnabled !== false,
    notificationsCatalogUpdateEnabled: settings.notificationsCatalogUpdateEnabled !== false,
    notificationsArtworkEnabled: settings.notificationsArtworkEnabled !== false,
    notificationsTrainerProfileEnabled: settings.notificationsTrainerProfileEnabled !== false,
    notificationsMaintenanceEnabled: settings.notificationsMaintenanceEnabled !== false,
    notificationsShowUnreadBadge: settings.notificationsShowUnreadBadge !== false,
    communitySyncEverSucceeded: settings.communitySyncEverSucceeded === true,
    // Game Artwork Notice (Policy v1) -- deliberately left absent (undefined)
    // rather than defaulted to 0/false when no row exists, matching the
    // Offline Safety Acknowledgment pattern: "never acknowledged" must stay
    // distinguishable from "explicitly acknowledged policy version 0".
    artworkNoticeAckPolicyVersion: typeof settings.artworkNoticeAckPolicyVersion === 'number' ? settings.artworkNoticeAckPolicyVersion : undefined,
    artworkNoticeAckAt: typeof settings.artworkNoticeAckAt === 'number' ? settings.artworkNoticeAckAt : undefined,
  };

  if (process.env.NODE_ENV === 'test' || process.env.SOLITH_SKIP_ONBOARDING === '1') {
    base.onboardingCompleted = true;
  }

  return base;
}

export function setSetting(key: keyof Settings, value: string | number | boolean): void {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `);
  
  stmt.run(key, String(value));
}

export function getSetting(key: keyof Settings): string | number | boolean | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return undefined;
  
  let parsed: any = row.value;
  if (row.value === 'true') parsed = true;
  else if (row.value === 'false') parsed = false;
  else if (!isNaN(Number(row.value)) && row.value !== '') parsed = Number(row.value);
  return parsed;
}

export function markOnboardingComplete(): void {
  setSetting('onboardingCompleted', true);
}

export function markSafetyAcknowledged(): void {
  setSetting('safetyAcknowledged', true);
}

export function isOnboardingComplete(): boolean {
  return getSetting('onboardingCompleted') === true;
}

export function isSafetyAcknowledged(): boolean {
  return getSetting('safetyAcknowledged') === true;
}

export function getAIProvider(): 'None' | 'Ollama' | 'LM Studio' {
  return getSetting('aiProvider') as 'None' | 'Ollama' | 'LM Studio';
}

export function setAIProvider(provider: 'None' | 'Ollama' | 'LM Studio'): void {
  setSetting('aiProvider', provider);
}

export function getScanSizeLimitMB(): number {
  return Number(getSetting('scanSizeLimitMB'));
}

export function setScanSizeLimitMB(limit: number): void {
  setSetting('scanSizeLimitMB', limit);
}

export function getBackupMode(): 'per-game' | 'global' {
  return getSetting('backupMode') as 'per-game' | 'global';
}

export function setBackupMode(mode: 'per-game' | 'global'): void {
  setSetting('backupMode', mode);
}

export function getBackupRetentionCount(): number {
  return Number(getSetting('backupRetentionCount'));
}

export function setBackupRetentionCount(count: number): void {
  setSetting('backupRetentionCount', count);
}

export function getTheme(): 'dark' | 'light' {
  return getSetting('theme') as 'dark' | 'light';
}

export function setTheme(theme: 'dark' | 'light'): void {
  setSetting('theme', theme);
}

export function getNavSectionBehaviorMode(): NavSectionBehaviorMode {
  const value = getSetting('navSectionBehaviorMode');
  return isValidNavSectionBehaviorMode(value) ? value : 'remember';
}

export function setNavSectionBehaviorMode(mode: NavSectionBehaviorMode): void {
  setSetting('navSectionBehaviorMode', mode);
}

export function getNavCompactMode(): boolean {
  return getSetting('navCompactMode') === true;
}

export function setNavCompactMode(enabled: boolean): void {
  setSetting('navCompactMode', enabled);
}

export function getNavShowSectionLabels(): boolean {
  const value = getSetting('navShowSectionLabels');
  return typeof value === 'boolean' ? value : true;
}

export function setNavShowSectionLabels(enabled: boolean): void {
  setSetting('navShowSectionLabels', enabled);
}

export function getNavRememberedSectionState(): string {
  const value = getSetting('navRememberedSectionState');
  return typeof value === 'string' ? value : '{}';
}

export function setNavRememberedSectionState(json: string): void {
  setSetting('navRememberedSectionState', json);
}

export function getNotificationsToastEnabled(): boolean {
  return getSetting('notificationsToastEnabled') !== false;
}

export function setNotificationsToastEnabled(enabled: boolean): void {
  setSetting('notificationsToastEnabled', enabled);
}

const NOTIFICATION_CATEGORY_SETTING_KEYS: Record<
  'catalog-update' | 'artwork' | 'trainer-profile' | 'maintenance',
  keyof Settings
> = {
  'catalog-update': 'notificationsCatalogUpdateEnabled',
  artwork: 'notificationsArtworkEnabled',
  'trainer-profile': 'notificationsTrainerProfileEnabled',
  maintenance: 'notificationsMaintenanceEnabled',
};

export function getNotificationsCategoryEnabled(category: 'catalog-update' | 'artwork' | 'trainer-profile' | 'maintenance'): boolean {
  return getSetting(NOTIFICATION_CATEGORY_SETTING_KEYS[category]) !== false;
}

export function setNotificationsShowUnreadBadge(enabled: boolean): void {
  setSetting('notificationsShowUnreadBadge', enabled);
}

export function getNotificationsShowUnreadBadge(): boolean {
  return getSetting('notificationsShowUnreadBadge') !== false;
}

export function getCommunitySyncEverSucceeded(): boolean {
  return getSetting('communitySyncEverSucceeded') === true;
}

export function setCommunitySyncEverSucceeded(value: boolean): void {
  setSetting('communitySyncEverSucceeded', value);
}
