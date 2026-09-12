# shared/ — manually-synced duplication, not an accident

`normalize-title.ts`, `edition-registry.ts`, `cross-provider-match.ts`, and
`provider-types.ts` are duplicates of the equivalent files in the main repo
(`src/core/trainer-catalog/normalize-title.ts`,
`src/core/canonical-games/{edition-registry,cross-provider-match}.ts`,
`src/core/provider-catalog/types.ts`).

This backend is a separate Cloudflare Worker package (own `package.json`,
own `tsconfig.json`, own `wrangler` build) — not part of a monorepo with
shared TS project references. Rather than fight the bundler to resolve a
cross-package relative import (`../../../src/core/...`), which would tie
this Worker's build to the main Electron app's directory layout and risk
pulling in Node-only dependencies the Workers runtime doesn't have, these
few files are small, pure (no Node built-ins beyond what Workers already
polyfills), and are duplicated deliberately.

**Keep these in sync manually.** If the main repo's matching logic or
security fixes change, port the change here too — this is the ONLY reason
Phase 3.2's ingest pipeline can enforce the exact same "never auto-merge on
metadata alone" rule the main repo enforces client-side.
