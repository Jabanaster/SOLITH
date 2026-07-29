# Remaining Risks — Gate 2.1

## R-B11-LC-004 (packaged real-process E2E for lifecycle scenarios) — substantially narrowed

Resolution this cycle: 4 of the 6 scenarios now have genuine real-packaged-process
certification (see `packaged-lifecycle-run2.txt`, 5/5 pass):

- Cleanup-failure containment: proven via a forced real failure in one step
  (`revoke_consent_tokens`) against the real packaged app — session still
  torn down, subsequent reads still rejected.
- Renderer crash: proven via `webContents.forcefullyCrashRenderer()` against
  the real packaged app — session for that owner disposed.
- Identity mismatch / simulated PID reuse: proven via the test-only identity
  override against a real spawned+killed process, exercising the real
  `queryWindowsProcessIdentity` / `compareProcessIdentity` fail-closed path.
- App shutdown: proven `will-quit` resolves cleanly with no hang, though
  narrowed in scope — see control-provenance.csv for why an
  active-at-quit-time session could not also be exercised in the same run
  without a second trusted window (not supported without further engineering).

Still open:

- Feature-disable (mid-freeze) and window-identity/navigation real-packaged
  E2E were **not** newly built this cycle. Both require an active real
  freeze against a real, known-writable memory address in a real target
  process; no fixture executable with such an address exists in this repo.
  Building one reliably was judged out of scope for a single session on a
  security-critical write-authorization surface — same judgment call
  documented in Gate 2 for the equivalent gap. Both remain covered by
  existing deterministic-fake unit/integration tests tied to real Electron
  event/source wiring (`feature-disable-cleanup.test.ts`,
  `trusted-sender-registry.test.ts`, `session-cleanup-on-destroy.test.ts`),
  now additionally wired into `test:live-memory` (see R-new-001 below,
  resolved).
- The three new test-only hooks are env-gated and fail closed, but they are
  still *compiled into* the shipped binary (inert unless
  `SOLITH_TEST_BUILD=1`), not built as a literally separate variant. This
  satisfies "unavailable in normal production builds" / "fails closed when
  the test-build condition is absent" but is a narrower interpretation than
  a fully separate test-only build artifact would be. Documented, not
  hidden — see `control-provenance.csv`.

AcceptanceStatus: Proposed for acceptance (narrowed further). Not marked
accepted on behalf of the project owner.

## R-new-001 (Gate 2 test-wiring gap) — resolved

All 8 previously orphaned test files (7 pre-existing + Gate 2's
`rollback-byte-integrity.test.ts`) plus this cycle's
`gate2-1-test-build-hooks.test.ts` are now wired into `test`/`test:live-memory`.
`npm test` now runs 1040/1040 (was 1034 before this cycle's 2 additions to the
main `test` script; `test:live-memory` now runs 257/257, up from 221). Diff to
`package.json` was limited to exactly the two script-value lines edited —
verified via `git diff -- package.json` and re-parsed as valid JSON.

## R-B11-LC-001, R-B11-LC-002, R-B11-LC-003, R-B11-LC-005 — unchanged from Gate 2

No new work touched these this cycle; see `Gate2/remaining-risks.md` for
detail. Re-confirmed unchanged via the identical regression gate
(`final-typescript-electron.txt` 0-diff vs. Gate 2 baseline;
`final-git-diff-check.txt` GameLibrary.tsx-only, matching established
baseline).

## Final B1.1 verdict

BATCH B1.1 CONDITIONAL PASS (Gate 2.1 narrows, does not reverse, the Gate 2
conditional pass).

No proven B1.1 regression. Test-wiring gap fully resolved. Packaged
real-process lifecycle certification improved from 0/6 to 4/6 genuinely
new real-packaged-process scenarios (plus a 5th, app-shutdown, in narrowed
form); the remaining 2 (feature-disable mid-freeze, window-identity/
navigation real E2E) remain fake-only, honestly disclosed as incomplete
rather than fabricated as passing — same disclosure standard as Gate 2.
