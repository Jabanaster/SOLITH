import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  // Explicit file passed on CLI — this config just sets shared options
  timeout: 120_000,       // full workflow can take ~60s per run
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: false,      // Electron E2E cannot run fully headless
  },
  workers: 1,             // runs must be sequential — one Electron at a time
  retries: 0,             // gate tests must pass clean on first attempt
});
