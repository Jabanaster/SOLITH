import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

test('trainer library labels scan-required community entries as Community Scan', () => {
  const source = readSource('src/app/pages/TrainerLibraryPage.tsx');

  assert.match(source, /function isCommunityScanEntry/);
  assert.match(source, /Community Scan/);
  assert.match(source, /requiresCommunityExecutionApproval\(entry\.certLevel\)/);
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
