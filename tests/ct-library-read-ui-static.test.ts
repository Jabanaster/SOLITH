import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

/**
 * Mission 16 — static structural verification of the Trainer Deck read UI,
 * matching this repo's existing convention (see trainer-library-card-states
 * .test.ts) of inspecting page source directly rather than rendering React
 * components (no React Testing Library in this project). No game launch, no
 * IPC call — this only proves the required UI states exist in the source
 * and are wired to the right conditions.
 */
const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const PAGE_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app/pages/CtLibraryExplorerPage.tsx'), 'utf8');

describe('CT Library Explorer — Trainer Deck read UI (static source verification)', () => {
  test('Read value button exists', () => {
    assert.match(PAGE_SOURCE, /Read value/);
  });

  test('all required read states are represented', () => {
    assert.match(PAGE_SOURCE, /'not_attached'/);
    assert.match(PAGE_SOURCE, /'reading'/);
    assert.match(PAGE_SOURCE, /'value'/);
    assert.match(PAGE_SOURCE, /'blocked'/);
    assert.match(PAGE_SOURCE, /'failed'/);
  });

  test('reading state disables the button (no double-submit)', () => {
    assert.match(PAGE_SOURCE, /disabled=\{readValueState\.status === 'reading'\}/);
  });

  test('technical details (library entry id / resolved address) are behind a <details> element', () => {
    const detailsBlockMatch = PAGE_SOURCE.match(/<details[^>]*>[\s\S]*?Library entry id[\s\S]*?<\/details>/);
    assert.ok(detailsBlockMatch, 'expected a <details> block containing the technical library-entry-id readout');
  });

  test('the read panel only renders for eligible (promoted) entries, not for every pointer', () => {
    assert.match(PAGE_SOURCE, /\{promotion\?\.eligible && \(\s*<div className=\{styles\.readValuePanel\}/);
  });

  test('block reasons are translated to plain language, not raw IPC codes, by default', () => {
    assert.match(PAGE_SOURCE, /function describeBlockReason/);
    assert.match(PAGE_SOURCE, /wrong_game_session/);
  });

  test('unsupported (non-pointer or non-resolvable) entries never render the read panel', () => {
    // The read panel is gated on `result.type === 'pointer' && eligibility`,
    // and `eligibility` comes from evaluateCtLibraryEntryForPromotion, which
    // fails closed for script/aob/incomplete/absolute_only kinds (see
    // promote-bridge.test.ts) — so this is a structural guarantee, not a
    // per-case UI check.
    assert.match(PAGE_SOURCE, /result\.type === 'pointer' && eligibility/);
  });

  test('no raw stack trace is surfaced by default (failed state shows error.message only)', () => {
    assert.match(PAGE_SOURCE, /error instanceof Error \? error\.message : String\(error\)/);
  });

  test('does not import or reference any write/freeze primitive', () => {
    assert.doesNotMatch(PAGE_SOURCE, /writeMemory|freezeStart|liveMemoryFreeze|liveMemoryProposeWrite/);
  });
});
