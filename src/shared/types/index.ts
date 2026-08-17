export interface Game {
  id: string;
  name: string;
  path: string;
  dateAdded: string;
  lastScan?: string;
  engine?: string;
  executablePath?: string;
  coverPath?: string;
  iconPath?: string;
  saveLocations?: string[];
  notes?: string;
  metadataId?: string;
  fingerprint?: GameFingerprint;
  needsRescan?: boolean;
}

export interface GameFingerprint {
  fileCount: number;
  totalSize: number;
  keyHashes: string[];
  mainExecutable?: string;
  lastScan: string;
}

export interface ScanResult {
  files: string[];
  directories: string[];
  saveFiles: string[];
  configFiles: string[];
  dataFiles: string[];
}

export interface ParsedSave {
  data: any;
  format: string;
  path: string;
  normalized?: ParsedDocument;
}

export interface ParserDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  line?: number;
}

export interface ParsedNode {
  path: string;
  key?: string;
  displayName: string;
  valueType: 'number' | 'string' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';
  value?: any;
  children?: ParsedNode[];
  editability: 'editable' | 'read-only' | 'blocked';
  risk: 'safe' | 'caution' | 'risky' | 'blocked';
  evidence: string[];
}

export interface ParsedDocument {
  adapterId: string;
  adapterVersion: string;
  sourcePath: string;
  format: string;
  root: ParsedNode;
  diagnostics: ParserDiagnostic[];
  editable: boolean;
}

export interface SaveValue {
  path: string;
  value: string | number | boolean;
  type: 'number' | 'string' | 'boolean' | 'array' | 'object';
  risk: 'Safe' | 'Caution' | 'Risky' | 'Blocked';
}

export interface DiscoveryResult {
  path: string;
  oldValue: any;
  newValue: any;
  confidence: number;
  description: string;
  suggestedCategory?: string;
  suggestedName?: string;
  adapterId?: string;
  sourceA?: string;
  sourceB?: string;
  valueType?: string;
  risk?: string;
  noiseClassification?: string;
  evidence?: string;
  explanation?: string;
}

export interface RiskAssessment {
  risk: 'Safe' | 'Caution' | 'Risky' | 'Blocked';
  reason: string;
  requiresBackup: boolean;
  requiresGameClosed: boolean;
}

export interface Backup {
  id: string;
  timestamp: string;
  filePath: string;
  originalHash: string;
  backupPath: string;
  recipeId?: string;
}

export interface RollbackManifest {
  backups: Backup[];
  timestamp: string;
  recipeId?: string;
}

export interface TrainerItem {
  id: string;
  name: string;
  description: string;
  category: string;
  source: string;
  risk: string;
  status: string;
  confidence?: number;
  currentValue?: string | number;
  newValue?: string | number;
  path?: string;
  target?: string;
  hotkey?: string;
  inputType?: 'number' | 'toggle' | 'slider' | 'dropdown';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{
    label: string;
    value: string | number | boolean;
  }>;
}

export interface Recipe {
  id: string;
  name: string;
  gameId: string;
  category: string;
  source: string;
  target: string;
  path: string;
  valueType: string;
  risk: string;
  requiresBackup: boolean;
  confidence: number;
  description?: string;
  createdAt: string;
  updatedAt: string;
  fileHash?: string;
  gameFingerprintHash?: string;
  needsRescan?: boolean;
  isActive?: boolean;
  version?: number;
  schemaVersion?: string | number;
  adapterId?: string;
  adapterVersion?: string;
  targetStrategy?: string;
  safeRelativePattern?: string;
  structuredPath?: string;
  inputType?: string;
  minimum?: number;
  maximum?: number;
  allowedValues?: any[];
  step?: number;
  resetValue?: string | number | boolean;
  unit?: string;
  maxLength?: number;
  pattern?: string;
  preconditions?: any;
  validationRules?: any;
  fingerprintCompatibility?: string;
}

export interface Proposal {
  id: string;
  gameId: string;
  recipeId?: string;
  targetFile: string;
  operation: 'set' | 'increment' | 'decrement' | 'toggle';
  path: string;
  oldValue: any;
  newValue: any;
  risk: string;
  preview: string;
  validationRule: string;
  requiresBackup: boolean;
  dryRunPassed: boolean;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface JournalEvent {
  id: string;
  timestamp: string;
  type: 'scan' | 'discovery' | 'proposal' | 'backup' | 'apply' | 'rollback' | 'error' | 'recipe' | 'game_added' | 'settings';
  gameId?: string;
  recipeId?: string;
  description: string;
  details?: string;
}

export interface Settings {
  onboardingCompleted: boolean;
  aiProvider: 'None' | 'Ollama' | 'LM Studio';
  aiEndpoint: string;
  aiModel: string;
  scanSizeLimitMB: number;
  backupMode: 'per-game' | 'global';
  backupLocation: string;
  backupRetentionCount: number;
  theme: 'dark' | 'light';
  safetyAcknowledged: boolean;
  externalSaveScanEnabled: boolean;
  v2LiveModeEnabled: boolean;
  v2HotkeysEnabled: boolean;
  v2OverlayEnabled: boolean;
  trainerCapabilitiesUnlocked?: boolean;
  v2FreeformMemoryEnabled: boolean;
  v2RemoteCatalogSyncEnabled: boolean;
  trainerRemoteSyncCompleted?: boolean;
  /** Opt-in Solith Definition Hub synchronization. Default: false. */
  communitySyncEnabled: boolean;
  /** V2 read-only session lifecycle monitor. Default: false. */
  v2SessionMonitorEnabled: boolean;
  /** Scan Steam/Epic/GOG installs for Trainer Library badges. Default: true. */
  installDiscoveryEnabled?: boolean;
  installDiscoveryLastScan?: string;
  /**
   * Milestone M — In-Process Script Execution pilot (Crimson Desert only).
   * Default: false. Requires offline confirm + per-action approval at IPC.
   */
  inProcessScriptExecutionEnabled?: boolean;
  /** Sidebar navigation-group behavior mode. Default: 'remember'. */
  navSectionBehaviorMode?: 'remember' | 'always-expand' | 'always-collapse-inactive';
  /** Compact sidebar spacing/icon sizing. Default: false. */
  navCompactMode?: boolean;
  /** Show navigation-group text labels (vs. icon-only groups) when the sidebar is expanded. Default: true. */
  navShowSectionLabels?: boolean;
  /** JSON-encoded map of section title -> manually-collapsed boolean, used only in 'remember' mode. Default: '{}'. */
  navRememberedSectionState?: string;
  /** Show toast popups for new notifications. Default: true. */
  notificationsToastEnabled?: boolean;
  /** Notify on real catalog-update events. Default: true. */
  notificationsCatalogUpdateEnabled?: boolean;
  /** Notify on artwork fetch events. Default: true. */
  notificationsArtworkEnabled?: boolean;
  /** Notify on trainer/profile update events. Default: true. */
  notificationsTrainerProfileEnabled?: boolean;
  /** Notify on maintenance/recovery notices. Default: true. */
  notificationsMaintenanceEnabled?: boolean;
  /** Show the unread badge on the notification bell. Default: true. */
  notificationsShowUnreadBadge?: boolean;
  /** Tracks whether community catalog sync has ever completed successfully, used to suppress the first-sync notification. Default: false. */
  communitySyncEverSucceeded?: boolean;
}

export type NavSectionBehaviorMode = 'remember' | 'always-expand' | 'always-collapse-inactive';

export type NotificationCategory =
  | 'catalog-update' | 'artwork' | 'trainer-profile' | 'maintenance' | 'recovery' | 'general';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
  type: 'open-view';
  view: string;
}

export interface NotificationRecord {
  id: string;
  category: NotificationCategory;
  title: string;
  message: string;
  severity: NotificationSeverity;
  createdAt: string;
  read: boolean;
  action?: NotificationAction;
}

export interface AIConfig {
  provider: 'None' | 'Ollama' | 'LM Studio';
  endpoint: string;
  model: string;
  timeout: number;
}

export interface FileClassification {
  type: 'save' | 'config' | 'data' | 'script' | 'texture' | 'audio' | 'archive' | 'executable' | 'unknown';
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
}
