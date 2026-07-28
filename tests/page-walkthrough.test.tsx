import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageWalkthrough } from '../src/app/components/PageWalkthrough.tsx';
import {
  getWalkthrough,
  requiredWalkthroughIds,
  walkthroughAudit,
  walkthroughs,
  type WalkthroughId,
} from '../src/app/help/walkthroughs.ts';

describe('page walkthrough registry', () => {
  const sourceByPage: Record<WalkthroughId, string> = {
    'game-library': readFileSync('src/app/routes/GameLibrary.tsx', 'utf8'),
    'trainer-library': readFileSync('src/app/pages/TrainerLibraryPage.tsx', 'utf8'),
    'backups': readFileSync('src/app/pages/Backups.tsx', 'utf8'),
    'save-locations': readFileSync('src/app/pages/SaveLocations.tsx', 'utf8'),
    'activity-journal': readFileSync('src/app/pages/Journal.tsx', 'utf8'),
    'save-editor': readFileSync('src/app/pages/SaveEditor.tsx', 'utf8'),
    'trainer-controls': readFileSync('src/app/pages/TrainerControlPanel.tsx', 'utf8'),
    'discovery-lab': readFileSync('src/app/pages/DiscoveryLab.tsx', 'utf8'),
    'trainer-research-lab': readFileSync('src/app/pages/ExternalTrainerResearchLab.tsx', 'utf8'),
    'ct-library': readFileSync('src/app/pages/CtLibraryExplorerPage.tsx', 'utf8'),
    'registry-explorer': readFileSync('src/app/pages/RegistryExplorerPage.tsx', 'utf8'),
    'data-editor': readFileSync('src/app/pages/SaveEditor.tsx', 'utf8'),
    'compatibility': readFileSync('src/app/pages/CompatibilityDashboard.tsx', 'utf8'),
    'recipes': readFileSync('src/app/pages/Recipes.tsx', 'utf8'),
    'session-monitor': readFileSync('src/app/pages/SessionMonitorPage.tsx', 'utf8'),
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

  test('keeps navigation, audit classifications, registry, and page bindings aligned', () => {
    const appSource = readFileSync('src/app/App.tsx', 'utf8');
    assert.equal(walkthroughAudit.length, 16);
    assert.equal(walkthroughAudit.every(({ status }) => status === 'PASS'), true);

    for (const entry of walkthroughAudit) {
      assert.match(appSource, new RegExp(`\\{ id: '${entry.viewId}', label:`));
      assert.match(sourceByPage[entry.pageId], new RegExp(`(?:walkthroughId|pageId)=(?:"${entry.pageId}"|\\{[^}]*'${entry.pageId}'[^}]*\\})`));
      assert.equal(getWalkthrough(entry.pageId).pageId, entry.pageId);
    }
  });

  test('Activity Journal help documents only confirmed local behavior', () => {
    const journal = getWalkthrough('activity-journal');
    const text = [journal.title, journal.summary, ...journal.sections.map(({ title, body }) => `${title} ${String(body)}`)].join(' ');
    assert.match(text, /local SQLite database/i);
    assert.match(text, /does not upload/i);
    assert.match(text, /no clear, delete, or export control/i);
    assert.match(text, /does not modify game files/i);
    assert.match(text, /latest 100/i);
  });

  test('shared page shell owns walkthrough state by major navigation context', () => {
    const appSource = readFileSync('src/app/App.tsx', 'utf8');
    const walkthroughSource = readFileSync('src/app/components/PageWalkthrough.tsx', 'utf8');
    assert.match(appSource, /<WalkthroughOwner key=\{walkthroughOwnerKey\}>/);
    assert.match(appSource, /currentView,[\s\S]*selectedGame\?\.id[\s\S]*deckCatalogGameId[\s\S]*libraryLaunchGameId/);
    assert.doesNotMatch(walkthroughSource, /openPages/);
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

  test('Trainer Library discovery preview supports keyboard expansion and session-persistent resizing', () => {
    const source = sourceByPage['trainer-library'] ?? '';
    const styles = readFileSync('src/app/pages/TrainerLibraryPage.module.css', 'utf8');

    assert.match(source, /Expand preview/);
    assert.match(source, /Collapse preview/);
    assert.match(source, /aria-expanded=\{discoveryPreviewExpanded\}/);
    assert.match(source, /aria-controls="trainer-library-discovery-records"/);
    assert.match(source, /sessionStorage\.setItem\(DISCOVERY_PREVIEW_HEIGHT_KEY/);
    assert.match(source, /selectedDiscoveryIds\.has\(record\.previewCandidateId\)/);
    assert.match(styles, /resize:\s*vertical/);
    assert.match(styles, /\.scanRecordListExpanded/);
  });
});
