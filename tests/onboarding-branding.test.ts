import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('every onboarding step uses the canonical Solith icon', () => {
  const source = readFileSync(
    new URL('../src/app/components/OnboardingWizard.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /src="\.\/solith-icon\.png"/);
  assert.doesNotMatch(source, /BrandingArtwork|trainerController/);
  assert.equal(source.match(/<div className=\{styles\.art\}>/g)?.length, 1);
  assert.match(source, /const STEPS: OnboardingStep\[\] = \['welcome', 'library', 'saves', 'advanced', 'done'\]/);
});
