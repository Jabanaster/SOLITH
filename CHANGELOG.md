# Solith Changelog

## v2.4.0-alpha.2

- Authoritative package version for the current development line (`package.json` SoT).
- Phase 1–3 safety hardening: atomic sql.js persistence, fail-closed write policy, honest local AI probe, injector destructive-boundary controls (PID bind, expiry, replay protection, audit).
- Wisp companion foundation integrated coherently (no expanded Wisp scope in this line).
- Removed dead `better-sqlite3` dependency; shipped database remains sql.js.
- Purged remaining ResourceForge installer/branding identity from active tree and test temp prefixes.
- Enforced Node.js 22 and automated version-consistency checks.

## v2.4.0-rc.3

- Added the **AM local OCR verification fallback** for read-only live-memory research.
- OCR captures only explicitly selected application windows and user-scoped regions of interest.
- OCR values are used only as correlation tie-break evidence; they do not enable writes, freezes, or certification promotion by themselves.
- Added the **AL live correlation watcher** UI and backend lookback scoring before the OCR fallback.
- Preserved the zero-trust boundary: no cloud OCR, no automatic desktop capture, no Auto Assembler execution, and no write-capable path from the OCR panel.

## v2.4.0-rc.2

- Brought `solith-hub-backend` back into release scope.
- Cleared backend audit vulnerabilities.
- Strengthened D1 `/health` validation to return healthy only after a database round-trip.

## v2.4.0-rc.1

- Locked the zero-trust core engine, governance dashboard, and offline validation baseline.
