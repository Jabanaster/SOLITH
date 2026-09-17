# Phase 1 / Stage 7.1 — Semantic Difference Resolution

## §7.1-B — the "1 unresolved difference" from the Stage 7 final report

**Operation**: exact-value scan, i32, target value 7.

**Legacy result**: 1 match, address `0x1000`, completeness `complete`.

**Native result**: 1 match, address `0x2000`, completeness `complete`.

**Canonical intended result**: cannot be determined from this data alone. Both backends report full, non-degraded coverage (`completeness.state === 'complete'` on both sides) and both report exactly one match for the same target value — but at two different addresses. There is no third source of truth (no independent ground-truth memory dump) to say which address is real, or whether both are real.

**Why they differ**: this case exists in `tests/live-memory/scanner-backend-router.test.ts` ("classifies an unexplained match-set disagreement as SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION, never guessed") as a **synthetic unit test** built from two independently stubbed backends — it does not correspond to any real memory region or real scan. It was constructed deliberately to verify `classifyExactScanDifference`'s negative case: when neither backend shows an honesty signal (both `complete`) and match sets genuinely disagree, the classifier must not guess `EXPECTED_NATIVE_CORRECTION` or `LEGACY_BUG` or `NATIVE_BUG` — it must fall through to `SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION` and stop there.

**Classification**: `TRUE_SEMANTIC_DECISION` is not applicable — there is no real product behavior to decide on, because this is a synthetic stub scenario, not an observed real difference. It is correctly `SEMANTIC_DIFFERENCE_REQUIRING_OWNER_DECISION` as a classifier-correctness fixture, not a genuine open product question.

**Owner policy needed?**: No real-world instance of this pattern (both backends complete, addresses disagree) has ever been produced by real-process testing. All three real-process tests (`scanner-backend-real-process.test.ts`) that show backend disagreement do so exactly where legacy is incomplete and native finds more — the `EXPECTED_NATIVE_CORRECTION` path, not this one. If real testing in §7.1-C through §7.1-M produces an actual instance of two `complete` backends disagreeing on a live process, THAT would require a STOP-and-report to the user before any behavior change (per mission §7.1-B) — this document commits to raising it the moment it is observed rather than force-classifying it.

**Resolution for Stage 7.1 purposes**: not a real open semantic difference. The router's classifier already handles this correctly (refuses to guess, reports the fifth category), which is the desired production behavior. No code change made. `UNRESOLVED_DIFFERENCES` in the expanded real-process/IPC-path parity matrix (doc 94) will be counted from what real testing actually produces this stage, not from this synthetic fixture.
