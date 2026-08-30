/**
 * Privileged destructive-operation consent.
 *
 * Tokens are issued only after a main-process confirmation surface (native
 * dialog, or a test double). The renderer may request consent; it cannot
 * manufacture or auto-approve tokens by asserting userConfirmed.
 */
import { app, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  issueWriteConsent,
  WRITE_CONSENT_TTL_MS,
  type WriteConsentArtifact,
  type WriteConsentBinding,
} from '../src/core/consent/write-consent.js';

export interface PrivilegedConsentSummary {
  title: string;
  /** Human-readable lines shown in the dialog body. */
  lines: string[];
  binding: WriteConsentBinding;
  /** Optional ISO expiration override display. */
  expiresAtIso?: string;
}

export type PrivilegedConsentDialogResult =
  | { approved: true; consent: WriteConsentArtifact }
  | { approved: false; reason: string };

type DialogImpl = (input: {
  parent: BrowserWindow | null;
  summary: PrivilegedConsentSummary;
}) => Promise<'approve' | 'deny'>;

let dialogImpl: DialogImpl | null = null;

/**
 * Test / headless override.
 * - `auto-approve` / `auto-deny` via env SOLITH_PRIVILEGED_CONSENT
 * - or setPrivilegedConsentDialogForTests()
 *
 * MP-P0.1 — a real packaged install (`app.isPackaged === true`) must NEVER
 * honor SOLITH_PRIVILEGED_CONSENT: this env var, unguarded, was a complete
 * bypass of the human-in-the-loop consent gate for the app's most dangerous
 * operations (memory writes, freezes, injector helper launches) — anyone who
 * could set one environment variable before launching the packaged exe could
 * silently auto-approve every privileged operation with zero user
 * interaction. E2E tests launch via `_electron.launch()` against the raw
 * entry file, so `app.isPackaged` is false there too (same signal
 * runtime-trust.ts already relies on) — this gate does not break them.
 */
export function setPrivilegedConsentDialogForTests(impl: DialogImpl | null): void {
  dialogImpl = impl;
}

function resolveDialogImpl(): DialogImpl {
  if (dialogImpl) return dialogImpl;
  const mode = app.isPackaged ? '' : (process.env.SOLITH_PRIVILEGED_CONSENT ?? '').trim().toLowerCase();
  if (mode === 'auto-approve') {
    return async () => 'approve';
  }
  if (mode === 'auto-deny') {
    return async () => 'deny';
  }
  return async ({ parent, summary }) => {
    const expires =
      summary.expiresAtIso ??
      new Date(Date.now() + WRITE_CONSENT_TTL_MS).toISOString();
    const detail = [
      ...summary.lines,
      '',
      `Consent expires: ${expires}`,
      '',
      'Approving issues a short-lived, single-use token bound to this exact operation.',
      'Deny if any detail looks wrong.',
    ].join('\n');
    const result = await dialog.showMessageBox(parent ?? undefined, {
      type: 'warning',
      buttons: ['Deny', 'Approve'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: summary.title,
      message: summary.title,
      detail,
    });
    return result.response === 1 ? 'approve' : 'deny';
  };
}

export function parentWindowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export async function requestPrivilegedApproval(
  parent: BrowserWindow | null,
  summary: Omit<PrivilegedConsentSummary, 'binding'> & { binding?: WriteConsentBinding },
): Promise<{ approved: boolean; reason?: string }> {
  const decision = await resolveDialogImpl()({
    parent,
    summary: {
      title: summary.title,
      lines: summary.lines,
      binding: summary.binding ?? {
        operation: 'injector_confirm_launch',
        sessionKey: 'registration',
        proposalId: '00000000-0000-4000-8000-000000000099',
        attachedPid: 1,
        attachedExecutableName: 'registration',
        executablePath: 'C:\\registration',
        processStartTime: new Date(0).toISOString(),
      },
    },
  });
  if (decision !== 'approve') {
    return { approved: false, reason: 'user_denied_privileged_consent' };
  }
  return { approved: true };
}

/**
 * Show privileged confirmation; only on Approve issue a consent artifact.
 */
export async function requestPrivilegedWriteConsent(
  parent: BrowserWindow | null,
  summary: PrivilegedConsentSummary,
  options: { ttlMs?: number; nowMs?: number } = {},
): Promise<PrivilegedConsentDialogResult> {
  const approval = await requestPrivilegedApproval(parent, summary);
  if (!approval.approved) {
    return { approved: false, reason: approval.reason ?? 'user_denied_privileged_consent' };
  }
  // MP-P0.1 — same packaged-boundary rule as resolveDialogImpl() above: a
  // real packaged install must not let an environment variable extend the
  // approved-consent TTL window.
  const envTtl = app.isPackaged ? NaN : Number(process.env.SOLITH_CONSENT_TTL_MS ?? '');
  const ttlMs =
    options.ttlMs ??
    (Number.isFinite(envTtl) && envTtl > 0 ? Math.floor(envTtl) : undefined);
  const consent = issueWriteConsent(summary.binding, { ...options, ttlMs });
  return { approved: true, consent };
}

export function formatMemoryWriteConsentLines(input: {
  attachedExecutableName: string;
  attachedPid: number;
  executablePath?: string | null;
  address: string;
  dataType: string;
  currentValue: number;
  requestedValue: number;
  proposalId: string;
}): string[] {
  return [
    'Operation: live memory write (confirm)',
    `Process: ${input.attachedExecutableName} (PID ${input.attachedPid})`,
    `Executable path: ${input.executablePath?.trim() || '(unknown)'}`,
    `Proposal: ${input.proposalId}`,
    `Address: ${input.address}`,
    `Type: ${input.dataType}`,
    `Current value: ${input.currentValue}`,
    `Proposed value: ${input.requestedValue}`,
    'Consequence: process memory will be modified. Offline / solo-play only.',
  ];
}

export function formatFreezeConsentLines(input: {
  attachedExecutableName: string;
  attachedPid: number;
  executablePath?: string | null;
  address: string;
  dataType: string;
  value: number;
  intervalMs: number;
  maxDurationMs: number;
  proposalId: string;
}): string[] {
  return [
    'Operation: live memory freeze (repeated write)',
    `Process: ${input.attachedExecutableName} (PID ${input.attachedPid})`,
    `Executable path: ${input.executablePath?.trim() || '(unknown)'}`,
    `Proposal: ${input.proposalId}`,
    `Address: ${input.address}`,
    `Type: ${input.dataType}`,
    `Frozen value: ${input.value}`,
    `Re-write interval: ${input.intervalMs}ms`,
    `Auto-stops after: ${Math.round(input.maxDurationMs / 60000)} minutes`,
    'Consequence: process memory will be repeatedly overwritten until stopped or auto-expired. Offline / solo-play only.',
  ];
}

export function formatInjectorConsentLines(input: {
  attachedExecutableName: string;
  attachedPid: number;
  executablePath?: string | null;
  helperPath: string;
  helperSha256: string;
  proposalId: string;
}): string[] {
  return [
    'Operation: injector helper launch',
    `Attached process: ${input.attachedExecutableName} (PID ${input.attachedPid})`,
    `Attached path: ${input.executablePath?.trim() || '(unknown)'}`,
    `Proposal: ${input.proposalId}`,
    `Helper path: ${input.helperPath}`,
    `Helper SHA-256: ${input.helperSha256}`,
    'Consequence: Solith will spawn this helper detached. You are responsible for what it does.',
  ];
}
