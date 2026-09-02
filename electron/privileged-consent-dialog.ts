/**
 * Privileged destructive-operation consent.
 *
 * Tokens are issued only after a main-process confirmation surface (native
 * dialog, or a test double). The renderer may request consent; it cannot
 * manufacture or auto-approve tokens by asserting userConfirmed.
 */
import * as electronModule from 'electron';
const { app, dialog, BrowserWindow } = (electronModule as any).default ?? electronModule as any;
import type { IpcMainInvokeEvent } from 'electron';
import {
  issueWriteConsent,
  WRITE_CONSENT_TTL_MS,
  type WriteConsentArtifact,
  type WriteConsentBinding,
} from '../src/core/consent/write-consent.js';
import {
  issueGrant,
  type AuthorityGrant,
  type Capability,
} from '../src/core/authority/index.js';

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
 */
export function setPrivilegedConsentDialogForTests(impl: DialogImpl | null): void {
  dialogImpl = impl;
}

/**
 * SOL0-P0-1: the SOLITH_PRIVILEGED_CONSENT / SOLITH_CONSENT_TTL_MS env
 * overrides must never be honored in a packaged build unless the packaged
 * process was itself explicitly built/launched as a test harness
 * (SOLITH_TEST_BUILD=1 — the same escape hatch already used by
 * src/core/live-memory/live-memory-session.ts's test-only globals). Without
 * this gate, setting SOLITH_PRIVILEGED_CONSENT=auto-approve before launching
 * the shipped .exe silently auto-approved every privileged consent dialog.
 * Exported (not just inlined) so packaged e2e coverage can assert the gate
 * behaviorally in the real running process instead of by source inspection.
 */
export function isPrivilegedConsentEnvOverrideAllowed(): boolean {
  return !app.isPackaged || process.env.SOLITH_TEST_BUILD === '1';
}

function resolveDialogImpl(): DialogImpl {
  if (dialogImpl) return dialogImpl;
  const mode = isPrivilegedConsentEnvOverrideAllowed()
    ? (process.env.SOLITH_PRIVILEGED_CONSENT ?? '').trim().toLowerCase()
    : '';
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
  const envTtl = isPrivilegedConsentEnvOverrideAllowed()
    ? Number(process.env.SOLITH_CONSENT_TTL_MS ?? '')
    : NaN;
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

export async function requestPrivilegedAuthorityGrant(
  parent: BrowserWindow | null,
  summary: { title: string; lines: string[]; capability: Capability; targetIdentifier: string; sessionKey: string },
  options: { ttlMs?: number; nowMs?: number } = {},
): Promise<{ approved: true; grant: AuthorityGrant } | { approved: false; reason: string }> {
  const approval = await requestPrivilegedApproval(parent, { title: summary.title, lines: summary.lines });
  if (!approval.approved) {
    return { approved: false, reason: approval.reason ?? 'user_denied_privileged_consent' };
  }
  const grant = issueGrant(
    { capability: summary.capability, targetIdentifier: summary.targetIdentifier, sessionKey: summary.sessionKey },
    options,
  );
  return { approved: true, grant };
}

