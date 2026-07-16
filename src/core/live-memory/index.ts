export * from './types.js';
export { evaluateOnlineGuard } from './online-guard.js';
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
export { scanFirst, scanNext } from './memory-scanner.js';
export type { ScanResult } from './memory-scanner.js';
export { getConnectionBaseline, listReviewedConnectionBaselines } from './game-connection-baselines.js';
export { scanForPointerPath } from './pointer-scanner.js';
export type { PointerScanBounds, PointerPathCandidate, PointerScanResult } from './pointer-scanner.js';
export { resolvePointerPath } from './pointer-resolver.js';
export type { LivePointerPath } from './pointer-resolver.js';
export { parseAobSignature, findAobInBuffer, scanAobInProcess } from './aob-resolver.js';
export type { AobPattern, AobScanOptions } from './aob-resolver.js';
export { resolveMemoryFeatureAddress, SessionAddressCache, parseHexOffset } from './feature-resolver.js';
export { listControlsForGame, getControl, listAllControls } from './live-control-catalog.js';
export type { LiveTrainerControl } from './live-control-catalog.js';
export {
  listLiveControlsDualRead,
  resolveLiveControlDualRead,
  findCatalogGameIdsByExecutable,
  memoryFeatureToLiveControl,
} from './dual-read-controls.js';
export type {
  DualReadLiveListResult,
  DualReadLiveResolveResult,
  LiveControlSource,
} from './dual-read-controls.js';
