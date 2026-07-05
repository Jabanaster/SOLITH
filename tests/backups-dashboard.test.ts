import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildBackupDashboardSummary } from '../src/app/pages/backups-dashboard.js';

describe('buildBackupDashboardSummary', () => {
  test('1. returns zeroed summary for no backups', () => {
    const summary = buildBackupDashboardSummary([]);
    assert.strictEqual(summary.totalBackups, 0);
    assert.strictEqual(summary.uniqueFiles, 0);
    assert.strictEqual(summary.recipeLinkedBackups, 0);
    assert.strictEqual(summary.latestTimestamp, null);
    assert.strictEqual(summary.latestFilePath, null);
  });

  test('2. counts unique target files and recipe-linked snapshots', () => {
    const summary = buildBackupDashboardSummary([
      {
        id: 'one',
        timestamp: '2026-01-01T10:00:00.000Z',
        filePath: 'C:\\Games\\A\\save.json',
        originalHash: 'hash-1',
        backupPath: 'C:\\Backups\\one.json',
        recipeId: 'recipe-a',
      },
      {
        id: 'two',
        timestamp: '2026-01-02T10:00:00.000Z',
        filePath: 'C:\\Games\\A\\SAVE.JSON',
        originalHash: 'hash-2',
        backupPath: 'C:\\Backups\\two.json',
      },
      {
        id: 'three',
        timestamp: '2026-01-03T10:00:00.000Z',
        filePath: 'C:\\Games\\B\\profile.json',
        originalHash: 'hash-3',
        backupPath: 'C:\\Backups\\three.json',
        recipeId: 'recipe-b',
      },
    ]);

    assert.strictEqual(summary.totalBackups, 3);
    assert.strictEqual(summary.uniqueFiles, 2);
    assert.strictEqual(summary.recipeLinkedBackups, 2);
    assert.strictEqual(summary.latestTimestamp, '2026-01-03T10:00:00.000Z');
    assert.strictEqual(summary.latestFilePath, 'C:\\Games\\B\\profile.json');
  });
});
