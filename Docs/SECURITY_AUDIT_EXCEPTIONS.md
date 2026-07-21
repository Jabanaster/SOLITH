# Security Audit Exceptions

This file records dependency audit findings that cannot currently be resolved
with a non-breaking package-manager update.

## Accepted temporary exception: `esbuild` via `tsup`

- Advisory: `GHSA-g7r4-m6w7-qqqr`
- Severity: low
- Path: `tsup -> esbuild`
- Status: accepted temporary development-tool exception
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
