# Remaining Risks — Gate 2

## R-B11-LC-001 (raw-byte rollback equality) — narrowed, not closed

Resolution this cycle: raw-byte rollback equality was found narrowly
feasible and implemented additively (see `rollback-byte-feasibility.md`).
19 new tests pass. This closes the *specific* documented gap ("distinct NaN
payloads cannot be distinguished") for the types where it mattered.

Still open:
- Best-effort capture means a small number of instant-of-operation failures
  (e.g. a page becoming unreadable at exactly propose/confirm time) still
  fall back to the pre-existing numeric-only safety net for that one entry —
  a deliberate, disclosed fallback, not a new gap.
- `int64`/`uint64` full 64-bit range decode via `MemoryDriver.readMemory`
  is unchanged (still typed `number` end-to-end); the byte-level check does
  not depend on that decode path, so it is unaffected but the underlying
  limitation is not newly resolved.

AcceptanceStatus: Proposed for acceptance (narrowed). Not marked accepted on
behalf of the project owner.

## R-B11-LC-002 (Node runtime mismatch) — resolved

The exact Node 22.23.1 runtime used by the original passing Gate 1 evidence
was located (`.tools/node-v22.23.1-win-x64`, gitignored, repository-local)
and used directly for every command in this Gate 2 cycle. See
`Docs/Security/Evidence/BatchB1_1_Closeout/Node22GateStableRerun2/`.

## R-B11-LC-003 (unrelated Electron TypeScript baseline) — unchanged, out of scope

31 diagnostics / 13 files, line-for-line identical to the previously
recorded baseline. Explicitly out of scope for Gate 2 ("Do not perform
Electron TypeScript baseline cleanup").

## R-B11-LC-004 (platform-specific lifecycle tests use isolated fakes) — re-confirmed, not newly closed

This cycle additionally verified:
- The full packaged Windows build (electron-builder + native `memoryjs`
  rebuild for the Electron ABI) succeeds cleanly with the Gate 2
  `writeBuffer` changes compiled in.
- The packaged app boots and passes all 23 existing
  `tests/packaged-smoke.test.ts` runtime points against the real
  `dist/win-unpacked/Solith.exe`.
- All 6 required lifecycle scenarios (renderer crash, shutdown, feature
  disable, window identity, PID reuse, cleanup-failure containment) remain
  covered only by deterministic-fake unit/integration tests tied to real
  Electron event/source wiring — re-run and confirmed passing this cycle,
  but no new bespoke real-packaged-process E2E harness was built for any of
  them. Building one reliably (real live-memory attach to a spawned safe
  test process, exact-timing renderer crash injection, real process
  kill/respawn for PID-reuse) is a substantial new engineering effort;
  attempting to rush it in this session risked shipping unreliable test
  infrastructure for a security-critical write-authorization surface.

AcceptanceStatus: Proposed for acceptance (unchanged scope, re-verified).
FollowUp unchanged: add packaged Electron crash/shutdown/PID-reuse
certification on Windows, as a dedicated future workstream.

## R-B11-LC-005 (dirty-tree diff-check whitespace) — unchanged, out of scope

GameLibrary.tsx trailing whitespace, unchanged, out of scope for Gate 2.

## New finding this cycle: test-wiring gap (process integrity, not functional)

7 pre-existing test files — `tests/live-memory/app-shutdown-cleanup.test.ts`,
`tests/live-memory/cleanup-failure-handling.test.ts`,
`tests/live-memory/feature-disable-cleanup.test.ts`,
`tests/live-memory/renderer-crash-cleanup.test.ts`,
`tests/live-memory/rollback-float-integrity.test.ts`,
`tests/ct-preview-receipt.test.ts`, `tests/wisp-preferences.test.ts` — are
not referenced by any `npm test`/`npm run test:*` script and have therefore
never executed as part of any Node22Gate rerun in this entire audit chain,
including the ones this session previously certified as
"npm test: PASS — 1,034/1,034." All 7 were run directly this cycle and pass
cleanly (20/20), so there is no evidence of a functional regression — but
the "1,034/1,034" figure never included them, and should not be read as
"every relevant test file passed," only as "every test file wired into
package.json's scripts passed." The new `rollback-byte-integrity.test.ts`
(19/19, this cycle) is in the same situation.

Wiring these 8 files into `package.json`'s `test`/`test:live-memory` scripts
is the correct long-term fix, but editing `package.json` is explicitly
prohibited in this Gate 2 scope. This is flagged as an owner decision in
`control-provenance.csv`, not silently fixed or silently omitted.

## New finding this cycle: sequential-write partial-mutation bug (found and fixed)

While writing the "failed rollback write" test case, an early implementation
draft called `writeMemory` then `writeBuffer` in sequence for the restore.
If the second call failed, the first had already mutated memory —
producing a false "rollback failed" while memory was silently left in an
intermediate (numerically-restored-but-not-byte-exact) state, and a retry
would then incorrectly report `expected_value_mismatch` instead of
succeeding. This was caught by the test itself before any of this code
shipped, and fixed to a single atomic restore operation per entry
(`writeBuffer` OR `writeMemory`, never both in sequence). No production
regression occurred — this was found and fixed within the same Gate 2
implementation cycle, before merge/release.

## Final B1.1 verdict

BATCH B1.1 CONDITIONAL PASS.

No proven B1.1 regression. The remaining conditions are the same class as
before Gate 2 (unrelated Electron TypeScript baseline, unrelated
GameLibrary.tsx whitespace, packaged real-process E2E certification for 6
lifecycle scenarios) plus one newly disclosed process-integrity finding
(test-wiring gap) — none of which constitute a proven functional B1.1
regression requiring FAIL.
