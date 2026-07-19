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
}

export interface CrashReportPayload {
  at: string;
  source: string;
  message: string;
  stack?: string;
  context?: CrashReportContext;
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
  if (payload.context?.pid != null) {
    lines.push(`attachedPid: ${payload.context.pid}`);
  }
  if (payload.context?.executableName) {
    lines.push(`executableName: ${payload.context.executableName}`);
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
  fs.writeFileSync(reportPath, formatCrashReport(payload), 'utf8');
  return reportPath;
}

export type CrashContextProvider = () => CrashReportContext | undefined;

export interface InstallCrashHandlersOptions {
  getContext?: CrashContextProvider;
  /** Prefer a known-absolute logs directory (sync, no Electron import race). */
  logsDir?: string;
}

let handlersInstalled = false;

function resolveLogsDirSync(override?: string): string {
  if (override) return override;
  // Prefer explicit logsDir from Electron main. Fallback for non-Electron hosts/tests.
  return path.join(process.cwd(), 'data', 'logs');
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

  const write = (source: string, error: unknown) => {
    try {
      const err = error instanceof Error ? error : new Error(String(error));
      const logsDir = resolveLogsDirSync(options.logsDir);
      writeCrashReportSync(logsDir, {
        at: new Date().toISOString(),
        source,
        message: err.message,
        stack: err.stack,
        context: options.getContext?.(),
      });
    } catch {
      // Swallow — crash reporter must not throw during crash handling.
    }
  };

  process.on('uncaughtException', (error) => {
    write('uncaughtException', error);
  });

  process.on('unhandledRejection', (reason) => {
    write('unhandledRejection', reason);
  });
}

/** Test helper — resets the install guard. */
export function resetCrashHandlersForTesting(): void {
  handlersInstalled = false;
}
