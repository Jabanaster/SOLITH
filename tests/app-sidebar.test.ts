import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ALL_VIEWS, APP_SIDEBAR_VIEWS } from '../src/app/nav-views.ts';

// AppSidebar.tsx and SidebarQuickAccess.tsx both import a `*.module.css`
// file, which the plain `tsx --test` runner used by this repo cannot
// resolve (Node's ESM loader has no CSS loader registered — same situation
// documented in tests/game-card-badge-hierarchy.test.tsx and
// tests/trainer-library-card-states.test.tsx). Following the established
// convention: read the real source files and assert on the exact wiring,
// rather than importing/rendering them.
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const APP_SIDEBAR_SOURCE = fs.readFileSync(
  path.join(ROOT, 'src/app/components/sidebar/AppSidebar.tsx'),
  'utf8',
);
const QUICK_ACCESS_SOURCE = fs.readFileSync(
  path.join(ROOT, 'src/app/components/sidebar/SidebarQuickAccess.tsx'),
  'utf8',
);
const APP_TSX_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/App.tsx'), 'utf8');

const REAL_VIEW_IDS = new Set<string>(ALL_VIEWS as readonly string[]);

describe('AppSidebar — static nav items use real View ids', () => {
  // Discovery Master Pass section 1 — Discovery/Community/Backups joined
  // Home/My Games as primary product destinations.
  const expectedStaticIds = [
    'home',
    'my-games',
    'discovery',
    'community',
    'backups',
    'trainer-library',
    'ct-library',
    'linked-libraries',
  ];

  test('every expected static nav id is a real View id from nav-views.ts', () => {
    for (const id of expectedStaticIds) {
      assert.ok(REAL_VIEW_IDS.has(id), `${id} must be a real View id in ALL_VIEWS`);
    }
  });

  test('STATIC_NAV_ITEMS in the source declares exactly the 5 expected ids, in order', () => {
    const match = APP_SIDEBAR_SOURCE.match(/const STATIC_NAV_ITEMS: AppSidebarNavItem\[\] = \[([\s\S]*?)\];/);
    assert.ok(match, 'STATIC_NAV_ITEMS array literal not found');
    const body = match![1];
    const ids = [...body.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(ids, expectedStaticIds);
    for (const id of ids) {
      assert.ok(REAL_VIEW_IDS.has(id), `${id} must be a real View id`);
    }
  });

  test('nav items are rendered with a stable per-item test id derived from the real view id', () => {
    assert.match(APP_SIDEBAR_SOURCE, /data-testid=\{`app-sidebar-nav-\$\{item\.id\}`\}/);
  });

  test('no fabricated artwork: falls back to the plain Icon component when NAV_MODULE_ARTWORK has no entry', () => {
    assert.match(APP_SIDEBAR_SOURCE, /const artwork = NAV_MODULE_ARTWORK\[item\.id\];/);
    assert.match(APP_SIDEBAR_SOURCE, /artwork \? \(\s*<BrandingArtwork artwork=\{artwork\} size="nav" \/>\s*\) : \(\s*<Icon name=\{item\.icon\} size=\{20\} \/>\s*\)/);
  });
});

describe('AppSidebar — quick access shelves wire to usePersonalLibraryGames (real data source)', () => {
  test('uses the real personal-library-games hook, not fabricated arrays', () => {
    assert.match(APP_SIDEBAR_SOURCE, /import \{ usePersonalLibraryGames \} from '\.\.\/\.\.\/hooks\/usePersonalLibraryGames\.js';/);
    assert.match(APP_SIDEBAR_SOURCE, /const \{ runningGame, favoriteGames, myGames \} = usePersonalLibraryGames\(\);/);
  });
});

describe('usePersonalLibraryGames — My Games is a real composed list, not a hardcoded empty placeholder', () => {
  const HOOK_SOURCE = fs.readFileSync(
    path.join(ROOT, 'src/app/hooks/usePersonalLibraryGames.ts'),
    'utf8',
  );
  const COMPOSER_SOURCE = fs.readFileSync(
    path.join(ROOT, 'src/app/hooks/personal-library-my-games.ts'),
    'utf8',
  );

  test('the hook no longer hardcodes myGames to an empty array', () => {
    assert.doesNotMatch(HOOK_SOURCE, /useMemo<GameCardData\[\]>\(\(\) => \[\], \[\]\)/);
    assert.doesNotMatch(HOOK_SOURCE, /const myGames = \[\];/);
  });

  test('the hook composes myGames from the same real fast-path IPC calls TrainerLibraryPage.tsx uses', () => {
    assert.match(HOOK_SOURCE, /api\.installDiscoveryList\(\)/);
    assert.match(HOOK_SOURCE, /api\.trainerCatalogListOwned\(\)/);
    assert.match(HOOK_SOURCE, /api\.listFavorites\(\)/);
    assert.match(HOOK_SOURCE, /buildMyGamesFastPath\(/);
  });

  test('the composer never fabricates owned: false — only true or "unknown" — and floors trainerAccuracy honestly', () => {
    assert.match(COMPOSER_SOURCE, /const owned = ownedIds\.has\(gameId\) \? true : 'unknown';/);
    // trainerAccuracy is no longer a literal ternary — it's computed via
    // computeTrainerAccuracy() from real receipt evidence (Step 5), with an
    // honest 'NONE' floor when there's no trainer at all. Assert the actual
    // current shape: hasTrainer gates NONE, and the real computeTrainerAccuracy
    // bridge is used rather than a fabricated VERSION_UNKNOWN/LOCALLY_VERIFIED shortcut.
    assert.match(COMPOSER_SOURCE, /const hasTrainer = trainerAvailability !== 'NONE';/);
    assert.match(COMPOSER_SOURCE, /if \(!hasTrainer\) return 'NONE';/);
    assert.match(COMPOSER_SOURCE, /return computeTrainerAccuracy\(\{/);
  });
});

describe('SidebarQuickAccess — conditional rendering rules', () => {
  test('Running section only renders when a real running game exists (no empty placeholder)', () => {
    assert.match(QUICK_ACCESS_SOURCE, /\{runningGame && \(/);
  });

  test('QuickAccessSection renders nothing for an empty list unless an explicit emptyHint is supplied', () => {
    assert.match(QUICK_ACCESS_SOURCE, /if \(games\.length === 0\) \{\s*if \(!emptyHint\) return null;/);
  });

  test('Favorites and My Games sections are not given an emptyHint, so they render nothing when empty', () => {
    const favoritesBlock = QUICK_ACCESS_SOURCE.match(/<QuickAccessSection\s+title="Favorites"[\s\S]*?\/>/);
    const myGamesBlock = QUICK_ACCESS_SOURCE.match(/<QuickAccessSection\s+title="My Games"[\s\S]*?\/>/);
    assert.ok(favoritesBlock, 'Favorites QuickAccessSection not found');
    assert.ok(myGamesBlock, 'My Games QuickAccessSection not found');
    assert.doesNotMatch(favoritesBlock![0], /emptyHint/);
    assert.doesNotMatch(myGamesBlock![0], /emptyHint/);
  });

  test('shelves are bounded to shelfLimit with a "View all" link shown only when the real count exceeds the bound', () => {
    assert.match(QUICK_ACCESS_SOURCE, /const visible = games\.slice\(0, limit\);/);
    assert.match(QUICK_ACCESS_SOURCE, /const hasMore = games\.length > limit;/);
    assert.match(QUICK_ACCESS_SOURCE, /View all/);
  });

  test('"View all" navigates to the real my-games View id', () => {
    assert.match(APP_SIDEBAR_SOURCE, /onViewAllGames=\{\(\) => onNavigate\('my-games'\)\}/);
    assert.ok(REAL_VIEW_IDS.has('my-games'));
  });
});

describe('App.tsx — sidebar wiring renders exactly ONE nav surface per view', () => {
  test('AppSidebar is rendered inside the single <aside className="sidebar"> nav, not as a sibling of it', () => {
    // The old bug: <AppSidebar /> rendered as an unconditional sibling
    // BEFORE <aside className="sidebar">, so both nav surfaces were always
    // on screen together. Assert that shape is gone.
    assert.doesNotMatch(APP_TSX_SOURCE, /<AppSidebar[\s\S]*?\/>\s*\n\s*<aside/);
    assert.match(APP_TSX_SOURCE, /<aside\s*\n\s*className=\{`sidebar\$\{sidebarCollapsed/);
  });

  test('AppSidebar and the legacy NAV_SECTIONS nav are mutually exclusive branches of one condition', () => {
    // Both must be gated by the exact same boolean, as if/else (ternary)
    // branches — not two independently-evaluated conditionals, which could
    // both be true (or both false) for some view and reintroduce either a
    // double-render or a no-render gap.
    assert.match(
      APP_TSX_SOURCE,
      /const isAppSidebarView = APP_SIDEBAR_VIEWS\.includes\(currentView\);/,
    );
    assert.match(
      APP_TSX_SOURCE,
      /\{isAppSidebarView \? \(\s*<AppSidebar/,
      'expected `{isAppSidebarView ? (<AppSidebar ...' ,
    );
    const trueBranch = APP_TSX_SOURCE.indexOf('{isAppSidebarView ? (');
    const legacyNavIndex = APP_TSX_SOURCE.indexOf('NAV_SECTIONS.map((section)', trueBranch);
    const elseIndex = APP_TSX_SOURCE.indexOf(') : (', trueBranch);
    assert.ok(trueBranch >= 0 && elseIndex > trueBranch && legacyNavIndex > elseIndex,
      'expected the legacy NAV_SECTIONS.map(...) render to appear in the `: (...)` else-branch of the same isAppSidebarView ternary, not elsewhere',
    );
  });

  test('APP_SIDEBAR_VIEWS partitions ALL_VIEWS: every AppSidebar view is real, and the two nav surfaces cannot both cover (or both miss) a view', () => {
    const allViewSet = new Set<string>(ALL_VIEWS as readonly string[]);
    for (const id of APP_SIDEBAR_VIEWS) {
      assert.ok(allViewSet.has(id), `${id} must be a real View id in ALL_VIEWS`);
    }
    // A plain `x.includes(currentView) ? A : B` is exhaustive and mutually
    // exclusive over EVERY possible `currentView` by construction (there is
    // no third branch, and no view can be simultaneously in and out of the
    // set) — so once the ternary shape above is confirmed, per-view
    // coverage of all 25 ALL_VIEWS entries follows automatically. This
    // test only needs to confirm the set itself is a proper, non-trivial
    // subset (not empty, not the whole list) so the ternary is meaningful.
    assert.ok(APP_SIDEBAR_VIEWS.length > 0, 'APP_SIDEBAR_VIEWS must not be empty');
    assert.ok(
      APP_SIDEBAR_VIEWS.length < ALL_VIEWS.length,
      'APP_SIDEBAR_VIEWS must not cover every view — the legacy nav must still own at least one view',
    );
  });

  test('home, my-games, and game-detail each have a switch case (no crash on navigation)', () => {
    assert.match(APP_TSX_SOURCE, /case 'home':\s*\n\s*return/);
    assert.match(APP_TSX_SOURCE, /case 'my-games':\s*\n\s*return/);
    assert.match(APP_TSX_SOURCE, /case 'game-detail':[\s\S]*?\n\s*return/);
  });
});
