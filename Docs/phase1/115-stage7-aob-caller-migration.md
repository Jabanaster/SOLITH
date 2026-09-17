# Phase 1 / Stage 7.4 §5-§9 — AOB Production Caller Migration

## Re-audit, mission §5's exact scope

Repo-wide search for `scanAobInProcess(`, `findAobInBuffer(`/`parseAobSignature(` (any independent AOB-shaped implementation, not just the shared helper's call sites), and every prior-stage-named location (`feature-resolver.ts`, `signature-engine.ts`, `hook-engine.ts`, `aob-resolver.ts`, `live-memory-session.ts`, `scanner-backend-legacy.ts`).

## Complete caller table

| Caller | Current path | Target path | Status |
|---|---|---|---|
| `ScannerBackendRouter` LEGACY mode → `LegacyScannerBackend.aobScan` → `scanAobInProcess` | Legacy, by design | N/A — this IS the router's own legacy backend implementation, reached only in explicit LEGACY/rollback mode or SHADOW_COMPARE's shadow leg | **LEGACY_ROLLBACK_ONLY** (intentional, unchanged) |
| `ScannerBackendRouter` NATIVE mode → `NativeScannerBackend.aobScan` → napi → Rust | Native | Native | **MIGRATED_TO_BACKEND** (Stage 7.3) |
| `LiveMemorySession.scanAobViaBackend` (backs the `live-memory-scan-aob`/`-start` IPC channels) | Router | Router | **MIGRATED_TO_BACKEND** (Stage 7.3) |
| `LiveMemorySession.scanAobSignature` (a separate, older method) | `scanAobInProcess` directly | N/A | **LEGACY_ROLLBACK_ONLY** — zero callers anywhere in the codebase (production or test); dead API surface kept per doc 107's own prior disposition, not deleted (mission: "Do NOT delete legacy scanner yet") |
| `feature-resolver.ts`'s `resolveMemoryFeatureAddress` (production entry: `LiveMemorySession.resolveMemoryFeature`, called from the `live-memory-resolve-control`/`live-memory-resolve-definition-feature` IPC handlers) | Bound resolver (`LiveMemorySession.createAobResolver()`) → router; falls back to `scanAobInProcess` only when no resolver is supplied | Bound resolver → router | **MIGRATED_TO_BACKEND** (production); the internal `scanAobInProcess` fallback branch is **TEST_ONLY** — genuinely unreachable from any production caller (both real callers, `LiveMemorySession.resolveMemoryFeature` and `zero-input-prepare.ts`, always pass a bound resolver) |
| `signature-engine.ts`'s `resolveSignature` exact sub-path (production entry: `process-watcher.ts`'s `resolveDefinitionFeatures`, called only from `zero-input-prepare.ts`) | Bound resolver → router when supplied; falls back to `scanExactSignature`/`findAobInBuffer` otherwise | Bound resolver → router | **MIGRATED_TO_BACKEND** (production); the `scanExactSignature` fallback branch is **TEST_ONLY** |
| `signature-engine.ts`'s `resolveSignature` fuzzy sub-path (`scanFuzzySignature` — Hamming/edit-distance drift tolerance with hint windows) | Always `driver.readBuffer` + `findBestDriftAobInBuffer`, unconditionally, regardless of router mode | None — no native equivalent exists | **See "The one deliberately unmigrated capability" below** |
| `hook-engine.ts`'s `installHookFromProposal` | No longer scans at all — the AOB lookup moved to its caller | N/A | **Scanning responsibility relocated, not migrated in place** — see below |
| `in-process-confirm-hook` IPC handler (hook-engine.ts's new caller) | `LiveMemorySession.scanAobViaBackend` → router | Router | **MIGRATED_TO_BACKEND** |

## The one deliberately unmigrated capability: fuzzy/drift-tolerant AOB matching

`signature-engine.ts`'s fuzzy path (Hamming substitution matching + bounded edit-distance byte-shift matching, with an optional hint-address search window) has no representation in the native pattern engine at all. `native/solith-scanner-core/src/pattern.rs`'s own doc comment describes its model precisely: every pattern compiles to a `PatternByte{mask, value}` sequence matched by exact `(byte & mask) == value` comparison — full-byte wildcards, nibble wildcards, and every AOB grammar variant mission §10 lists (`??`, `?`, `*`, `xx/x`, nibble wildcards, continuous CE syntax) are all still *exact* matching, just against a pattern with some bytes masked out. There is no notion anywhere in that engine of "match within N substitutions" or "match with up to N inserted/deleted bytes" — fuzzy matching is a fundamentally different algorithm (bounded edit-distance search), not a parameterization of exact pattern matching.

This is *why* mission §7's own required-test list for signature-engine migration (exact signature, wildcards, continuous CE syntax, multiple matches, no-match complete/incomplete, >1 MiB, cancel, process exit) names only exact-match capabilities — it never asks for fuzzy/Hamming/edit-distance tests, which is consistent with this real, structural boundary. Migrating fuzzy matching to native would mean designing and building a wholly new native capability (a real, open-ended engineering project, not a routing change), not something this pass's scope covers or that could be done safely without dedicated design and testing of its own.

Fuzzy matching stays legacy-only, permanently, by design. This is a real, disclosed, structural gap between the two backends' AOB capabilities — not an unmigrated shortcut, not silently narrowed.

## Hook-engine: scanning responsibility relocated, not migrated in place

`installHookFromProposal` (`src/core/in-process-script/hook-engine.ts`) previously called `scanAobInProcess` itself. That call is now removed entirely; the function's signature adds a required `hookSite: bigint` parameter, and the AOB lookup happens in its caller — the `in-process-confirm-hook` IPC handler (`electron/live-memory-ipc.ts`) — via `session.scanAobViaBackend(plan.aobSignature, plan.moduleName)`. This satisfies mission §8's explicit scope boundary ("Do NOT alter unrelated hook execution/injection semantics. Scope only scanner resolution") in the smallest possible way: every line of `installHookFromProposal` after the scan (cave allocation, shellcode build, the real process writes) is byte-for-byte unchanged.

The handler distinguishes a genuinely absent signature from an incomplete scan — `aob_signature_not_found` (authoritative, `isAuthoritativeAbsence: true`) vs `aob_signature_scan_incomplete` (the scan did not reach full coverage; not found is not proven) — rather than collapsing both into one ambiguous failure, per mission §10's "incomplete zero-match MUST NOT become authoritative not-found" rule applied here too.

## Real evidence

- `tests/in-process-script/hook-engine-aob-migration.test.ts` (3 tests) — proves `installHookFromProposal` no longer performs any AOB scan itself (a driver whose `getRegions`/`getModules` throw is used; reaching the real `native-bridge.ts`/`memoryjs` call, which genuinely fails outside a real process, proves the scan step was skipped and the given `hookSite` was used directly). The actual cave-allocation/write success path requires a real Windows process handle via `memoryjs` — the same category of dependency as the real-game canaries — and is not re-exercised end-to-end by this unit test; it is unchanged code, and its own pre-existing manual/staged verification is not superseded by anything this pass touched.
- `tests/live-memory/feature-resolver.test.ts` (2 new tests) and `tests/live-memory/signature-engine.test.ts` (2 new tests) — prove the resolver-seam wiring itself: when a resolver is bound, its result is what gets used, not a direct `scanAobInProcess`/`scanExactSignature` call.
- `tests/live-memory/feature-resolver-native-default-real-process.test.ts` (2 tests) — the compositional proof's one remaining empirical link, against a real spawned fixture process: `LiveMemorySession.resolveMemoryFeature` really does route its AOB step through NATIVE by default with zero override (not merely that the wiring compiles), and explicit rollback to LEGACY and back to NATIVE both still work. The rollback test plants its pattern in `REFINE_REGION` (64 KiB, legacy-reachable) rather than reusing `PATTERN_REGION` (8 MiB) — an earlier draft used `PATTERN_REGION` and failed for a real, structural reason: `PATTERN_REGION` exceeds legacy's 1 MiB `readBuffer` cap, so legacy's `scanAobInProcess` silently skips the whole region and reports whatever *other* coincidental match it finds elsewhere in the process — the exact 1 MiB defect mechanism, applied to AOB, confirmed empirically this pass to affect AOB exactly as it affects exact-value scanning. This is legacy honestly exhibiting its own known limit, not a bug in this migration.
- `signature-engine.ts`'s exact sub-path is proven correct at the unit level (bound-resolver wiring) but not re-proven against a real process independently of the feature-resolver proof above — `resolveExactSignatureViaBackend` is a thin wrapper with no logic of its own beyond what `createAobResolver()` already does, and `createAobResolver()` is the exact same function feature-resolver's real-process test exercises directly. This is a compositional proof, stated explicitly rather than silently assumed.

## Re-audit after migration (mission §9's exact classification scheme)

| Classification | Count | Members |
|---|---|---|
| MIGRATED_TO_BACKEND | 4 | `NativeScannerBackend.aobScan`, `scanAobViaBackend`, `resolveMemoryFeatureAddress` (production path), `resolveSignature` exact sub-path (production path) + `in-process-confirm-hook` |
| LEGACY_ROLLBACK_ONLY | 2 | `LegacyScannerBackend.aobScan` (router's own legacy arm), `scanAobSignature` (dead, uncalled) |
| POINTER_SPECIFIC | 0 | none — pointer scanning has no AOB component |
| TEST_ONLY | 2 | `resolveMemoryFeatureAddress`'s unbound fallback, `resolveSignature`'s unbound exact fallback |
| COMPATIBILITY_SHIM | 0 | none |
| **Unclassified / genuinely permanent legacy-only, not a rollback path** | 1 | `signature-engine.ts`'s fuzzy sub-path — see above; does not fit any of mission's 5 listed buckets cleanly, called out explicitly rather than forced into one |

**UNKNOWN: 0.**

`NORMAL_PRODUCTION_LEGACY_AOB_CALLERS`: mission asks for this to be 0. The honest count is **1** — the fuzzy/drift-tolerant sub-path, which is a real production caller that always uses legacy-shaped AOB matching regardless of the router's mode, because no other implementation of that specific capability exists. This is reported as 1, not rounded to 0, per the same "no forced closure" discipline mission §20/§21 apply to defect closure. It is not an instance of the AOB *defect* (D01/D04's silent false-negative mechanism) — it is a structurally different, deliberately legacy-only *feature* (Cheat-Engine-style drift tolerance across executable updates) that was never migrated because there is nothing on the native side to migrate it to. See doc 116 for why this does not block closing the AOB shipping defect itself.
