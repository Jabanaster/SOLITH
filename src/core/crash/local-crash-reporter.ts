/**
 * Telemetry-free local crash reporter.
 *
 * Writes crash_report.txt under the Solith userData logs directory.
 * Never opens a network socket or phones home.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface CrashReportContext {
  pid?: number;
  executableName?: string;
  recentAuditLines?: string[];
  /** Optional last known memory op / fault note (local only). */
  lastFaultNote?: string;
}

export interface LocalDiagnostics {
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion?: string;
  appVersion?: string;
  pid: number;
  rssBytes: number;
  heapUsedBytes: number;
  uptimeSec: number;
}

export interface CrashReportPayload {
  at: string;
  source: string;
  message: string;
  stack?: string;
  context?: CrashReportContext;
  diagnostics?: LocalDiagnostics;
}

export function collectLocalDiagnostics(extra?: {
  electronVersion?: string;
  appVersion?: string;
}): LocalDiagnostics {
  const mem = process.memoryUsage();
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: extra?.electronVersion ?? process.versions.electron,
    appVersion: extra?.appVersion,
    pid: process.pid,
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    uptimeSec: Math.round(process.uptime()),
  };
}

export function formatCrashReport(payload: CrashReportPayload): string {
  const lines = [
    'Solith local crash report (telemetry-free — not uploaded)',
    `at: ${payload.at}`,
    `source: ${payload.source}`,
    `message: ${payload.message}`,
  ];
  if (payload.stack) {
    lines.push('stack:');
    lines.push(payload.stack);
  }
  const diag = payload.diagnostics;
  if (diag) {
    lines.push('diagnostics:');
    lines.push(`  platform: ${diag.platform}/${diag.arch}`);
    lines.push(`  node: ${diag.nodeVersion}`);
    if (diag.electronVersion) lines.push(`  electron: ${diag.electronVersion}`);
    if (diag.appVersion) lines.push(`  appVersion: ${diag.appVersion}`);
    lines.push(`  processPid: ${diag.pid}`);
    lines.push(`  rssBytes: ${diag.rssBytes}`);
    lines.push(`  heapUsedBytes: ${diag.heapUsedBytes}`);
    lines.push(`  uptimeSec: ${diag.uptimeSec}`);
  }
  if (payload.context?.pid != null) {
    lines.push(`attachedPid: ${payload.context.pid}`);
  }
  if (payload.context?.executableName) {
    lines.push(`executableName: ${payload.context.executableName}`);
  }
  if (payload.context?.lastFaultNote) {
    lines.push(`lastFaultNote: ${payload.context.lastFaultNote}`);
  }
  if (payload.context?.recentAuditLines && payload.context.recentAuditLines.length > 0) {
    lines.push('recentAudit:');
    for (const line of payload.context.recentAuditLines) {
      lines.push(`  ${line}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function writeCrashReportSync(logsDir: string, payload: CrashReportPayload): string {
  fs.mkdirSync(logsDir, { recursive: true });
  const reportPath = path.join(logsDir, 'crash_report.txt');
  const withDiag: CrashReportPayload = {
    ...payload,
    diagnostics: payload.diagnostics ?? collectLocalDiagnostics(),
  };
  fs.writeFileSync(reportPath, formatCrashReport(withDiag), 'utf8');
  return reportPath;
}

export type CrashContextProvider = () => CrashReportContext | undefined;

export interface InstallCrashHandlersOptions {
  getContext?: CrashContextProvider;
  /** Prefer a known-absolute logs directory (sync, no Electron import race). */
  logsDir?: string;
  electronVersion?: string;
  appVersion?: string;
}

let handlersInstalled = false;
let electronHooksInstalled = false;
let processCrashMonitor:
  | ((error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void)
  | null = null;
/** Shared context updated by live-memory IPC (PID/exe/audit). */
let sharedCrashContext: CrashReportContext | undefined;

/** Update process-wide crash context (local only — never uploaded). */
export function setCrashReportContext(context: CrashReportContext | undefined): void {
  sharedCrashContext = context;
}

export function getCrashReportContext(): CrashReportContext | undefined {
  return sharedCrashContext;
}

function resolveLogsDirSync(override?: string): string {
  if (override) return override;
  return path.join(process.cwd(), 'data', 'logs');
}

function writeFromUnknown(
  source: string,
  error: unknown,
  options: InstallCrashHandlersOptions,
  extraMessage?: string,
): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const logsDir = resolveLogsDirSync(options.logsDir);
    const context = {
      ...sharedCrashContext,
      ...options.getContext?.(),
    };
    writeCrashReportSync(logsDir, {
      at: new Date().toISOString(),
      source,
      message: extraMessage ? `${extraMessage}: ${err.message}` : err.message,
      stack: err.stack,
      context,
      diagnostics: collectLocalDiagnostics({
        electronVersion: options.electronVersion,
        appVersion: options.appVersion,
      }),
    });
  } catch {
    // Swallow — crash reporter must not throw during crash handling.
  }
}

/**
 * Install process-level handlers that write a local crash_report.txt.
 * Safe to call once from Electron main; no-ops on subsequent calls.
 */
export function installLocalCrashHandlers(
  getContextOrOptions?: CrashContextProvider | InstallCrashHandlersOptions,
): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  const options: InstallCrashHandlersOptions =
    typeof getContextOrOptions === 'function'
      ? { getContext: getContextOrOptions }
      : (getContextOrOptions ?? {});

  // Monitor without consuming the fatal event. An `uncaughtException`
  // listener would suppress Node's default exit and leave Electron running in
  // an undefined state; uncaughtExceptionMonitor records then preserves it.
  processCrashMonitor = (error, origin) => {
    writeFromUnknown(origin, error, options);
  };
  process.on('uncaughtExceptionMonitor', processCrashMonitor);
}

/**
 * Electron app-level hooks (renderer / child process gone). Local file only.
 * Call after `app` is available; safe to call once.
 */
export function installElectronAppCrashHooks(
  appLike: {
    on: (event: string, listener: (...args: any[]) => void) => void;
    getVersion?: () => string;
  },
  options: InstallCrashHandlersOptions = {},
): void {
  if (electronHooksInstalled) return;
  electronHooksInstalled = true;

  const merged: InstallCrashHandlersOptions = {
    ...options,
    appVersion: options.appVersion ?? appLike.getVersion?.(),
    electronVersion: options.electronVersion ?? process.versions.electron,
  };

  appLike.on('render-process-gone', (_event: unknown, _webContents: unknown, details: { reason?: string; exitCode?: number }) => {
    writeFromUnknown(
      'render-process-gone',
      new Error(`reason=${details?.reason ?? 'unknown'} exitCode=${details?.exitCode ?? '?'}`),
      merged,
      'Renderer process terminated',
    );
  });

  appLike.on('child-process-gone', (_event: unknown, details: { type?: string; reason?: string; exitCode?: number; name?: string }) => {
    writeFromUnknown(
      'child-process-gone',
      new Error(
        `type=${details?.type ?? '?'} name=${details?.name ?? '?'} reason=${details?.reason ?? '?'} exitCode=${details?.exitCode ?? '?'}`,
      ),
      merged,
      'Child process terminated',
    );
  });
}

/** Test helper — resets the install guards. */
export function resetCrashHandlersForTesting(): void {
  if (processCrashMonitor) {
    process.off('uncaughtExceptionMonitor', processCrashMonitor);
    processCrashMonitor = null;
  }
  handlersInstalled = false;
  electronHooksInstalled = false;
}
