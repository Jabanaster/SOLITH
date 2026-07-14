import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings } from '../src/core/settings/index.ts';
import { initDatabase } from '../src/core/database/index.ts';

describe('settings onboarding in test env', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSkip = process.env.SOLITH_SKIP_ONBOARDING;

  before(async () => {
    await initDatabase();
  });

  after(() => {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevSkip === undefined) delete process.env.SOLITH_SKIP_ONBOARDING;
    else process.env.SOLITH_SKIP_ONBOARDING = prevSkip;
  });

  test('NODE_ENV=test forces onboardingCompleted true', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SOLITH_SKIP_ONBOARDING;
    const settings = getSettings();
    assert.equal(settings.onboardingCompleted, true);
  });

  test('SOLITH_SKIP_ONBOARDING=1 forces onboardingCompleted true', () => {
    process.env.NODE_ENV = 'development';
    process.env.SOLITH_SKIP_ONBOARDING = '1';
    const settings = getSettings();
    assert.equal(settings.onboardingCompleted, true);
  });
});
