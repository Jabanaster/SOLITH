import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { computeTrainerAccuracy } from '../src/core/trainer-catalog/trainer-accuracy.ts';

/**
 * Mission 10 (Personal Library Completion pass, Phase 2) — CatalogCard's
 * trainer accuracy badge.
 *
 * Follows the same source-text-assertion pattern already established by
 * tests/trainer-library-sort-ui.test.ts and tests/trainer-library-card-
 * states.test.tsx for this same page: TrainerLibraryPage.tsx imports a CSS
 * module (TrainerLibraryPage.module.css), and this repo's test runner
 * (tsx --test, no CSS-module loader configured) cannot import .tsx files
 * that pull one in directly — so page-level wiring is verified by real
 * source inspection rather than a JSDOM/renderToStaticMarkup render, exactly
 * like the existing tests for this same file.
 *
 * The underlying pure logic (computeTrainerAccuracy itself) already has its
 * own full unit-test suite in tests/trainer-accuracy.test.ts — this file
 * only proves the UI wiring: which states get a badge, what label each one
 * gets, and that the value comes from the real Phase 1 function rather than
 * a new invented computation.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const PAGE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/pages/TrainerLibraryPage.tsx'), 'utf-8').replace(/\r\n/g, '\n');

describe('CatalogCard — Mission 10 trainer accuracy badge wiring', () => {
  test('sources the accuracy value from the real Phase 1 computeTrainerAccuracy, not a new computation', () => {
    assert.match(PAGE_SOURCE, /import\s*\{\s*\n?\s*computeTrainerAccuracy/);
    assert.match(PAGE_SOURCE, /from '\.\.\/\.\.\/core\/trainer-catalog\/trainer-accuracy\.js'/);
    assert.match(PAGE_SOURCE, /computeTrainerAccuracy\(\{/);
  });

  test('CatalogCard accepts a trainerAccuracy prop typed as TrainerAccuracyState', () => {
    assert.match(PAGE_SOURCE, /trainerAccuracy\?:\s*TrainerAccuracyState;/);
  });

  test('exactly the 5 mission-required states get a badge label, INCOMPATIBLE/NONE do not', () => {
    const mapMatch = PAGE_SOURCE.match(
      /TRAINER_ACCURACY_BADGE_LABELS[^=]*=\s*\{([\s\S]*?)\};/,
    );
    assert.ok(mapMatch, 'expected TRAINER_ACCURACY_BADGE_LABELS map to be defined');
    const body = mapMatch![1];

    const expectedLabels: Record<string, string> = {
      LOCALLY_VERIFIED: 'Locally Verified',
      EXACT_VERSION_MATCH: 'Exact Match',
      STRONG_MATCH: 'Strong Match',
      VERSION_UNKNOWN: 'Version Unknown',
      NEEDS_REVERIFY: 'Needs Reverify',
    };
    for (const [state, label] of Object.entries(expectedLabels)) {
      const pattern = new RegExp(`${state}:\\s*'${label}'`);
      assert.match(body, pattern, `expected ${state} -> "${label}"`);
    }

    assert.doesNotMatch(body, /INCOMPATIBLE:/);
    assert.doesNotMatch(body, /\bNONE:/);
  });

  test('the badge only renders when a label exists for the current state (no clutter for INCOMPATIBLE/NONE)', () => {
    assert.match(PAGE_SOURCE, /const accuracyBadgeLabel = trainerAccuracy \? TRAINER_ACCURACY_BADGE_LABELS\[trainerAccuracy\] : undefined;/);
    assert.match(PAGE_SOURCE, /\{accuracyBadgeLabel && \(/);
  });

  test('the badge is a second slot alongside the existing tier/stale badge, not a replacement for it', () => {
    // Both the pre-existing tier/staleness badge and the new accuracy badge
    // must still be present in statusRow — this proves Mission 10 extended
    // the existing pattern instead of tearing it out.
    assert.match(PAGE_SOURCE, /isStale \? styles\.staleBadge : styles\.tierBadge/);
    assert.match(PAGE_SOURCE, /data-accuracy=\{trainerAccuracy\}/);
  });

  test('the call site computes trainerAccuracy from real, non-title evidence only (strongMatchEvidence from installedIds, never entry.displayName)', () => {
    const callSiteMatch = PAGE_SOURCE.match(/const trainerAccuracy = computeTrainerAccuracy\(\{([\s\S]*?)\}\);/);
    assert.ok(callSiteMatch, 'expected the call-site computeTrainerAccuracy(...) invocation');
    const body = callSiteMatch![1];
    assert.match(body, /hasTrainer:\s*entry\.hasModPack/);
    assert.match(body, /strongMatchEvidence:\s*isInstalledForAccuracy/);
    assert.doesNotMatch(body, /displayName/);
  });

  test('sanity: the real computeTrainerAccuracy used by the page yields the states the badge map expects', () => {
    assert.equal(
      computeTrainerAccuracy({
        hasTrainer: true,
        hasValidationReceipt: false,
        receiptStillValid: false,
        receiptFailed: false,
        exactVersionEvidence: false,
        exactVersionMismatch: false,
        strongMatchEvidence: true,
      }),
      'STRONG_MATCH',
    );
    assert.equal(
      computeTrainerAccuracy({
        hasTrainer: true,
        hasValidationReceipt: false,
        receiptStillValid: false,
        receiptFailed: false,
        exactVersionEvidence: false,
        exactVersionMismatch: false,
        strongMatchEvidence: false,
      }),
      'VERSION_UNKNOWN',
    );
    assert.equal(
      computeTrainerAccuracy({
        hasTrainer: false,
        hasValidationReceipt: false,
        receiptStillValid: false,
        receiptFailed: false,
        exactVersionEvidence: false,
        exactVersionMismatch: false,
        strongMatchEvidence: false,
      }),
      'NONE',
    );
  });
});
