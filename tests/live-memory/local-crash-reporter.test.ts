import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  formatCrashReport,
  writeCrashReportSync,
  collectLocalDiagnostics,
  installLocalCrashHandlers,
  installElectronAppCrashHooks,
  setCrashReportContext,
  getCrashReportContext,
  resetCrashHandlersForTesting,
} from '../../src/core/crash/local-crash-reporter.js';

describe('local-crash-reporter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solith-crash-'));
    resetCrashHandlersForTesting();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetCrashHandlersForTesting();
  });

  test('formatCrashReport includes message, stack, diagnostics, and audit lines', () => {
    const text = formatCrashReport({
      at: '2026-07-18T00:00:00.000Z',
      source: 'uncaughtException',
      message: 'boom',
      stack: 'Error: boom\n    at test',
      diagnostics: collectLocalDiagnostics({ appVersion: '2.3.0-test' }),
      context: {
        pid: 1234,
        executableName: 'Demo.exe',
        lastFaultNote: 'confirmWrite@0x1000',
        recentAuditLines: ['{"op":"write"}'],
      },
    });
    assert.match(text, /telemetry-free/);
    assert.match(text, /message: boom/);
    assert.match(text, /attachedPid: 1234/);
    assert.match(text, /Demo\.exe/);
    assert.match(text, /recentAudit:/);
    assert.match(text, /diagnostics:/);
    assert.match(text, /appVersion: 2\.3\.0-test/);
    assert.match(text, /lastFaultNote: confirmWrite@0x1000/);
    assert.doesNotMatch(text, /https?:\/\//);
  });

  test('writeCrashReportSync writes crash_report.txt under logs dir', () => {
    const logsDir = path.join(tmpDir, 'logs');
    const reportPath = writeCrashReportSync(logsDir, {
      at: new Date().toISOString(),
      source: 'test',
      message: 'local only',
    });
    assert.equal(path.basename(reportPath), 'crash_report.txt');
    const body = fs.readFileSync(reportPath, 'utf8');
    assert.match(body, /local only/);
    assert.match(body, /diagnostics:/);
    assert.doesNotMatch(body, /https?:\/\//);
  });

  test('installElectronAppCrashHooks writes on render-process-gone', () => {
    const logsDir = path.join(tmpDir, 'logs');
    const fakeApp = new EventEmitter() as EventEmitter & { getVersion: () => string };
    fakeApp.getVersion = () => '9.9.9-test';

    installElectronAppCrashHooks(fakeApp, { logsDir, appVersion: '9.9.9-test' });
    fakeApp.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 1 });

    const body = fs.readFileSync(path.join(logsDir, 'crash_report.txt'), 'utf8');
    assert.match(body, /render-process-gone/);
    assert.match(body, /crashed/);
    assert.match(body, /9\.9\.9-test/);
    assert.doesNotMatch(body, /https?:\/\//);
  });

  test('process crash handling monitors without consuming uncaught exceptions', () => {
    const monitorBefore = process.listenerCount('uncaughtExceptionMonitor');
    const consumingBefore = process.listenerCount('uncaughtException');
    installLocalCrashHandlers({ logsDir: path.join(tmpDir, 'logs') });

    assert.equal(process.listenerCount('uncaughtExceptionMonitor'), monitorBefore + 1);
    assert.equal(process.listenerCount('uncaughtException'), consumingBefore);

    resetCrashHandlersForTesting();
    assert.equal(process.listenerCount('uncaughtExceptionMonitor'), monitorBefore);
  });

  test('setCrashReportContext is readable for live-session wiring', () => {
    setCrashReportContext({
      pid: 42,
      executableName: 'Demo.exe',
      recentAuditLines: ['{"op":"attach"}'],
    });
    const ctx = getCrashReportContext();
    assert.equal(ctx?.pid, 42);
    assert.equal(ctx?.executableName, 'Demo.exe');
    setCrashReportContext(undefined);
    assert.equal(getCrashReportContext(), undefined);
  });
});
