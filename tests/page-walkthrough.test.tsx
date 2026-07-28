import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageWalkthrough } from '../src/app/components/PageWalkthrough.tsx';
import {
  getWalkthrough,
  requiredWalkthroughIds,
  walkthroughs,
  type WalkthroughId,
} from '../src/app/help/walkthroughs.ts';

describe('page walkthrough registry', () => {
  const sourceByPage: Partial<Record<WalkthroughId, string>> = {
    'game-library': readFileSync('src/app/routes/GameLibrary.tsx', 'utf8'),
    'trainer-library': readFileSync('src/app/pages/TrainerLibraryPage.tsx', 'utf8'),
    'ct-library': readFileSync('src/app/pages/CtLibraryExplorerPage.tsx', 'utf8'),
    'registry-explorer': readFileSync('src/app/pages/RegistryExplorerPage.tsx', 'utf8'),
    'live-memory-trainer': readFileSync('src/app/pages/LiveMemoryTrainerPage.tsx', 'utf8'),
  };

  test('defines content for every required user-facing page', () => {
    assert.deepEqual(Object.keys(walkthroughs).sort(), [...requiredWalkthroughIds].sort());

    for (const pageId of requiredWalkthroughIds) {
      const entry = getWalkthrough(pageId);
      assert.equal(entry.pageId, pageId);
      assert.ok(entry.title.length > 8, `${pageId} needs a descriptive title`);
      assert.ok(entry.summary.length > 20, `${pageId} needs a useful summary`);
      assert.ok(entry.sections.length >= 3, `${pageId} needs procedural sections`);
      assert.ok(
        entry.sections.some((section) => /safe|what does not|get changed|guard|confirmation|risk/i.test(section.title)),
        `${pageId} needs a safety/confirmation section`,
      );
    }
  });

  test('keeps CT Library help specific to inert metadata import', () => {
    const ctLibrary = getWalkthrough('ct-library');
    const text = [
      ctLibrary.title,
      ctLibrary.summary,
      ...ctLibrary.sections.map((section) => `${section.title} ${String(section.body)}`),
    ].join(' ');

    assert.match(text, /CT ZIP/i);
    assert.match(text, /does not execute CT scripts/i);
    assert.match(text, /Electron desktop requirement/i);
  });

  test('critical walkthrough sections point at real page controls', () => {
    const requiredTargets: Array<{ pageId: WalkthroughId; targetControlId: string }> = [
      { pageId: 'game-library', targetControlId: 'game-library-add-manual' },
      { pageId: 'trainer-library', targetControlId: 'trainer-library-scan-installed' },
      { pageId: 'trainer-library', targetControlId: 'trainer-library-discovery-preview' },
      { pageId: 'ct-library', targetControlId: 'ct-library-import-zip' },
      { pageId: 'registry-explorer', targetControlId: 'registry-explorer-load-json-file' },
      { pageId: 'live-memory-trainer', targetControlId: 'live-memory-process-picker' },
      { pageId: 'live-memory-trainer', targetControlId: 'live-memory-auto-scan-all-types' },
    ];

    for (const { pageId, targetControlId } of requiredTargets) {
      const walkthrough = getWalkthrough(pageId);
      assert.ok(
        walkthrough.sections.some((section) => section.targetControlId === targetControlId),
        `${pageId} walkthrough must reference ${targetControlId}`,
      );
      assert.match(
        sourceByPage[pageId] ?? '',
        new RegExp(`id="${targetControlId}"`),
        `${targetControlId} must exist in ${pageId} page source`,
      );
    }
  });

  test('renders an accessible trigger with page-specific label', () => {
    const markup = renderToStaticMarkup(<PageWalkthrough pageId="game-library" />);

    assert.match(markup, /How this works/);
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /How this page works: How Game Library works/);
  });

  test('throws clearly for missing walkthrough ids in development paths', () => {
    assert.throws(
      () => getWalkthrough('missing-page' as WalkthroughId),
      /Missing Solith walkthrough content/,
    );
  });
});
