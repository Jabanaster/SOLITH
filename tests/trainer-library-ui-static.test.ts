import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

test('trainer library exposes scan-required community entries via View Details, not a shouted Community Scan label', () => {
  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  // isCommunityScanEntry/tierHint moved to a CSS-free module so they can be
  // unit-tested directly (see tests/trainer-library-card-states.test.tsx) —
  // the page now imports rather than defines them.
  const stateSource = readSource('src/app/pages/trainer-library-verification-state.ts');

  assert.match(pageSource, /import \{ isCommunityScanEntry, tierHint \} from '\.\/trainer-library-verification-state\.js'/);
  assert.match(stateSource, /export function isCommunityScanEntry/);
  // Round 5 replaced the visible "Community Scan" wording with a neutral
  // "View Details" label — the scan-required signal now lives only in the
  // button's title tooltip and tierHint, not the on-card text.
  assert.match(pageSource, /communityScan \|\| isGeneric \? 'View Details'/);
  assert.ok(!pageSource.includes('Community Scan'), 'obsolete "Community Scan" wording should be gone from the card surface');
  assert.match(stateSource, /requiresCommunityExecutionApproval\(entry\.certLevel\)/);
});

test('trainer library exposes smoother catalog scrolling and back-to-top control', () => {
  const pageSource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  const gridSource = readSource('src/app/components/VirtualCatalogGrid.tsx');
  const cssSource = readSource('src/app/pages/TrainerLibraryPage.module.css');

  assert.match(pageSource, /backToTopClassName=\{styles\.backToTopBtn\}/);
  assert.match(gridSource, /scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/);
  assert.match(cssSource, /\.backToTopBtn/);
  assert.match(cssSource, /scroll-behavior:\s*smooth/);
});
