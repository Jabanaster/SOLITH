import db from '../database';
import { Settings } from '../../shared/types';

export function getSettings(): Settings {
  const settings: Partial<Settings> = {};
  
  const keys: (keyof Settings)[] = [
    'onboardingCompleted', 'aiProvider', 'aiEndpoint', 'aiModel',
    'scanSizeLimitMB', 'backupMode', 'backupLocation', 'backupRetentionCount',
    'theme', 'safetyAcknowledged', 'externalSaveScanEnabled',
    'v2LiveModeEnabled', 'v2HotkeysEnabled', 'v2OverlayEnabled',
    'v2SessionMonitorEnabled', 'trainerCapabilitiesUnlocked',
    'v2FreeformMemoryEnabled', 'v2RemoteCatalogSyncEnabled', 'trainerRemoteSyncCompleted',
    'communitySyncEnabled',
    'installDiscoveryEnabled', 'installDiscoveryLastScan',
    'inProcessScriptExecutionEnabled',
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
    communitySyncEnabled: settings.communitySyncEnabled ?? false,
    installDiscoveryEnabled: settings.installDiscoveryEnabled ?? true,
    installDiscoveryLastScan: settings.installDiscoveryLastScan ?? '',
    inProcessScriptExecutionEnabled: settings.inProcessScriptExecutionEnabled ?? false,
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
