import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { isCommunityScanEntry, tierHint } from '../src/app/pages/trainer-library-verification-state.ts';
import type { TrainerCatalogEntry } from '../src/core/trainer-catalog/types.ts';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const PAGE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/pages/TrainerLibraryPage.tsx'), 'utf8');

function baseEntry(overrides: Partial<TrainerCatalogEntry> = {}): TrainerCatalogEntry {
  return {
    catalogGameId: 'test-game',
    displayName: 'Test Game',
    executables: ['Test.exe'],
    categories: ['Action'],
    verificationStatus: 'metadata-only',
    sources: [],
    hasModPack: false,
    cheatCount: 0,
    searchableText: 'test game',
    ...overrides,
  };
}

describe('verification-state model — isCommunityScanEntry / tierHint (real state logic, not source text)', () => {
  test('verified entry is never a scan-required entry', () => {
    const entry = baseEntry({ verificationStatus: 'verified', hasModPack: true, cheatCount: 4 });
    assert.equal(isCommunityScanEntry(entry), false);
    assert.match(tierHint(entry), /Instant/);
  });

  test('community entry with a mod pack is scan-required', () => {
    const entry = baseEntry({ verificationStatus: 'community', hasModPack: true, cheatCount: 2 });
    assert.equal(isCommunityScanEntry(entry), true);
    assert.match(tierHint(entry), /Discovery first/);
  });

  test('community entry WITHOUT a mod pack is not scan-required (no live-attach surface to scan)', () => {
    const entry = baseEntry({ verificationStatus: 'community', hasModPack: false });
    assert.equal(isCommunityScanEntry(entry), false);
  });

  test('metadata-only entry is not scan-required, hints at sync/import', () => {
    const entry = baseEntry({ verificationStatus: 'metadata-only' });
    assert.equal(isCommunityScanEntry(entry), false);
    assert.match(tierHint(entry), /Metadata only/);
  });

  test('unverified entry with a mod pack is not scan-required (only community-tier triggers the scan gate)', () => {
    const entry = baseEntry({ verificationStatus: 'unverified', hasModPack: true, cheatCount: 1 });
    assert.equal(isCommunityScanEntry(entry), false);
  });

  test('L0_Community cert level forces scan-required even if verificationStatus says otherwise', () => {
    const entry = baseEntry({
      verificationStatus: 'verified',
      certLevel: 'L0_Community',
      hasModPack: true,
      cheatCount: 1,
    });
    assert.equal(isCommunityScanEntry(entry), true);
  });

  test('L3_Certified cert level does not force scan-required', () => {
    const entry = baseEntry({
      verificationStatus: 'community',
      certLevel: 'L3_Certified',
      hasModPack: true,
      cheatCount: 1,
    });
    // still scan-required, because verificationStatus is 'community' — cert level alone doesn't clear it
    assert.equal(isCommunityScanEntry(entry), true);
  });
});

describe('card markup — badge separation and action hierarchy (source-level, matching this repo\'s existing test style for this file)', () => {
  test('the scan-required badge is rendered separately from installed/running/stale badges — each is its own conditional, not merged', () => {
    assert.match(PAGE_SOURCE, /isCommunityScanEntry\(entry\) && \(/);
    assert.match(PAGE_SOURCE, /\{installed && \(/);
    assert.match(PAGE_SOURCE, /\{running && \(/);
    assert.match(PAGE_SOURCE, /healthStatus === 'stale' \|\| healthStatus === 'quarantined'/);
  });

  test('scan-required badge no longer renders a warning icon (softened, not a failure state)', () => {
    assert.ok(!PAGE_SOURCE.includes("aria-hidden=\"true\">⚠"));
  });

  test('primary action button is rendered unconditionally; secondary/contributor/verification actions are inside a details disclosure', () => {
    assert.match(PAGE_SOURCE, /className=\{communityScan \? styles\.communityScanBtn : styles\.launchBtn\}/);
    assert.match(PAGE_SOURCE, /<details className=\{styles\.moreActions\}>/);
    assert.match(PAGE_SOURCE, /<summary>More actions<\/summary>/);
  });

  test('Export YAML, Publish to Hub, Confirm works, Request verification, Notify when verified all live inside the disclosure', () => {
    const detailsBlockMatch = PAGE_SOURCE.match(/<details className=\{styles\.moreActions\}>[\s\S]*?<\/details>/);
    assert.ok(detailsBlockMatch, 'expected a <details> block for secondary actions');
    const block = detailsBlockMatch![0];
    assert.match(block, /Export YAML/);
    assert.match(block, /Publish to Hub/);
    assert.match(block, /Confirm works/);
    assert.match(block, /Request verification/);
    assert.match(block, /Notify when verified/);
  });

  test('no action was deleted — every handler prop is still wired to a button', () => {
    for (const handler of ['onLaunch', 'onExport', 'onThumbUp', 'onRequestVerification', 'onNotify', 'onPublish']) {
      assert.match(PAGE_SOURCE, new RegExp(`void ${handler}\\(entry\\)`));
    }
  });
});
