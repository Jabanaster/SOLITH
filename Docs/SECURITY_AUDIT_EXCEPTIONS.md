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
`tsup` has been resolved in the active release line.

The advisory affects the esbuild development server on Windows. Solith does not
ship or expose the esbuild development server in packaged releases; it is used
only as part of local development/build tooling.

Required follow-up:

- Re-run `npm audit --audit-level=low` before every release.
- Remove this exception once `tsup` publishes a dependency chain that resolves
  the advisory.
- Do not use `npm audit --force` to satisfy this exception unless a maintainer
  explicitly accepts the resulting breaking changes.

## Historical note: `solith-hub-backend` Cloudflare tooling

- Package scope: `solith-hub-backend`
- Affected tools: `wrangler -> miniflare -> sharp`
- Prior severity reported by npm: high
- Status: resolved as of the 2.4.0-rc.1 follow-up line
- Date recorded: 2026-07-22
- Date resolved: 2026-07-22

The hub backend previously remained outside the desktop release gate while npm
reported the inherited `sharp`/`libvips` advisory through Miniflare.

Resolution:

- `wrangler` remains on the current 4.x line.
- `miniflare` is explicit in the hub backend dev dependency graph.
- `sharp` is overridden under Miniflare to `0.35.3`, which clears the inherited
  libvips advisory without downgrading Wrangler to an older vulnerable chain.
- `solith-hub-backend npm ci`, `npm audit`, `npm run typecheck`, and `npm test`
  all pass.

Required follow-up:

- Re-run hub `npm audit` before every hub deployment.
- Remove or revise this historical note if Miniflare removes the need for the
  scoped Sharp override.
