# Phase 1 / Stage 7 — Parity Framework

## §7.6 — shadow compare

`ScannerBackendRouter.routedExactScan`/`routedAobScan` in `SHADOW_COMPARE` mode: execute legacy (always first, always authoritative for the returned result — mission §7.6's explicit requirement, proven by `scanner-backend-router.test.ts`'s "SHADOW_COMPARE always returns the legacy result unchanged, even when native disagrees"), execute native alongside (attached lazily, at most once per pid per router instance), normalize both to the canonical model, diff, classify (§7.7), and record — never return native's result, even when native is objectively more correct. A native failure during shadow comparison does not fail the call at all — it is recorded (`nativeError`) and the legacy result is still returned; shadow mode's entire purpose is safe, non-blocking observation.

Compared: match address sets, values (including the `valueNumber`-vs-`valueBigint` representation itself for i64), completeness state, authoritative-not-found state. Not compared: internal performance or implementation details (mission §7.6's explicit carve-out) — no test in this stage asserts identical timing or internal chunk counts between backends.

## §7.7 — difference classification

Every difference is one of the six mission-defined categories — never left unclassified, never assumed to be a native defect by default. Implemented in `classifyExactScanDifference`/`classifyAobDifference` (`scanner-backend-router.ts`):

- **EXPECTED_NATIVE_CORRECTION** — triggered when legacy's own completeness state is not `complete` (it admits it may have missed something) AND native found more matches than legacy. This is deliberately based on legacy's own honesty signal, not on requiring native's *global* completeness to be pristine — a native scan across a real process's entire address space can hit its own incidental, unrelated single-region failures (a real OS race between enumeration and read) without that invalidating the specific extra match it found elsewhere; requiring global native completeness produced false `SEMANTIC_DIFFERENCE` classifications in real-process testing before this refinement (see doc 76's real-process evidence).
- **SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION** — the honest fallback for every disagreement this router cannot attribute to a known, understood cause. Never guessed into a more favorable category.
- The int64 case (`value_representation` field) is classified **EXPECTED_NATIVE_CORRECTION** specifically when legacy's match carries a `valueNumber` (its own lossy narrowing) and native's carries an exact `valueBigint` — mission §7.7's own literal "Number-rounded int64" example.
- `NATIVE_BUG`, `LEGACY_BUG`, `TEST_FIXTURE_ERROR`, `UNSUPPORTED_OPERATION` are declared in the `ParityDifferenceClassification` type and are real, valid outcomes this router can emit in principle — none was observed in any test this stage, and none is force-fit where it doesn't apply. No difference discovered this stage needed them, and this document does not claim a defect where a difference is fully expected/explained.

Unit-level proof (`scanner-backend-router.test.ts`, deterministic stub backends, 10 tests): LEGACY mode never touches native at all; NATIVE mode with no fallback allowed rethrows on native failure; NATIVE with the canary escape hatch records both failure and fallback; SHADOW_COMPARE returns legacy unchanged even on disagreement; the two named EXPECTED_NATIVE_CORRECTION heuristics fire correctly; an unexplained disagreement classifies as SEMANTIC_DIFFERENCE; identical match sets record zero differences; `setMode` rolls back without recreating the router; native is attached at most once per pid.

Real-process-level proof (`scanner-backend-real-process.test.ts`, 3 tests against the actual `solith-scanner-fixture.exe`): see doc 76.
