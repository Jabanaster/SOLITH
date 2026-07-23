export type CtImportPhase =
  | 'idle'
  | 'hashing-source'
  | 'extracting-archive'
  | 'parsing-xml'
  | 'scraping-signatures'
  | 'writing-output'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type CtImportStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';

export interface CtImportProgress {
  jobId: string;
  phase: Exclude<CtImportPhase, 'idle'>;
  label: string;
  archivePath?: string;
  processedTables?: number;
  totalTables?: number;
}

export interface CtImportUiState {
  status: CtImportStatus;
  jobId: string | null;
  progress: CtImportProgress | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export type CtImportUiAction =
  | { type: 'start'; jobId: string; label?: string }
  | { type: 'progress'; progress: CtImportProgress }
  | { type: 'complete'; progress?: CtImportProgress }
  | { type: 'cancelled'; errorCode?: string; errorMessage?: string }
  | { type: 'failed'; errorCode?: string; errorMessage?: string }
  | { type: 'reset' };

export const idleCtImportUiState: CtImportUiState = {
  status: 'idle',
  jobId: null,
  progress: null,
  errorCode: null,
  errorMessage: null,
};

export function friendlyCtImportError(errorCode?: string | null, fallback?: string | null): string {
  switch (errorCode) {
    case 'ABORT_ERR':
      return 'Import cancelled. Temporary CT import files were cleaned up.';
    case 'REJECTED_NUL_BYTE':
      return 'Import rejected: the archive contains a path with a NUL byte.';
    case 'REJECTED_PATH_TRAVERSAL':
      return 'Import rejected: the archive contains a path traversal attempt.';
    case 'REJECTED_ABSOLUTE_PATH':
      return 'Import rejected: the archive contains an absolute file path.';
    case 'REJECTED_SIZE_CAP':
      return 'Import rejected: the CT file or archive exceeds Solith’s bounded import cap.';
    default:
      return fallback || 'Import failed. The file was not added to the metadata catalog.';
  }
}

export function ctImportUiReducer(state: CtImportUiState, action: CtImportUiAction): CtImportUiState {
  switch (action.type) {
    case 'start':
      return {
        status: 'running',
        jobId: action.jobId,
        progress: {
          jobId: action.jobId,
          phase: 'hashing-source',
          label: action.label ?? 'Preparing import...',
          processedTables: 0,
        },
        errorCode: null,
        errorMessage: null,
      };
    case 'progress':
      if (state.jobId && action.progress.jobId !== state.jobId) return state;
      return {
        ...state,
        status: action.progress.phase === 'complete' ? 'complete' : 'running',
        jobId: action.progress.jobId,
        progress: action.progress,
        errorCode: null,
        errorMessage: null,
      };
    case 'complete':
      return {
        ...state,
        status: 'complete',
        progress: action.progress ?? state.progress,
        errorCode: null,
        errorMessage: null,
      };
    case 'cancelled':
      return {
        ...state,
        status: 'cancelled',
        errorCode: action.errorCode ?? 'ABORT_ERR',
        errorMessage: friendlyCtImportError(action.errorCode ?? 'ABORT_ERR', action.errorMessage),
      };
    case 'failed':
      return {
        ...state,
        status: 'failed',
        errorCode: action.errorCode ?? null,
        errorMessage: friendlyCtImportError(action.errorCode, action.errorMessage),
      };
    case 'reset':
      return idleCtImportUiState;
    default:
      return state;
  }
}
