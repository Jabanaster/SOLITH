# Gate 2.2A.2 — Evidence Corrections

## Phase 3 — Timeline reconstruction, explicit answers

**Was the vendor output hash captured before or after electron-builder ran?**
Both, at two different points, referring to two different underlying files. `electron-native-binary-hashes.csv` (616f2e9c...) was captured immediately after the manual standalone rebuild (Sequence 3), **before** `npm run dist:dir` / electron-builder ran. `native-binary-inventory.csv`'s "vendor build output" row (e286fd07...) was captured during Phase 9, **after** `dist:dir` had already run and overwritten the vendor path with electron-builder's own rebuild (Sequence 4).

**Did electron-builder rebuild the vendor output in place?**
Yes. `packaged-build-output.txt` shows electron-builder's own `@electron/rebuild` step logging `preparing moduleName=vendor/memoryjs-3.5.1-patched arch=x64` then `finished ...` — this re-prepares (rebuilds) the module at its own source path, overwriting whatever was previously at `vendor/memoryjs-3.5.1-patched/build/Release/memoryjs.node` (Sequence 3, 616f2e9c...) with a fresh build (Sequence 4, e286fd07...).

**Was the packaged binary copied from that rebuilt output?**
Yes. The final packaged binary (Sequence 6, `dist/win-unpacked/.../memoryjs.node`) is byte-identical to Sequence 4 — confirmed by hash comparison (see `hash-comparison.csv`). It is a direct copy electron-builder made of its own freshly-rebuilt vendor output.

**Was the vendor output later restored to the Node 22 ABI?**
Yes. After all Electron-ABI/packaged verification completed (Phases 5–9), `node-gyp rebuild --target=22.23.1` was run again, producing Sequence 5 (`d8ebfd68...`), which overwrote Sequence 4 at the vendor path. This was necessary so the Node-based regression gate (`npm test`, `npm run test:live-memory`) could load the addon.

**Were any hashes compared across different timestamps or ABI states?**
Yes — this is the exact root of the apparent contradiction. `packaged-native-binary-verification.csv`'s "MatchesElectronABIBuildHash: No" compared Sequence 6 against Sequence 3 (captured before electron-builder ran). `native-binary-inventory.csv`'s "vendor build output == packaged copy" compared Sequence 6 against Sequence 4 (captured after electron-builder ran, and before Node-22 restoration). Both statements are individually correct; neither document disambiguated which vendor-tree snapshot ("before electron-builder's own rebuild" vs "after") it was referring to, which is what created the appearance of a contradiction between the two files.

**Did PE timestamps or compiler nondeterminism explain the different hashes?**
Yes, for the Sequence 3-vs-4 pairing (and separately for Sequence 1-vs-5): both are independent, valid `node-gyp` invocations of the exact same unchanged source, and MSVC-produced PE binaries embed a build timestamp and other invocation-specific metadata that differs between separate compiles even with zero source changes. This is normal, expected behavior for native rebuilds and does not indicate any inconsistency in the underlying source or fix.

**Did the final packaged candidate contain the behaviorally verified fixed binary?**
Yes, unambiguously. `packaged-native-binary-behavioral-verification.txt` loaded the packaged file by its exact packaged path (`dist/win-unpacked/resources/app.asar.unpacked/node_modules/memoryjs/build/Release/memoryjs.node`, Sequence 6, e286fd07...) — not the vendor path, not an inference — and directly exercised both original defects against it: a read-only handle's write now throws `write_failed:5`, a write-capable handle's write lands, and an unmapped-address write throws `write_failed:998`. This ties the behavioral proof to the exact shipped file with no ambiguity.

## Phase 5 — Correction notices

### Correction 1 — `packaged-native-binary-verification.csv`

**Original statement:** "No (different hash, same size class as the fix — expected: separate compiler invocation embeds a different PE timestamp even for identical source)" — accurate as far as it goes, but does not name which specific prior binary ("the standalone Electron-ABI build") it is comparing against, nor that this binary had already been superseded in place before packaging ran.

**Corrected statement:** The packaged binary (Sequence 6) does not byte-match the manually-produced standalone Electron-ABI rebuild (Sequence 3, captured in `electron-native-binary-hashes.csv`, SHA256 `616f2e9c...`), because Sequence 3 was superseded in place by electron-builder's own internal rebuild (Sequence 4) before packaging ever copied a file out. The packaged binary IS byte-identical to Sequence 4, the binary electron-builder itself produced and copied — see `native-binary-timeline.csv` and `hash-comparison.csv`.

**Reason:** Two separate, independent rebuild invocations of the identical corrected source (one manual, one electron-builder's own) — expected PE-timestamp nondeterminism, not a defect.

**Supporting evidence:** `native-binary-timeline.csv` (Sequences 3, 4, 6), `hash-comparison.csv`, `packaged-build-output.txt` (electron-builder's own rebuild log lines).

**Date of correction:** 2026-07-29 (Gate 2.2A.2).

**Action taken:** Added a clarifying note to `packaged-native-binary-verification.csv` in place (see below) rather than rewriting the original row, which remains historically accurate for its capture point.

### Correction 2 — `native-binary-inventory.csv`

**Original statement:** The "vendor build output" row's path label reads only `vendor/memoryjs-3.5.1-patched/build/Release/memoryjs.node (as of end of Phase 9, before Node-22 restoration)` — this already disambiguates the capture point correctly, but did not cross-reference that this specific snapshot (Sequence 4) is a *different* file than the one referenced earlier in the same evidence set as "the standalone Electron-ABI rebuild" (Sequence 3).

**Corrected statement:** No factual change required — the original row is accurate for its stated capture point. A cross-reference note has been added (see below) pointing to `native-binary-timeline.csv` so a reader does not conflate this snapshot with Sequence 3.

**Reason:** Clarity/cross-reference gap, not a factual error.

**Supporting evidence:** `native-binary-timeline.csv`.

**Date of correction:** 2026-07-29 (Gate 2.2A.2).

### Correction 3 — `verification-final.txt` (Gate2_2A_1_PackagedNative)

**Original statement:** Documented both facts correctly in isolation ("does not byte-match the standalone Electron-ABI rebuild... resolved by direct behavioral verification" and the native-binary-inventory summary) but did not explicitly state, in one place, that the vendor-tree snapshot referenced by each statement was a *different point in time* for the same shared file path.

**Corrected statement:** A clarifying paragraph has been appended (see below) explicitly walking the Sequence 3 → 4 → 6 chain so a reader does not need to cross-reference multiple files to resolve the apparent contradiction.

**Reason:** Documentation completeness, not a factual correction.

**Date of correction:** 2026-07-29 (Gate 2.2A.2).

### Correction 4 — `SOLITH_SECURITY_ROADMAP.md`

Reviewed. The canonical roadmap's Gate 2.2A.1 section (Phase 3.12) already states the mismatch was "expected... not a defect" and describes the behavioral-verification resolution, without asserting or implying that the vendor build output and packaged copy were simultaneously both identical and non-identical to the *same* reference binary. No factual correction to the roadmap's binary-hash statements was required. One clarifying sentence was added to the Gate 2.2A.1 section noting that full binary-provenance reconciliation is documented separately under Gate2_2A_2_Provenance.

## Provenance verdict

**PROVENANCE RECONCILED — FUNCTIONALLY EQUIVALENT, NOT BYTE IDENTICAL.**

The standalone Electron-ABI rebuild (Sequence 3) and electron-builder's own rebuild (Sequence 4, which became the shipped Sequence 6) are two separate, independently valid rebuilds of the identical corrected source, producing different hashes for the expected reason (PE-timestamp/build-metadata nondeterminism across separate compiler invocations). The packaged binary that actually shipped (Sequence 6) was directly, behaviorally verified — by loading that exact packaged file path under the real Electron runtime and exercising both original defects against it — independent of any hash comparison. No byte-identity claim between the standalone rebuild and the packaged binary was ever required or true; the correct and sufficient claim is behavioral equivalence of the packaged binary to the corrected source, which is proven.
