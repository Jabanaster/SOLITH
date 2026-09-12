import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Mission 8/9 (Personal Library Completion pass) — Linked Game Libraries
 * foundation. Static source inspection (matching the project's existing
 * trainer-library-*.test.ts convention — no React Testing Library harness
 * exists here) asserting the page never fabricates account/ownership state
 * for a provider that has no real scanner, per provider-capabilities.ts.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

test('LinkedLibrariesPage reads live provider capabilities, never a hardcoded provider list', () => {
  const source = readSource('src/app/pages/LinkedLibrariesPage.tsx');
  assert.match(source, /window\.electronAPI\?\.linkedLibrariesList\?\.\(\)/);
  assert.doesNotMatch(source, /'Connected'/, 'must never render a fabricated Connected status');
  assert.doesNotMatch(source, />\s*Owned:/, 'must never render a fabricated owned-count label');
});

test('LinkedLibrariesPage renders honest per-provider capability, not a universal "supported"', () => {
  // UPDATE NOTICE (Mission 19, Personal Library Completion pass, Phase 2):
  // the old binary "Local install detection available" / "Integration not
  // yet available" copy is replaced by a real 3-level Supported/Partial/
  // Unsupported scale (see provider-capabilities.ts's CapabilityLevel) so a
  // PARTIAL provider (xbox, ea) is no longer indistinguishable from a fully
  // unsupported one (battlenet). This is an intentional, documented UI
  // change, not a silent regression — the underlying honesty guarantee
  // (never claim more than the real scanner supports) is unchanged and
  // still asserted below.
  const source = readSource('src/app/pages/LinkedLibrariesPage.tsx');
  assert.match(source, /localDiscoverySupported/);
  assert.match(source, /installedDetectionLevel/);
  assert.match(source, /ownershipDetectionLevel/);
  assert.match(source, /CAPABILITY_LEVEL_LABELS/);
  assert.match(source, /fullOwnershipSupported/);
});

test('LinkedLibrariesPage shows Games found, Last scan, and Ownership source per provider (Mission 19)', () => {
  const source = readSource('src/app/pages/LinkedLibrariesPage.tsx');
  assert.match(source, /Games found/);
  assert.match(source, /Last scan/);
  assert.match(source, /Ownership source/);
  assert.match(source, /formatLastScan/);
});

test('a provider with no ownership signal is never called "linked" in the full account-sync sense', () => {
  const source = readSource('src/app/pages/LinkedLibrariesPage.tsx');
  assert.match(source, /never treated as ownership|installed-only evidence is never/i);
});

test('linked-libraries-list IPC handler is read-only, sender-guarded, and sources real install counts', () => {
  const source = readSource('electron/install-discovery-ipc.ts');
  assert.match(source, /guardedHandle\('linked-libraries-list'/);
  assert.match(source, /listProviderCapabilities\(\)/);
  assert.match(source, /listInstalledGames\(\)/, 'per-provider counts must come from the real install-discovery store');
});

test('provider-capabilities.ts is the single source of truth the IPC handler reuses, not a duplicated list', () => {
  const capabilitiesSource = readSource('src/core/install-discovery/provider-capabilities.ts');
  const ipcSource = readSource('electron/install-discovery-ipc.ts');
  assert.match(capabilitiesSource, /fullOwnershipSupported: false/);
  assert.match(ipcSource, /from '\.\.\/src\/core\/install-discovery\/provider-capabilities\.js'/);
});

test('linked-libraries view is wired into navigation (nav-views.ts and App.tsx)', () => {
  const navViews = readSource('src/app/nav-views.ts');
  const app = readSource('src/app/App.tsx');
  assert.match(navViews, /'linked-libraries'/);
  assert.match(app, /case 'linked-libraries':/);
  assert.match(app, /<LinkedLibrariesPage \/>/);
});

/**
 * Mission 10 (Gate 2.5 doc audit) — wording honesty. The page must never
 * render a raw enum-looking token verbatim (the literal all-caps spelling
 * used internally, or "NOT SAFELY SUPPORTED" from provider-capabilities.ts's
 * doc comments, or the bare lowercase word "unsupported" standing in for a
 * sentence) and must never leak implementation jargon like a registry path.
 * It must instead read as plain-language "installed / ownership" honesty,
 * and a fully-unsupported provider (Battle.net) must read as "automatic
 * discovery unavailable, add manually" rather than broken/erroring.
 */
test('LinkedLibrariesPage never renders raw enum tokens or implementation jargon', () => {
  const source = readSource('src/app/pages/LinkedLibrariesPage.tsx');

  // Case-sensitive: the internal enum spelling and the doc-comment-only
  // phrase must never appear as literal source text rendered to the user.
  assert.doesNotMatch(source, /PARTIAL/, 'must never render the raw all-caps enum value "PARTIAL"');
  assert.doesNotMatch(source, /NOT SAFELY SUPPORTED/, 'must never render the doc-comment phrase verbatim');
  // Bare lowercase "unsupported" standing alone as rendered copy (not part of
  // a real sentence) — the page's own labels capitalize this
  // (CAPABILITY_LEVEL_LABELS uses "Unsupported"), so a bare lowercase
  // instance would indicate a raw value leaking into JSX text.
  assert.doesNotMatch(source, />\s*unsupported\s*</, 'must never render the bare lowercase word "unsupported" as rendered text');

  // No registry paths, file paths, or other implementation jargon in
  // user-facing strings (this file has no legitimate reason to mention a
  // registry hive or a .ts filename in rendered copy).
  assert.doesNotMatch(source, /HKLM|HKCR|HKEY_/, 'must never show a registry path to the user');
  assert.doesNotMatch(source, /\.ts['"`]/, 'must never show a source filename to the user');
});

test('LinkedLibrariesPage gives Steam an honest, non-enum installed/ownership description', () => {
  const source = readSource('src/app/pages/LinkedLibrariesPage.tsx');
  // Steam's row is driven by installDetectionNote(); confirm the honest
  // plain-language sentence generator exists and describes automatic
  // detection for a 'supported' level rather than a bare label.
  assert.match(source, /installedDetectionNote/);
  assert.match(source, /automatically finds \$\{displayName\} games installed/);
});

test('LinkedLibrariesPage describes Battle.net (and any unsupported provider) as "currently unavailable" with a real manual-add path, not as broken', () => {
  const source = readSource('src/app/pages/LinkedLibrariesPage.tsx');
  assert.match(source, /isn't available yet/i, 'unsupported providers must read as "not available yet", not an error');
  assert.match(source, /add its games manually by dragging the game's \.exe onto the Trainer Library page/);

  // The manual-add path referenced above must actually exist — verify
  // TrainerLibraryPage.tsx really implements a drag-and-drop .exe add flow,
  // so this copy never claims a path that isn't real.
  const trainerLibrarySource = readSource('src/app/pages/TrainerLibraryPage.tsx');
  assert.match(trainerLibrarySource, /handleDropExe/, 'LinkedLibrariesPage references a manual drag-and-drop add path that must actually exist in TrainerLibraryPage.tsx');
  assert.match(trainerLibrarySource, /onDrop=/);
});

test('LinkedLibrariesPage never colors the "unsupported" badge as an alarming error state', () => {
  const cssSource = readSource('src/app/pages/LinkedLibrariesPage.module.css');
  // The badgeUnsupported rule must not use the same alarm-red palette as a
  // real error/destructive state elsewhere in the app; a neutral/slate tone
  // is required so "no scanner yet" doesn't read as "broken".
  const match = cssSource.match(/\.badgeUnsupported\s*{[^}]*}/);
  assert.ok(match, 'expected a .badgeUnsupported rule in LinkedLibrariesPage.module.css');
  assert.doesNotMatch(match![0], /#f0a3a3|#3a2323/, 'unsupported badge must not use the alarm-red palette');
});
