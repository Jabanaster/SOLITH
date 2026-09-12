import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Certification-pass finding: library-sections.ts's 5th section
 * ('missing_unsupported', label "Missing / Not Yet Supported") was
 * structurally unreachable from TrainerLibraryPage.tsx — `isFromLinkedLibrary`
 * was wired to the exact same signal as `isInstalled` (both `installedIds.has(...)`),
 * so assignLibrarySection's `isInstalled` check always fired first and a real
 * local install unmatched to any catalog entry was silently dropped from the
 * page entirely rather than reaching this section. Fixed by surfacing
 * unmatched install-discovery records as synthetic, non-catalog
 * LibraryGameEvidence/TrainerCatalogEntry pairs.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('unmatched local installs (no catalogGameId) are captured into state, not discarded', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /const \[unmatchedInstalledGames, setUnmatchedInstalledGames\] = useState/);
  assert.match(source, /setUnmatchedInstalledGames\(result\.games\.filter\(\(g\) => !g\.catalogGameId\)\)/);
  assert.match(source, /setUnmatchedInstalledGames\(list\.games\.filter\(\(g\) => !g\.catalogGameId\)\)/);
});

test('unmatched installs are converted to missing_unsupported-eligible evidence (isKnownToCatalog: false, isFromLinkedLibrary: true)', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  const fnBody = source.match(/function buildUnmatchedInstalledLibraryData\([\s\S]*?\n}/)?.[0] ?? '';
  assert.ok(fnBody.length > 0, 'expected buildUnmatchedInstalledLibraryData to exist');
  assert.match(fnBody, /isInstalled: false/);
  assert.match(fnBody, /isKnownToCatalog: false/);
  assert.match(fnBody, /isFromLinkedLibrary: true/);
  // Cross-check against the actual classifier so this test breaks if the
  // classifier's own precedence ever changes underneath this fix.
  const sectionsSource = readSource('src/core/trainer-catalog/library-sections.ts');
  assert.match(sectionsSource, /if \(game\.isFromLinkedLibrary\) return 'missing_unsupported';/);
});

test('synthetic entries never collide with real catalogGameIds and are excluded from Favorite/Request Support wiring', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /const LOCAL_INSTALL_SYNTHETIC_ID_PREFIX = 'local-install:';/);
  const renderCardBody = source.match(/const renderLibraryCard = \(g: LibraryGameEvidence\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
  assert.match(renderCardBody, /isSyntheticLocalInstallId\(entry\.catalogGameId\)/);
  assert.match(renderCardBody, /onToggleFavorite=\{isSynthetic \? undefined : handleToggleFavorite\}/);
  assert.match(renderCardBody, /onRequestSupport=\{isSynthetic \? undefined : handleRequestSupport\}/);
});

test('search filters unmatched-install evidence too, matching the "search covers every section" requirement', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(source, /queryFilteredUnmatchedEvidence/);
  assert.match(source, /unmatchedEvidence\.filter\(\(g\) => g\.displayName\.toLowerCase\(\)\.includes\(normalizedQuery\)\)/);
});
