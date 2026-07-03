import {
  PREVIEW_ONLY_FORMAT_MESSAGE,
  UNSUPPORTED_FORMAT_BLOCKED_MESSAGE,
} from './reliability-messages.js';

export type SaveEditRiskState = 'read_only' | 'preview_only' | 'executable' | 'blocked';

export interface SaveEditRiskCopy {
  label: string;
  summary: string;
  detail: string;
}

export const SAVE_EDIT_RISK_COPY: Record<SaveEditRiskState, SaveEditRiskCopy> = {
  read_only: {
    label: 'Read-only',
    summary: 'Inspect only',
    detail: 'This value can be inspected without changing the source file.',
  },
  preview_only: {
    label: 'Preview-only',
    summary: 'Write execution blocked',
    detail: `${PREVIEW_ONLY_FORMAT_MESSAGE} ResourceForge can validate the proposed value and show a preview, but backup creation and rollback execution are blocked.`,
  },
  executable: {
    label: 'Executable',
    summary: 'Approval, backup, rollback',
    detail: 'Supported XML save-field writes require a proposal and explicit approval; ResourceForge creates a verified backup before writing and offers rollback after a supported write.',
  },
  blocked: {
    label: 'Blocked',
    summary: 'Format or operation unavailable',
    detail: `${UNSUPPORTED_FORMAT_BLOCKED_MESSAGE} Unsupported formats, unsafe paths, unsupported controls, and rejected operations cannot be executed, so backup and rollback actions are unavailable.`,
  },
};

const PREVIEW_ONLY_FORMATS = new Set(['json', 'ini', 'cfg', 'config']);

export function saveEditRiskStateForFormat(format: string): SaveEditRiskState {
  const normalized = format.trim().toLowerCase();
  if (normalized === 'xml') return 'executable';
  if (PREVIEW_ONLY_FORMATS.has(normalized)) return 'preview_only';
  if (normalized === 'unknown' || normalized === 'unsupported' || normalized === '') return 'blocked';
  return 'read_only';
}

export function saveEditRiskLabelForFormat(format: string): string {
  return SAVE_EDIT_RISK_COPY[saveEditRiskStateForFormat(format)].label;
}
