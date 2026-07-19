import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  formatCrashReport,
  writeCrashReportSync,
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

  test('formatCrashReport includes message, stack, and audit lines', () => {
    const text = formatCrashReport({
      at: '2026-07-18T00:00:00.000Z',
      source: 'uncaughtException',
      message: 'boom',
      stack: 'Error: boom\n    at test',
      context: {
        pid: 1234,
        executableName: 'Demo.exe',
        recentAuditLines: ['{"op":"write"}'],
      },
    });
    assert.match(text, /telemetry-free/);
    assert.match(text, /message: boom/);
    assert.match(text, /attachedPid: 1234/);
    assert.match(text, /Demo\.exe/);
    assert.match(text, /recentAudit:/);
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
    assert.doesNotMatch(body, /https?:\/\//);
  });
});
