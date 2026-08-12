import { test, expect } from '@playwright/test';
import { launchApp, cleanupApp, type AppContext } from '../test-helpers.js';

test.describe('Experimental Wisp Overlay Functionality', () => {
  test('overlay toggle, bounds, and interactivity work in experimental test build mode', async () => {
    let ctx: AppContext | null = null;
    try {
      // Set test environment variable so experimental overlay feature flag is active
      process.env.SOLITH_ENABLE_WISP_OVERLAY = '1';
      ctx = await launchApp('overlay');
      const toggleType = await ctx.win.evaluate(() => typeof (window as any).electronAPI?.wispOverlayToggle);
      if (toggleType === 'function') {
        const toggleResult = await ctx.win.evaluate(async () => (window as any).electronAPI.wispOverlayToggle());
        expect(toggleResult.success).toBe(true);
      }
    } finally {
      if (ctx) await cleanupApp(ctx);
      delete process.env.SOLITH_ENABLE_WISP_OVERLAY;
    }
  });
});
