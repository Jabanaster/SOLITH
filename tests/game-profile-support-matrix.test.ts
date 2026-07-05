import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameProfileCatalogEntry } from '../src/core/game-profiles/index.js';
import {
  createSupportMatrixReport,
  getBundledGameProfileCatalog,
  renderSupportMatrixJson,
  renderSupportMatrixMarkdown,
} from '../src/core/game-profiles/index.js';

function makeNeedsReviewEntry(): GameProfileCatalogEntry {
  return {
    catalogId: 'imported-pending-review',
    gameId: 'imported-pending-review',
    displayName: 'Imported Pending Review',
    supportStatus: 'needs-review',
    parserStatus: 'needs-review',
    writeSupportStatus: 'supported',
    evidenceLevel: 'none',
    supportedFormats: ['json'],
    unsupportedReasons: ['write-not-supported', 'no-backup-strategy', 'no-rollback-proof'],
    fixtureReferences: ['demo-game/save/save1.json'],
    notes: ['Imported profile pending review before any support claim.'],
    warnings: ['Pending review profile must not be treated as executable support.'],
    localOnly: true,
    offlineOnly: true,
    singlePlayerOnly: true,
    profile: {
      profileVersion: '1.0.0',
      gameId: 'imported-pending-review',
      displayName: 'Imported Pending Review',
      saveFormat: 'json',
      controls: [
        {
          id: 'imported-read-only-gold',
          label: 'Gold (Imported)',
          description: 'Imported read-only placeholder.',
          category: 'PLAYER',
          controlType: 'readonly_value',
          backend: 'unsupported',
          safetyStatus: 'disabled',
          metadata: {
            valueType: 'number',
            defaultValue: 1,
            safeTestValue: 2,
            riskNotes: 'Imported profile is pending review only.',
          },
        },
      ],
    },
  };
}

function makeReadOnlyEntry(): GameProfileCatalogEntry {
  return {
    catalogId: 'demo-read-only',
    gameId: 'demo-read-only',
    displayName: 'Demo Read Only',
    supportStatus: 'read-only',
    parserStatus: 'read-only',
    writeSupportStatus: 'blocked',
    evidenceLevel: 'fixture-validated',
    supportedFormats: ['ini'],
    unsupportedReasons: ['write-not-supported', 'no-backup-strategy'],
    fixtureReferences: ['demo-game/data/player_stats.ini'],
    notes: ['Read-only parser coverage only.'],
    warnings: ['No executable write support.'],
    localOnly: true,
    offlineOnly: true,
    singlePlayerOnly: true,
    profile: {
      profileVersion: '1.0.0',
      gameId: 'demo-read-only',
      displayName: 'Demo Read Only',
      saveFormat: 'ini',
      controls: [
        {
          id: 'demo-read-only-level',
          label: 'Level',
          description: 'Read-only level value.',
          category: 'PLAYER',
          controlType: 'readonly_value',
          backend: 'unsupported',
          safetyStatus: 'disabled',
          metadata: {
            valueType: 'number',
            defaultValue: 5,
            safeTestValue: 6,
            riskNotes: 'Read-only coverage.',
          },
        },
      ],
    },
  };
}

test('support matrix generation is deterministic', () => {
  const first = createSupportMatrixReport(getBundledGameProfileCatalog());
  const second = createSupportMatrixReport(getBundledGameProfileCatalog());

  assert.deepEqual(first, second);
  assert.equal(renderSupportMatrixJson(first), renderSupportMatrixJson(second));
  assert.equal(renderSupportMatrixMarkdown(first), renderSupportMatrixMarkdown(second));
});

test('supported profile appears with correct evidence', () => {
  const report = createSupportMatrixReport(getBundledGameProfileCatalog());
  const stardew = report.rows.find(row => row.profileId === 'stardew-valley');

  assert.ok(stardew);
  assert.equal(stardew?.supportStatus, 'supported');
  assert.equal(stardew?.evidenceLevel, 'backup-rollback-verified');
  assert.equal(stardew?.executableWriteSupported, true);
  assert.equal(stardew?.backupRollbackReadiness, 'verified');
});

test('blocked profile appears with blocked reasons', () => {
  const report = createSupportMatrixReport(getBundledGameProfileCatalog());
  const blocked = report.rows.find(row => row.profileId === 'demo-data-blocked');

  assert.ok(blocked);
  assert.equal(blocked?.supportStatus, 'blocked');
  assert.equal(blocked?.executableWriteSupported, false);
  assert.ok((blocked?.unsupportedReasons ?? []).includes('missing-parser'));
});

test('preview-only and read-only profiles do not claim executable support', () => {
  const entries = [...getBundledGameProfileCatalog(), makeReadOnlyEntry()];
  const report = createSupportMatrixReport(entries);
  const preview = report.rows.find(row => row.profileId === 'demo-rpg-preview');
  const readOnly = report.rows.find(row => row.profileId === 'demo-read-only');

  assert.ok(preview);
  assert.equal(preview?.supportStatus, 'preview-only');
  assert.equal(preview?.executableWriteSupported, false);

  assert.ok(readOnly);
  assert.equal(readOnly?.supportStatus, 'read-only');
  assert.equal(readOnly?.executableWriteSupported, false);
});

test('imported pending-review profile does not claim support', () => {
  const entries = [...getBundledGameProfileCatalog(), makeNeedsReviewEntry()];
  const report = createSupportMatrixReport(entries);
  const pending = report.rows.find(row => row.profileId === 'imported-pending-review');

  assert.ok(pending);
  assert.equal(pending?.supportStatus, 'needs-review');
  assert.equal(pending?.executableWriteSupportStatus, 'needs-review');
  assert.equal(pending?.executableWriteSupported, false);
});

test('report wording stays local and has no network dependency', () => {
  const report = createSupportMatrixReport(getBundledGameProfileCatalog());
  const markdown = renderSupportMatrixMarkdown(report);
  const json = renderSupportMatrixJson(report);

  assert.ok(!markdown.includes('http://'));
  assert.ok(!markdown.includes('https://'));
  assert.ok(!json.includes('http://'));
  assert.ok(!json.includes('https://'));
  assert.ok(markdown.includes('local-only, offline-only, single-player-only'));
});
