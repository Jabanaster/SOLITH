import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      /** Test-only binding injected by vitest.config.ts via readD1Migrations — never present in the real deployed Worker. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }

  interface Env extends Cloudflare.Env {}
}

export {};
