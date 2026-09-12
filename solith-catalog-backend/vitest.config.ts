import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

/**
 * Runs `test/*.test.ts` INSIDE the real workerd runtime (via miniflare),
 * bound to a real local D1 database that gets `migrations/*.sql` applied
 * fresh for every test run (see test/apply-migrations.ts) — this is the
 * genuine "real Workers runtime + real local D1, not a mock" setup the
 * owner's Phase 2 brief asked for. `app.request(...)` in test/api.test.ts
 * calls straight into the actual Hono app running inside that real
 * runtime; there is no FakeD1 anywhere in this package's own test suite
 * (unlike solith-hub-backend/test/api.test.ts, which mocks D1 with a
 * hand-rolled FakeD1 class — a deliberate difference, not an oversight:
 * this phase's whole point is proving the real runtime, not just route
 * logic).
 *
 * API note: `@cloudflare/vitest-pool-workers` 0.19+ (paired with vitest 4)
 * replaced the older `defineWorkersConfig`/`poolOptions.workers` shape with
 * a `cloudflareTest(...)` Vite plugin passed to plain `defineConfig`. This
 * file uses that current API directly rather than the deprecated one.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // TEST-ONLY fixture secret (Mission 15) — never a real credential,
          // never committed as a production value. Real deployments set
          // INGEST_TOKEN via `wrangler secret put`, never wrangler.jsonc vars.
          bindings: { TEST_MIGRATIONS: migrations, INGEST_TOKEN: 'test-fixture-ingest-token-do-not-use-in-prod' },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
