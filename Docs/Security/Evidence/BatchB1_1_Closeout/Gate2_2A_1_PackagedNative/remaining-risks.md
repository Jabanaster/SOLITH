# Remaining Risks — Gate 2.2A.1

## R-2.2A-001 (from Gate 2.2A) — RESOLVED

The packaged Electron-ABI native addon has now been rebuilt with the Gate 2.2A fix, verified
under the real Electron 42.4.1 runtime (18/18), packaged into a fresh `dist/win-unpacked/Solith.exe`,
verified byte-behaviorally to contain the fix (not just hash-matched), passed packaged smoke
(23/23), and passed a full real-process write/read/restore/failure proof through the real IPC
propose/consent/confirm flow (1/1). This risk is resolved.

## R-2.2A.1-001 (new): packaged binary hash does not match the standalone Electron-ABI rebuild

Not a defect — see `failure-classification.csv` and `packaged-native-binary-verification.csv`.
Two separate compiler invocations of identical source produce different PE-embedded build
timestamps, so byte-identity was never a reliable signal here. Resolved by direct behavioral
verification of the exact shipped file rather than relying on hash equality.

## R-2.2A.1-002: dev-tree native binary now requires ABI-aware handling

`vendor/memoryjs-3.5.1-patched/build/Release/memoryjs.node` is a single build-output path shared
by both the Node-22 dev/test rebuild and the Electron-ABI packaging rebuild — whichever ran last
"wins" for that path. This cycle explicitly restored the Node-22 ABI build at the end (see
`native-binary-inventory.csv`) so `npm test`/`test:live-memory` keep working. Future sessions
that rebuild for Electron (packaging) must remember to restore the Node-22 build afterward before
running the Node-based test suites, or vice versa. This is a workflow/process risk, not a security
risk — flagged so it isn't silently forgotten next session.

## R-2.2A.1-003: no fixture/known-writable-address exists for a real single-player game process

Unchanged from Gate 2.2/2.2A — the Gate 2.2 fixture is a dedicated .NET console app, not a real
game. Gate 2.2's remaining lifecycle scenarios (feature-disable mid-freeze, window-identity/
navigation) can now resume using this fixture and the fixed native path, but they still represent
a synthetic target process, not a real game binary. Disclosed consistently with Gate 2/2.1/2.2's
own disclosure standard.

## Final Gate 2.2A.1 verdict

GATE 2.2A NATIVE WRITE REMEDIATION PASS (upgraded from Gate 2.2A's CONDITIONAL PASS — packaged
verification is now complete):

- Corrected native code rebuilds for the Electron ABI: YES (electron-native-rebuild-output.txt,
  "gyp info ok").
- Addon loads under the actual Electron runtime: YES (electron-runtime-native-write-run.txt).
- Real fixture writes and restores pass under Electron: YES (18/18, electron-runtime-native-write-matrix.csv).
- Packaged application contains the corrected Electron-ABI binary: YES, confirmed behaviorally
  (packaged-native-binary-behavioral-verification.txt), not merely by hash.
- Packaged binary hash verified: YES, recorded (differs from the standalone rebuild for explained
  reasons; matches itself consistently between vendor build output and the packaged copy).
- Packaged smoke tests pass: YES, 23/23 (packaged-smoke-output.txt), unchanged from established
  baseline.
- Packaged real-process write and failure propagation pass: YES, 1/1 full scenario
  (packaged-real-process-write-output.txt).
- No stale pre-fix binary used by the packaged candidate: YES, confirmed
  (native-binary-inventory.csv) — the only pre-fix copy on disk was superseded by this cycle's
  rebuild.
- Full regression tests pass: YES — `npm test` 1040/1040, `test:live-memory` 257/257, main
  TypeScript 0 diagnostics, Electron TypeScript 31/13 (unchanged baseline), `git diff --check`
  GameLibrary.tsx-only (unchanged baseline).
- Evidence complete: YES, this directory.
- Canonical root roadmap updated: YES, `G:\ACTIVE_PROJECTS\SOLITH\SOLITH_SECURITY_ROADMAP.md`.

BATCH B1.1 remains: **BATCH B1.1 CONDITIONAL PASS**. This cycle closed the packaged-verification
gap left open by Gate 2.2A; it does not by itself satisfy the remaining B1.1 conditions from
Gate 2/2.1 (unrelated Electron TypeScript baseline, unrelated GameLibrary.tsx whitespace) or
Gate 2.2's own remaining lifecycle scenarios (feature-disable mid-freeze, window-identity/
navigation), which may now resume using the fixed native path and the existing Gate 2.2 fixture.
