export * from './types.js';
export { evaluateOnlineGuard } from './online-guard.js';
export { evaluateWriteConsent } from './write-consent.js';
export {
  SinglePlayerWaiverStore,
  SINGLE_PLAYER_WAIVER_COPY,
} from './single-player-waiver.js';
export type { WaiverRecord, WaiverStoreFile } from './single-player-waiver.js';
export { observeRemoteConnections } from './remote-connection-observer.js';
export { nativeMemoryDriver, listLiveMemoryProcesses } from './native-memory-driver.js';
export type { LiveProcessListEntry } from './native-memory-driver.js';
export { LiveMemorySession } from './live-memory-session.js';
export type {
  AttachFingerprintOptions,
  AttachResult,
  ConfirmWriteResult,
  RollbackResult,
  RemoteConnectionObserverFn,
  FreezeScheduler,
  StartFreezeResult,
} from './live-memory-session.js';
export { scanFirst, scanFirstRange, scanNext } from './memory-scanner.js';
export type { ScanResult } from './memory-scanner.js';
export { RealtimeScanner } from './real-time-scanner.js';
export type {
  RealtimeScannerCandidate,
  RealtimeScannerConfig,
  RealtimeScannerStopReason,
} from './real-time-scanner.js';
export { getConnectionBaseline, listReviewedConnectionBaselines } from './game-connection-baselines.js';
export { scanForPointerPath } from './pointer-scanner.js';
export type { PointerScanBounds, PointerPathCandidate, PointerScanResult } from './pointer-scanner.js';
export { resolvePointerPath } from './pointer-resolver.js';
export type { LivePointerPath } from './pointer-resolver.js';
export { parseAobSignature, findAobInBuffer, scanAobInProcess } from './aob-resolver.js';
export type { AobPattern, AobScanOptions } from './aob-resolver.js';
export {
  aobHammingDistance,
  findBestFuzzyAobInBuffer,
  scanExactSignature,
  scanFuzzySignature,
  resolveSignature,
  resolveSignatureInBuffer,
} from './signature-engine.js';
export type { FuzzyScanOptions, SignatureMatch } from './signature-engine.js';
export { MemoryAuditLog } from './audit-log.js';
export type { MemoryAuditEntry, MemoryAuditOp, MemoryAuditLogOptions } from './audit-log.js';
export { MemoryManager } from './memory-manager.js';
export type { SafeWriteResult, MemoryManagerSnapshotListener } from './memory-manager.js';
export {
  matchCatalogProcess,
  buildZeroInputAttachPlan,
  resolveDefinitionFeatures,
} from './process-watcher.js';
export type {
  CatalogExecutableEntry,
  ProcessWatchDetection,
  ZeroInputAttachPlan,
  ResolvedFeatureAddress,
  BuildAttachPlanInput,
} from './process-watcher.js';
export {
  planZeroInputDetection,
  prepareZeroInputSession,
} from './zero-input-prepare.js';
export type {
  ZeroInputPrepareInput,
  ZeroInputPrepareResult,
  SerializedResolvedFeature,
} from './zero-input-prepare.js';
export { resolveMemoryFeatureAddress, SessionAddressCache, parseHexOffset } from './feature-resolver.js';
export type { LiveTrainerControl } from './live-trainer-control.js';
export {
  listLiveControlsFromSchema,
  resolveLiveControlFromSchema,
  listLiveControlsDualRead,
  resolveLiveControlDualRead,
  findCatalogGameIdsByExecutable,
  memoryFeatureToLiveControl,
} from './dual-read-controls.js';
export type {
  SchemaLiveListResult,
  SchemaLiveResolveResult,
  DualReadLiveListResult,
  DualReadLiveResolveResult,
  LiveControlSource,
} from './dual-read-controls.js';
export {
  MemoryViewer,
  HexInspector,
  PointerCandidateAnalyzer,
  SessionSnapshotManager,
  parseResearchAddress,
} from './research/index.js';
export type {
  ResearchDataType,
  MemoryViewEntry,
  MemoryRegionSummary,
  MemoryRegionList,
  HexWindow,
  HexRow,
  PointerCandidateReport,
  PointerConfidence,
  ScoredPointerPath,
  SessionSnapshot,
  SnapshotWatchItem,
  SnapshotModuleBase,
  SessionSnapshotDiff,
} from './research/index.js';
export {
  WritePolicyGate,
  defaultTrainerWritePolicyContext,
  researchProbeWritePolicyContext,
} from './write-policy.js';
export type {
  WriteGateDecision,
  WriteGateCode,
  WritePolicyContext,
  WriteClass,
} from './write-policy.js';
export {
  promoteCandidateFromCtEntry,
  promoteCandidateFromFeature,
  buildLiveToggleCards,
  RESEARCH_PROMOTE_SEED_KEY,
} from './ct-promote.js';
export type {
  CtPromoteCandidate,
  LiveToggleCard,
  ResearchPromoteSeed,
} from './ct-promote.js';
export {
  buildLocalTrainerPack,
  serializeLocalTrainerPack,
  parseLocalTrainerPack,
  LOCAL_PACK_SCHEMA_VERSION,
} from './local-pack-export.js';
export type { LocalTrainerPack } from './local-pack-export.js';
