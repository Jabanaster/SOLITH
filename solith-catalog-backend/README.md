# solith-catalog-backend

Phase 2 Part B — a **read-only** Cloudflare Worker (Hono + D1) serving:

- `GET /health` — status/version check.
- `GET /catalog/sync?since=<revision>` — a `SyncManifestDelta`-shaped JSON
  delta (discovery-catalog entries + trainer-coverage rows + deleted ids)
  matching `src/core/sync-manifest/types.ts` in the main SOLITH repo exactly.
- `GET /artifacts/:hash` — raw trainer-artifact bytes by exact 64-hex SHA-256.

**There is no write/upload endpoint of any kind.** Community uploads stay
entirely local-only (see the main repo's `src/core/community-upload/`); this
backend never wires them to a network endpoint.

## Deployment status — READ THIS BEFORE TOUCHING `wrangler deploy`

This Worker has **never been deployed** and this task **does not deploy it**.
There is no real Cloudflare account, zone, or `account_id` configured
anywhere in this repository for it. `wrangler.jsonc` sets `workers_dev:
false` and the `database_id` in it is a locally-generated placeholder UUID —
it has never been through `wrangler d1 create` against a real account and
does not need to be for local dev (`wrangler dev --local` / `wrangler d1
migrations apply --local` only use it to key an on-disk SQLite file).
`npm run deploy` is wired to fail loudly rather than silently attempt
anything. Deploying this for real (creating a real D1 database, setting a
real `account_id`, running `wrangler deploy`) is an **owner-only step**.

## Why a sibling Worker instead of new routes on solith-hub-backend

`solith-hub-backend` already owns the path `/catalog/sync`, but for a
completely different feature — Community Definition Hub submissions
(untrusted `L0_Community`/`L3_Certified` rows accepted via `POST /submit`)
with an incompatible response shape (`{definitions, count, next_since,
has_more}`). This backend's `/catalog/sync` means something else entirely: a
curated, read-only discovery-catalog + trainer-coverage delta. Reusing the
same Worker/route would collide or force one path to serve two incompatible
contracts depending on undocumented context. A separate Worker (separate D1
database, separate binding, separate deploy target) keeps the two trust
models and two response contracts independent — least-privilege applies to
services, not just individual bindings.

## Local development

```bash
npm install
npm run db:migrate:local   # wrangler d1 migrations apply solith-catalog-db --local
npm run dev                # wrangler dev --local
```

`wrangler dev --local` starts a real local Workers runtime (workerd) with a
real local D1 database. It requires **no Cloudflare account login** — this
was verified directly: starting it prints `Ready on http://127.0.0.1:<port>`
immediately, with zero OAuth/login prompts, because `--local` never talks to
any Cloudflare API.

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run — real Workers runtime + real local D1
                     # via @cloudflare/vitest-pool-workers (no FakeD1)
```

`test/api.test.ts` runs INSIDE workerd via miniflare, against a real local
D1 database that gets `migrations/*.sql` applied fresh via
`test/apply-migrations.ts` before each run. There is no mock D1 anywhere in
this package's own test suite.

See `../tests/real-backend-e2e.test.ts` in the main repo for the full
client+server real-network E2E certification (spawns `wrangler dev --local`
as a child process and drives it with the real main-repo client modules).

## Security-requirements checklist

See the top-level task report for the line-by-line checklist against the
owner's "BACKEND SECURITY REQUIREMENTS" list. Summary: immutable
hash-only artifact addressing, server-side SHA-256 re-verification on every
read, a 256 MiB artifact size cap matching the client's existing cap,
zod-validated query params (bounded length, strict regex, 400 not 500 on bad
input), explicit `Content-Type` on every response, `no-store` on
catalog/manifest responses vs `public, max-age=31536000, immutable` on
artifact responses, no `fetch()` calls anywhere in this service (grep
`src/index.ts`), no filesystem access (Workers have none), structured
JSON logs with no credentials/secrets/PII, no secret bindings at all (there
is nothing to leak), and a single least-privilege D1 binding scoped to only
this service's four tables.
