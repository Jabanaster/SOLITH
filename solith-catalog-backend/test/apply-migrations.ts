import { applyD1Migrations, env } from 'cloudflare:test';

// Applies migrations/0001_init_schema.sql + 0002_seed_fixtures.sql to a
// FRESH real local D1 database (created by miniflare for this test run)
// before any test file runs. This is real SQLite-backed D1 under workerd,
// not an in-memory mock.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
