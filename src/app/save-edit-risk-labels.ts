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
    summary: 'Validate and preview only',
    detail: 'ResourceForge can validate the proposed value and show a preview, but write execution is blocked.',
  },
  executable: {
    label: 'Executable',
    summary: 'Requires approval and backup',
    detail: 'Supported XML save-field writes require a proposal, explicit approval, verified backup, and rollback path.',
  },
  blocked: {
    label: 'Blocked',
    summary: 'Operation unavailable',
    detail: 'Unsupported formats, unsafe paths, unsupported controls, and rejected operations cannot be executed.',
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

