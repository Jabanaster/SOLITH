import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { isCommunityScanEntry, tierHint } from '../src/app/pages/trainer-library-verification-state.ts';
import { fallbackArtworkTreatment } from '../src/app/pages/trainer-card-fallback-artwork.ts';
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
  test('the tier/status row and the presence indicator are distinct card regions, not merged into one badge', () => {
    // Card redesign: stale/community/tier badges moved into a compact status
    // row in the card body; installed/running collapsed into a single cover
    // presence indicator instead of two separate absolute-positioned pills.
    assert.match(PAGE_SOURCE, /className=\{styles\.statusRow\}/);
    assert.match(PAGE_SOURCE, /!isStale && communityScan && \(/);
    assert.match(PAGE_SOURCE, /\{\(installed \|\| running\) && \(/);
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

describe('card redesign — hierarchy, fallback artwork, and compact status (round 3)', () => {
  test('primary action button appears before the More actions disclosure in source order', () => {
    const primaryIndex = PAGE_SOURCE.indexOf('styles.communityScanBtn : styles.launchBtn');
    const detailsIndex = PAGE_SOURCE.indexOf('<details className={styles.moreActions}>');
    assert.ok(primaryIndex >= 0 && detailsIndex >= 0);
    assert.ok(primaryIndex < detailsIndex, 'primary action must render before the secondary-actions disclosure');
  });

  test('contributor/verification actions (Export YAML, Publish to Hub) only appear inside the More actions disclosure, never on the default card surface', () => {
    const detailsBlockMatch = PAGE_SOURCE.match(/<details className=\{styles\.moreActions\}>[\s\S]*?<\/details>/);
    assert.ok(detailsBlockMatch);
    const outsideDetails = PAGE_SOURCE.replace(detailsBlockMatch![0], '');
    assert.ok(!outsideDetails.includes('Export YAML'));
    assert.ok(!outsideDetails.includes('Publish to Hub'));
    assert.ok(!outsideDetails.includes('Confirm works'));
    assert.ok(!outsideDetails.includes('Request verification'));
  });

  test('internal schema/capability jargon (schema.v1, capBadge, "Injection pilot") no longer renders on the default card surface', () => {
    assert.ok(!PAGE_SOURCE.includes('schema.v1 definition'));
    assert.ok(!PAGE_SOURCE.includes('capabilityRow'));
    assert.ok(!PAGE_SOURCE.includes('Injection pilot'));
  });

  test('title and supporting line use single-line clamp classes, not free-flowing paragraphs', () => {
    assert.match(PAGE_SOURCE, /className=\{styles\.title\}/);
    assert.match(PAGE_SOURCE, /className=\{styles\.supportingLine\}/);
    const cssSource = fs.readFileSync(path.join(ROOT, 'src/app/pages/TrainerLibraryPage.module.css'), 'utf8');
    assert.match(cssSource, /\.title\s*\{[^}]*-webkit-line-clamp:\s*1/s);
    assert.match(cssSource, /\.supportingLine\s*\{[^}]*-webkit-line-clamp:\s*1/s);
  });

  test('the full display name remains available via a title attribute even when the heading is clamped', () => {
    assert.match(PAGE_SOURCE, /<h2 className=\{styles\.title\} title=\{entry\.displayName\}>/);
  });

  test('the stale/quarantine badge stays visually louder than the community-scan badge in CSS (real failure > expected incomplete state)', () => {
    const cssSource = fs.readFileSync(path.join(ROOT, 'src/app/pages/TrainerLibraryPage.module.css'), 'utf8');
    const staleBlock = cssSource.match(/\.staleBadge\s*\{[^}]*\}/s)![0];
    const communityBlock = cssSource.match(/(?<!\.tier)\.communityBadge\s*\{[^}]*\}/s)![0];
    assert.match(staleBlock, /font-weight:\s*700/);
    assert.doesNotMatch(communityBlock, /font-weight:\s*700/);
  });

  test('presence indicator (installed/running) is a single cover badge with real text, not color-only meaning', () => {
    assert.match(PAGE_SOURCE, /className=\{styles\.presenceBadge\}/);
    assert.match(PAGE_SOURCE, /installed && running \? 'Installed · Running' : running \? 'Running' : 'Installed'/);
  });
});

describe('round 4 — truthful labeling for generic/templated remote-sync entries', () => {
  test('the card computes isGeneric via the conservative detector, not an inline heuristic', () => {
    assert.match(PAGE_SOURCE, /import \{ isGenericTemplateEntry \} from '\.\/trainer-catalog-generic-detection\.js';/);
    assert.match(PAGE_SOURCE, /const isGeneric = isGenericTemplateEntry\(entry\);/);
  });

  test('generic entries render a truthful "incomplete/community-sourced" supporting line instead of fabricated categories/cheat-count text', () => {
    assert.match(PAGE_SOURCE, /'Community-sourced · details incomplete'/);
  });

  test('curated entries (isGeneric === false) keep the original categories/cheat-count supporting line untouched', () => {
    assert.match(
      PAGE_SOURCE,
      /const supportingLine = isGeneric\s*\n\s*\? 'Community-sourced · details incomplete'\s*\n\s*: \[/,
    );
  });
});

describe('round 4 — default ordering uses the pure orderCatalogDefault helper', () => {
  test('the page imports and calls orderCatalogDefault for the default sort mode, not an inline installed+alpha comparator', () => {
    assert.match(PAGE_SOURCE, /import \{ orderCatalogDefault \} from '\.\/trainer-catalog-default-order\.js';/);
    assert.match(PAGE_SOURCE, /orderCatalogDefault\(filteredEntries, installedIds\)/);
  });

  test('explicit A-Z mode stays a separate, untouched pure alphabetical branch', () => {
    assert.match(
      PAGE_SOURCE,
      /sortMode === 'a-z'\s*\n\s*\? filteredEntries\.slice\(\)\.sort\(\(a, b\) => a\.displayName\.localeCompare\(b\.displayName\)\)/,
    );
  });

  test('filters run before ordering — filteredEntries is computed once and shared by both branches', () => {
    assert.match(PAGE_SOURCE, /const filteredEntries = entries\.filter\(/);
  });
});

describe('fallbackArtworkTreatment — deterministic per-title fallback (no guessed/remote artwork)', () => {
  test('same title always produces the same treatment', () => {
    const a = fallbackArtworkTreatment('Elden Ring');
    const b = fallbackArtworkTreatment('Elden Ring');
    assert.deepEqual(a, b);
  });

  test('different titles usually produce different hues', () => {
    const a = fallbackArtworkTreatment('Elden Ring');
    const b = fallbackArtworkTreatment('Stardew Valley');
    assert.notEqual(a.hueA, b.hueA);
  });

  test('initial is the uppercased first character of the title', () => {
    assert.equal(fallbackArtworkTreatment('palworld').initial, 'P');
    assert.equal(fallbackArtworkTreatment('7 Days to Die').initial, '7');
  });

  test('skips leading bracket/paren/punctuation wrappers to find a real letter or digit', () => {
    // Real catalog titles like "[NINJA GAIDEN - Master Collection]" or
    // "(the) Gnorp Apologue" would otherwise render a near-blank "[" or "("
    // as the fallback initial instead of a readable letter.
    assert.equal(fallbackArtworkTreatment('[NINJA GAIDEN - Master Collection]').initial, 'N');
    assert.equal(fallbackArtworkTreatment('(the) Gnorp Apologue').initial, 'T');
    assert.equal(fallbackArtworkTreatment('.hack G.U. Last Recode').initial, 'H');
  });

  test('empty or whitespace-only title falls back to a safe placeholder initial, not a crash', () => {
    assert.equal(fallbackArtworkTreatment('   ').initial, '?');
    assert.equal(fallbackArtworkTreatment('').initial, '?');
  });

  test('hues stay within a valid 0-359 range', () => {
    const treatment = fallbackArtworkTreatment('Some Game Title');
    assert.ok(treatment.hueA >= 0 && treatment.hueA < 360);
    assert.ok(treatment.hueB >= 0 && treatment.hueB < 360);
  });

  test('Unicode and surrogate-pair titles resolve safely without crashing', () => {
    // codePointAt/fromCodePoint (not charAt/[0]) handles astral-plane
    // characters like emoji as one glyph instead of splitting a surrogate
    // pair and rendering a broken half-character.
    assert.doesNotThrow(() => fallbackArtworkTreatment('日本語のゲーム'));
    assert.doesNotThrow(() => fallbackArtworkTreatment('🎮 Game Title'));
    assert.doesNotThrow(() => fallbackArtworkTreatment('Übercharge'));
    const jp = fallbackArtworkTreatment('日本語のゲーム');
    assert.equal(jp.initial, '日');
    // Emoji is a decorative Symbol, not a Letter/Number, so the same
    // "skip to the first real letter/digit" rule that handles bracket
    // prefixes applies here too — lands on 'G' from "Game", not a
    // half-rendered surrogate pair.
    const emoji = fallbackArtworkTreatment('🎮 Game Title');
    assert.equal(emoji.initial, 'G');
  });

  test('a title with no letters/digits at all (e.g. pure emoji) still resolves one whole glyph, not a broken surrogate half', () => {
    const treatment = fallbackArtworkTreatment('🎮🕹️');
    assert.doesNotThrow(() => fallbackArtworkTreatment('🎮🕹️'));
    assert.equal(treatment.initial, '🎮'.toUpperCase());
  });
});
