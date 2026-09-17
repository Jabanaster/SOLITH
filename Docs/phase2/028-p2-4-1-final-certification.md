# Phase 2 P2-4.1 — Final Pointer-Stability Certification

## Verdict: P2-4 (pointer stability testing / real-game restart validation) = CERTIFIED COMPLETE

This closes P2-4 as CERTIFIED COMPLETE, superseding P2-4's own NOT_COMPLETE closure (`Docs/phase2/022`) without retracting or overwriting any of its evidence. All four gaps the user identified as blocking closure are resolved with real, verified evidence; all four are documented in `Docs/phase2/023` through `026`; full regression and no-retry remote CI are documented in `Docs/phase2/027`.

## The four gaps, closed

1. **Real-game restart evidence (was 0/0).** 5/5 real restarts against Bastion.exe, a real currently-installed shipped title, using a deterministic process-owned static ground truth (a NUL-terminated ASCII string in the exe's own `.text`-section metadata, independently verified by parsing the on-disk PE file) — never "resolved therefore stable." Every run genuinely new (distinct PID each time), every run recorded, no omissions. `Docs/phase2/023`.
2. **ASLR/module relocation (was PARTIAL).** Root cause of the fixture campaign's non-relocation identified (Windows caches an image base per file path, not per launch) rather than assumed to be disabled ASLR. A real, non-faked test proves the production resolver correctly reclassifies `stable_relocated` when two genuinely different process instances have genuinely different real module bases. Reinforced by the real-game campaign's own incidental relocation (4/5 restarts). ASLR was never disabled; no module base was ever faked. `Docs/phase2/024`.
3. **Pointer-map Load defect (was filed to a separate investigation).** Reconciled inside this stage's own scope, without touching the peer investigation's shared worktree. Root cause independently confirmed by both this investigation and the peer session: a stale renderer status-message bug, not a backend/session race. Fixed (one line) and regression-tested (verified to fail pre-fix, pass post-fix). Confirmed cosmetic-only — no impact on saved data, IPC, or classification logic. `Docs/phase2/025`.
4. **CI cancellation flake (was accepted via rerun-to-green).** Root-caused to a genuine last-chunk race in a progress-based "still in flight" proxy check, not a defect in cancellation itself. Fixed with the codebase's own established honest-retry pattern for this exact race class. 35 local runs, 0 flakes. `KNOWN CERTIFICATION FLAKES` after this closure: **0**. `Docs/phase2/026`.

## Fields

- **REAL GAME(S):** Bastion.exe (`D:\SteamLibrary\steamapps\common\Bastion\Bastion.exe`)
- **REAL-GAME GROUND TRUTH:** Deterministic process-owned static object — first 4 bytes of the NUL-terminated ASCII string `"Bastion"` embedded in Bastion.exe's own `.text`-section CLR metadata at RVA 1,350,084 (file offset 1,342,404), independently verified via direct PE-file parsing (no running process), value `0x74736142` (little-endian u32)
- **REAL-GAME RESTARTS:** Bastion.exe 5/5
- **STABLE/UNSTABLE REAL-GAME CHAINS:** 5 stable (1 `stable_exact` baseline + 4 `stable_relocated`), 0 unstable, 0 skipped/omitted
- **MODULE RELOCATION:** PASS — dedicated dual-process test: OLD MODULE BASE and CURRENT MODULE BASE genuinely differ (real OS-assigned bases, e.g. one observed pair: original vs. copy, both real, both different — see `Docs/phase2/024` for the mechanism); real-game campaign additionally observed OLD `0xd60000` → new `0x830000`/`0xcd0000`/`0x50000`/`0x910000` across its own 5 restarts
- **HEAP RELOCATION:** PASS (already proven 9/9 in P2-4's own `Docs/phase2/017`, unchanged and re-verified via unmodified regression)
- **POINTER-MAP LOAD DEFECT:** Root cause: `PointerMapPanel.loadMaps()`'s pre-attach `not_attached` refresh result was written into the panel's status message with nothing to ever clear it. Disposition: FIXED (`src/app/components/PointerMapPanel.tsx`), regression-tested, confirmed cosmetic-only
- **CI CANCELLATION FLAKE:** Root cause: `native/solith-scanner-napi/test/exact-scan.test.js`'s `chunksRead > 0` check is equally true on the scan's last chunk, so an occasional CI-scheduling stall can let the scan finish before `cancel()` lands. Disposition: FIXED (honest 5-attempt retry, matching the codebase's existing pattern for this race class), verified across 35 local runs
- **KNOWN CERTIFICATION FLAKES:** 0
- **FULL REGRESSION:** `test:live-memory` 556/556; root `npm test` clean; root + electron `tsc --noEmit` clean; `npm run build` (vite + electron + electron-builder) clean, 33/33 output-verifier checks, signed NSIS installer; `cargo fmt --check`/`cargo clippy --release`/`cargo test --release` clean (50/50); NAPI suite 51/1-skip/0-fail; P2-3 e2e 2/2; packaged pointer-map e2e 2/2; pointer-map stability e2e 2/2
- **FRESH WORKTREE:** `G:\ACTIVE_PROJECTS\solith-p241-fresh-verify`, detached HEAD `1cb64efe45ece75fe1dad12a6f69d3416e67fd45`, canonical install/build only, `test:live-memory` 556/556 matching the dev worktree
- **REMOTE CI:** [PR #35](https://github.com/Jabanaster/SOLITH/pull/35), `feature/solith-phase2-pointer-stability-closeout` → `master` — every required check (PR Windows, CI Fast, PR Static, Semgrep, OSV-Scanner, Gitleaks, Vendored memoryjs integrity) passed on its **first execution**, zero retries
- **ROADMAP BEFORE:** Pointer stability testing PARTIAL, Pointer maps (model + live orchestration) PARTIAL, P2-4 IN PROGRESS
- **ROADMAP AFTER:** Pointer stability testing IMPLEMENTED_VERIFIED, Pointer maps (model + live orchestration) IMPLEMENTED_VERIFIED, P2-4 CERTIFIED COMPLETE, P2-A workstream CERTIFIED COMPLETE
- **PHASE 2 COMPLETE/PARTIAL/ABSENT:** 5 COMPLETE / 5 PARTIAL / 18 ABSENT (sums to the roadmap's own 28-requirement count; full breakdown in the ROADMAP.md P2-4.1 reconciliation note)
- **P2-4 FINAL VERDICT: COMPLETE**

## What remains open (Phase 2, not this stage's scope)

P2-5 through P2-17 (structure discovery, typed memory views, value/type inference, memory map/watchlists, freeze/write/revert real-game exercise plus its known address-validation inconsistency, the Adaptive Scan Planner, Zydis/Vectorscan/DynamoRIO/Dear ImGui/Ghidra adoption, symbol/module awareness, resilient/version-aware rediscovery, and final Phase 2 certification) are untouched by this stage and remain exactly as ABSENT/PARTIAL as before. **Phase 2 overall remains NOT_COMPLETE.**

STOP. DO NOT START P2-5 AUTOMATICALLY.
