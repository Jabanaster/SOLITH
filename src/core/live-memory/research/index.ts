/**
 * Phase 9 research facades — read-only address/data tools.
 */
export { MemoryViewer, parseResearchAddress } from './memory-viewer.js';
export type {
  ResearchDataType,
  MemoryViewEntry,
  MemoryRegionSummary,
  MemoryRegionList,
  MemoryModuleSummary,
  MemoryModuleList,
} from './memory-viewer.js';
export { HexInspector } from './hex-inspector.js';
export type { HexWindow, HexRow } from './hex-inspector.js';
export { PointerCandidateAnalyzer } from './pointer-candidate-analysis.js';
export type {
  PointerCandidateReport,
  PointerConfidence,
  ScoredPointerPath,
} from './pointer-candidate-analysis.js';
export { SessionSnapshotManager } from './session-snapshot.js';
export type {
  SessionSnapshot,
  SnapshotWatchItem,
  SnapshotModuleBase,
  SessionSnapshotDiff,
} from './session-snapshot.js';
