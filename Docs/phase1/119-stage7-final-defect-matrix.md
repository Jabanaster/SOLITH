# Phase 1 / Stage 7.4 §20-§21 — Final Product Defect Matrix and Legacy Caller Inventory

## Product defect matrix (mission §20's exact required shape)

| Defect | Status | Evidence |
|---|---|---|
| 1 MiB | `PRODUCT_DEFECT_CLOSED` (unchanged, regression-verified — see below) | Doc 107 (Stage 7.3); reconfirmed this pass via the full test suite and fresh worktree with zero regressions |
| Alignment | **`PRODUCT_DEFECT_CLOSED`** | Doc 113 |
| AOB | **`PRODUCT_DEFECT_CLOSED`** (scoped to the real defect mechanism — see doc 116's explicit distinction from the separate, permanently-legacy-only fuzzy-matching capability) | Doc 116 |
| INT64/U64 | **`PRODUCT_DEFECT_CLOSED`** | Doc 114 |
| Pointer depth | `PRODUCT_DEFECT_NOT_YET_CLOSED` (untouched, unconditionally, per mission §9/§20's own instruction) | Untouched this pass |

No N/A used; no partial reported where schema/caller migration genuinely succeeded, per mission §20's own instruction. Every closure above is evidenced through the real default NATIVE production route with zero override, not a synthetic stand-in.

## 1 MiB regression verification

Not revisited functionally (mission: "Do NOT revisit already-certified 1 MiB closure unless a regression appears"). No regression appeared: `scanner-backend-native-default-defect-closure.test.ts`'s existing 1 MiB test is unchanged and still passes (full suite results, doc 120); the wire-type widening this pass is strictly additive to the type vocabulary and does not touch `native-memory-driver.ts`'s `readBuffer` cap or `NativeScannerBackend`'s region-read logic at all.

## Legacy caller final inventory (mission §21)

Re-run: `grep -rn "scanFirst(\|scanAobInProcess(\|scanFirstRegions(" src/core/live-memory/*.ts src/core/in-process-script/*.ts electron/*.ts`, excluding test files, cross-referenced against doc 115's full AOB caller table and the exact-scan caller set unchanged from doc 97/111.

- **NORMAL_PRODUCTION_LEGACY_EXACT_CALLERS: 0** — unchanged from every prior stage; the two migrated exact-scan entry points (`scanExactViaBackend`'s two callers, `live-memory-scan-first`/`-start`) remain the only routed exact-scan surface, and no new direct `scanFirstRegions` production caller was introduced this pass.
- **NORMAL_PRODUCTION_LEGACY_AOB_CALLERS: 1** (not 0) — `signature-engine.ts`'s fuzzy/drift-tolerant sub-path (doc 115/116). Reported exactly, not rounded to 0, because it is a real production code path that unconditionally uses legacy-shaped AOB matching for a capability the native backend does not (and structurally cannot, without new engineering) provide. This is the one honest exception to mission §21's "UNKNOWN = 0 / NORMAL_PRODUCTION_LEGACY_AOB_CALLERS = 0" target; every other real production AOB caller this pass could find and migrate, it migrated.
- **UNKNOWN: 0** — every AOB-shaped call site found this pass (doc 115's complete table) is classified into one of MIGRATED_TO_BACKEND / LEGACY_ROLLBACK_ONLY / TEST_ONLY, or explicitly called out as the one capability that fits none of those buckets (the fuzzy sub-path) — nothing is left unclassified.

Allowed legacy usage per mission §21 (`ROLLBACK_ONLY`, `POINTER_SPECIFIC`, `TEST_ONLY`, `COMPATIBILITY_SHIM`) accounts for every remaining legacy AOB caller except the one disclosed above, which does not fit any of those four labels either — it is simply a real, permanent, structural capability gap between the two backends, stated plainly rather than mis-labeled to force a clean 0.
