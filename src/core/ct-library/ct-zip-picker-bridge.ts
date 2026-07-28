import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { validatePathSafety } from '../safety/path-safety.js';

export type CtZipPickerResult =
  | { status: 'selected'; selectionId: string; path: string; filename: string }
  | { status: 'cancelled' }
  | { status: 'error'; errorCode: string; error: string };

export type CtZipDialogResult = { canceled: boolean; filePaths: string[] };

interface SelectedCtZip {
  ownerId: number;
  canonicalPath: string;
  expiresAtMs: number;
}

export interface CtZipPickerBridgeDependencies {
  canonicalize?: (selectedPath: string) => Promise<string>;
  stat?: (selectedPath: string) => Promise<{ isFile(): boolean }>;
  validateSafety?: (selectedPath: string) => { safe: boolean; reason?: string };
  nowMs?: () => number;
  selectionTtlMs?: number;
}

export type ResolveCtZipSelectionResult =
  | { success: true; archivePath: string }
  | { success: false; errorCode: string; error: string };

const DEFAULT_SELECTION_TTL_MS = 10 * 60 * 1000;

function sanitizedPickerError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ENOENT') return 'The selected ZIP file no longer exists.';
    if (code === 'EACCES' || code === 'EPERM') return 'Solith cannot access the selected ZIP file.';
  }
  return 'The selected CT ZIP could not be validated.';
}

export function createCtZipPickerBridge(dependencies: CtZipPickerBridgeDependencies) {
  const selections = new Map<string, SelectedCtZip>();
  const nowMs = dependencies.nowMs ?? Date.now;
  const selectionTtlMs = dependencies.selectionTtlMs ?? DEFAULT_SELECTION_TTL_MS;
  const canonicalize = dependencies.canonicalize ?? (async (selectedPath: string) => fs.realpath(selectedPath));
  const stat = dependencies.stat ?? (async (selectedPath: string) => fs.stat(selectedPath));
  const validateSafety = dependencies.validateSafety ?? ((selectedPath: string) => validatePathSafety(selectedPath));

  async function pick(
    ownerId: number,
    showOpenDialog: () => Promise<CtZipDialogResult>,
  ): Promise<CtZipPickerResult> {
    let dialogResult: CtZipDialogResult;
    try {
      dialogResult = await showOpenDialog();
    } catch {
      return { status: 'error', errorCode: 'PICKER_FAILED', error: 'Could not open the native ZIP picker.' };
    }
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
      return { status: 'cancelled' };
    }

    const selectedPath = dialogResult.filePaths[0];
    if (path.extname(selectedPath).toLowerCase() !== '.zip') {
      return {
        status: 'error',
        errorCode: 'REJECTED_FILE_TYPE',
        error: 'Only .zip archives can be imported into the CT Library.',
      };
    }

    try {
      const canonicalPath = path.resolve(await canonicalize(selectedPath));
      const fileStats = await stat(canonicalPath);
      if (!fileStats.isFile()) {
        return {
          status: 'error',
          errorCode: 'REJECTED_NOT_FILE',
          error: 'The selected CT ZIP path is not a regular file.',
        };
      }
      const safety = validateSafety(canonicalPath);
      if (!safety.safe) {
        return {
          status: 'error',
          errorCode: 'REJECTED_PATH_SAFETY',
          error: safety.reason ?? 'The selected CT ZIP path is not allowed.',
        };
      }
      const selectionId = randomUUID();
      selections.set(selectionId, {
        ownerId,
        canonicalPath,
        expiresAtMs: nowMs() + selectionTtlMs,
      });
      return {
        status: 'selected',
        selectionId,
        path: canonicalPath,
        filename: path.basename(canonicalPath),
      };
    } catch (error) {
      return {
        status: 'error',
        errorCode: 'REJECTED_INVALID_PATH',
        error: sanitizedPickerError(error),
      };
    }
  }

  function resolve(ownerId: number, selectionId: string): ResolveCtZipSelectionResult {
    const selection = selections.get(selectionId);
    if (!selection) {
      return { success: false, errorCode: 'UNKNOWN_SELECTION', error: 'Select the CT ZIP again before importing.' };
    }
    if (selection.ownerId !== ownerId) {
      return { success: false, errorCode: 'WRONG_WINDOW', error: 'This CT ZIP selection belongs to another window.' };
    }
    if (selection.expiresAtMs <= nowMs()) {
      selections.delete(selectionId);
      return { success: false, errorCode: 'EXPIRED_SELECTION', error: 'The CT ZIP selection expired. Select it again.' };
    }
    return { success: true, archivePath: selection.canonicalPath };
  }

  function clearOwner(ownerId: number): void {
    for (const [selectionId, selection] of selections) {
      if (selection.ownerId === ownerId) selections.delete(selectionId);
    }
  }

  return { pick, resolve, clearOwner };
}
