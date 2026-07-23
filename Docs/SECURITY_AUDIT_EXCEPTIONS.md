# Security Audit Exceptions

This file records dependency audit findings that cannot currently be resolved
with a non-breaking package-manager update.

## Historical note: `esbuild` via `tsup`

- Advisory: `GHSA-g7r4-m6w7-qqqr`
- Severity: low
- Path: `tsup -> esbuild`
- Status: resolved in the desktop root package as of the 2.4.0-alpha.2 line
- Date recorded: 2026-07-20

`npm audit fix` has already been applied. The remaining finding is nested under
`tsup`, and `tsup` is already pinned to the latest published version available
to this project (`8.5.1`).

The advisory affects the esbuild development server on Windows. Solith does not
ship or expose the esbuild development server in packaged releases; it is used
only as part of local development/build tooling.

Required follow-up:

- Re-run `npm audit --audit-level=low` before every release.
- Remove this exception once `tsup` publishes a dependency chain that resolves
  the advisory.
- Do not use `npm audit --force` to satisfy this exception unless a maintainer
  explicitly accepts the resulting breaking changes.

## Release exclusion: `solith-hub-backend` Cloudflare tooling

- Package scope: `solith-hub-backend`
- Affected tools: `wrangler -> miniflare -> sharp`
- Severity currently reported by npm: high
- Status: excluded from the desktop packaged release gate
- Date recorded: 2026-07-22

The Solith desktop application does not package or execute the
`solith-hub-backend` Cloudflare Worker tooling. The hub is a separate service
track with its own `package.json`, `package-lock.json`, deployment flow, and D1
database binding.

`wrangler@4.113.0` and current Workers types were tested, but npm still reports
the inherited `sharp`/`libvips` advisory through Miniflare. Downgrading to npm's
suggested `wrangler@4.15.2` also introduces older Wrangler/Undici/ws advisories,
so forcing the downgrade is not an acceptable release fix.

Desktop release gates therefore require:

- root `npm audit` to pass;
- root build/test/smoke gates to pass;
- hub backend to remain excluded from desktop distribution artifacts;
- hub deployment to remain blocked until `solith-hub-backend/npm audit` is
  clean or a separately reviewed service exception is approved.
