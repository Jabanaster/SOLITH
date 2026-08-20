/**
 * ROADMAP §6.6 Demo/onboarding. The bundled demo profile
 * (DEMO_PREVIEW_PROFILE, src/core/game-profiles/catalog.ts) is intentionally
 * read-only — no write, backup, or rollback path is defined for it. These
 * tests verify the onboarding copy states that truthfully (no fake
 * completion state) and that "reset demo / replay onboarding" is a real,
 * working action rather than a decorative button.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BUNDLED_GAME_PROFILE_CATALOG } from '../src/core/game-profiles/catalog.ts';

test('the bundled demo profile really is read-only (no write/backup/rollback path)', () => {
  const demoEntry = BUNDLED_GAME_PROFILE_CATALOG.find((e) => e.catalogId === 'demo-rpg-preview');
  assert.ok(demoEntry, 'demo-rpg-preview catalog entry must exist');
  assert.equal(demoEntry!.writeSupportStatus, 'blocked');
  assert.ok(demoEntry!.unsupportedReasons.includes('no-backup-strategy'));
  assert.ok(demoEntry!.unsupportedReasons.includes('no-rollback-proof'));
  assert.ok(demoEntry!.profile.controls.every((c) => c.backend === 'unsupported' && c.safetyStatus === 'disabled'));
});

test('onboarding copy does not claim the demo fixture can write, back up, or roll back', () => {
  const source = readFileSync(new URL('../src/app/components/OnboardingWizard.tsx', import.meta.url), 'utf8');
  assert.match(source, /read-only/i);
  assert.match(source, /no write,\s+backup,\s+or\s+rollback\s+path/i);
});

test('Settings → Advanced exposes a real, working "reset demo / replay onboarding" action', () => {
  const source = readFileSync(
    new URL('../src/app/pages/settings/sections/AdvancedSection.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /reset demo \/ replay onboarding/i);
  // The action must actually clear the persisted flag through the real IPC
  // surface — not just be UI copy with no behavior behind it.
  assert.match(source, /setSetting\??\.\(['"]onboardingCompleted['"],\s*false\)/);
});
