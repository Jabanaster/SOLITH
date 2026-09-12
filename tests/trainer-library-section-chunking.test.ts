import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INITIAL_SECTION_VISIBLE_COUNT,
  SECTION_VISIBLE_STEP,
  clampSectionVisibleCount,
  nextSectionVisibleCount,
  remainingAfterVisible,
} from '../src/app/pages/trainer-library-section-chunking.ts';

/**
 * Personal Library Completion — Final Closure Pass, Mission 5.
 *
 * REVERSAL NOTICE (2026-09-10, Mission 5 REVERSAL): the chunked "Show N
 * more" rendering these tests exercise has been REJECTED by the owner and
 * REPLACED in TrainerLibraryPage.tsx by real virtualization
 * (SectionVirtualGrid) — see trainer-library-section-chunking.ts's own
 * updated header comment and tests/trainer-library-virtualization-
 * coverage.test.ts for the current render-site proof. These tests are kept
 * as pure-logic coverage of this now-unused module's own bounded-growth
 * arithmetic; they no longer say anything about how the page actually
 * renders "All Other Games".
 */

test('a huge section (thousands of games) never exceeds the initial visible count until "Show more" is clicked', () => {
  const totalGames = 6800;
  const visible = clampSectionVisibleCount(totalGames, INITIAL_SECTION_VISIBLE_COUNT);
  assert.equal(visible, INITIAL_SECTION_VISIBLE_COUNT);
  assert.ok(visible < totalGames, 'the visible count must stay far below the real section size');
});

test('a small section (fewer games than the initial chunk) never claims a visible count larger than it actually has', () => {
  assert.equal(clampSectionVisibleCount(12, INITIAL_SECTION_VISIBLE_COUNT), 12);
  assert.equal(clampSectionVisibleCount(0, INITIAL_SECTION_VISIBLE_COUNT), 0);
});

test('clampSectionVisibleCount never goes negative even with a bogus negative request', () => {
  assert.equal(clampSectionVisibleCount(100, -5), 0);
});

test('"Show more" grows the visible count by exactly one step, repeatedly, until the whole (huge) section is exhausted', () => {
  const totalGames = 6800;
  let visible = clampSectionVisibleCount(totalGames, INITIAL_SECTION_VISIBLE_COUNT);
  let clicks = 0;
  const seenCounts: number[] = [visible];
  while (visible < totalGames) {
    visible = nextSectionVisibleCount(totalGames, visible);
    seenCounts.push(visible);
    clicks += 1;
    assert.ok(visible <= totalGames, 'visible count must never exceed the real section size');
    if (clicks > 1000) throw new Error('runaway loop — nextSectionVisibleCount is not converging');
  }
  assert.equal(visible, totalGames);
  // Every step except possibly the last grows by exactly SECTION_VISIBLE_STEP.
  for (let i = 1; i < seenCounts.length - 1; i++) {
    assert.equal(seenCounts[i] - seenCounts[i - 1], SECTION_VISIBLE_STEP);
  }
  // Expected number of clicks to exhaust a 6800-game section from the initial chunk.
  const expectedClicks = Math.ceil((totalGames - INITIAL_SECTION_VISIBLE_COUNT) / SECTION_VISIBLE_STEP);
  assert.equal(clicks, expectedClicks);
});

test('remainingAfterVisible reports exactly how many more games are left, never negative', () => {
  assert.equal(remainingAfterVisible(6800, 150), 6650);
  assert.equal(remainingAfterVisible(150, 150), 0);
  assert.equal(remainingAfterVisible(100, 150), 0);
});

test('a previously-grown visible count survives a shrinking data set (e.g. after a search) without ever slicing past the end', () => {
  // User expanded to 450/6800, then searched and the section shrank to 40 matches.
  const shrunkTotal = 40;
  const priorRequestedCount = 450;
  const visible = clampSectionVisibleCount(shrunkTotal, priorRequestedCount);
  assert.equal(visible, 40);
});
