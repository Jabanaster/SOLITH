import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'electron.smoke.test.ts',
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: false, // Electron tests cannot run fully headless
  },
  // Only one worker for Electron tests — they share a single app instance
  workers: 1,
  retries: 0,
});
