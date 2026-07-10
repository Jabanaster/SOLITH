export const UNSUPPORTED_FORMAT_BLOCKED_MESSAGE = 'Blocked - this format is not executable yet.';
export const PREVIEW_ONLY_FORMAT_MESSAGE = 'Preview-only - write execution is blocked for this format.';
export const LOCAL_TRAINER_SERVICE_UNAVAILABLE_MESSAGE = 'Local trainer service unavailable. No game files were changed.';
export const OPERATION_FAILED_BEFORE_WRITE_MESSAGE = 'Operation failed before write completion. Check backup/rollback status before retrying.';
export const LOCAL_ONLY_SAFETY_MESSAGE = 'Local single-player files only. Solith changes files only after an approved supported action.';

const WINDOWS_ABSOLUTE_PATH = /[A-Za-z]:\\[^\s"'<>)]*/g;
const POSIX_ABSOLUTE_PATH = /\/(?:[^/\s"'<>)]\/?)+/g;

export function stripFilesystemPaths(message: string): string {
  return message
    .replace(WINDOWS_ABSOLUTE_PATH, '[path]')
    .replace(POSIX_ABSOLUTE_PATH, '[path]');
}

export function localTrainerServiceFailureMessage(): string {
  return LOCAL_TRAINER_SERVICE_UNAVAILABLE_MESSAGE;
}

export function operationFailedBeforeWriteMessage(): string {
  return OPERATION_FAILED_BEFORE_WRITE_MESSAGE;
}

export function userSafeErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return stripFilesystemPaths(raw).slice(0, 160);
}
