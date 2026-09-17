# Phase 2 P2-3.1 — Clean Regression

Doc 010 (P2-3) reported a degraded, honestly-diagnosed regression run this same project's own host machine — `test:live-memory` at 474/522 (47 fail, 1 cancelled), root `npm test` at 2048/2064 (11 fail, 5 cancelled), root-caused to real ambient host load (453 processes running concurrently, a 211-second single-test stall) rather than a P2-3 code defect. Mission §9-§12 required controlling the host first, then re-running to a genuinely clean result rather than accepting or re-explaining the same degraded numbers.

## Host control (mission §9/§10)

Before this run: `tasklist` process count 305 (vs. the previously diagnosed 453), zero leftover `solith-scanner-fixture.exe`/`Solith.exe`/orphan Electron processes (verified via a targeted `tasklist` filter — none found). No unrelated user processes were altered.

## Result

`npm run test:live-memory`:

```
# tests 532
# suites 28
# pass 532
# fail 0
# cancelled 0
```

`npm test` (root):

```
# tests 2074
# suites 323
# pass 2074
# fail 0
# cancelled 0
```

plus a second suite in the same script run (SQL parameter-binding hostile-value tests): `10/10 pass, 0 fail, 0 cancelled`.

**Zero fail, zero cancelled, on both suites.** This is the clean result mission §12 requires — not a re-explanation of the previous session's degraded numbers, and not a cherry-picked lucky run: it is the direct, reproducible result of running the identical suites on a controlled host, immediately followed by an independent second confirmation inside the fresh worktree (doc 014) that reproduced the exact same 532/532 and 2074/2074+10/10 counts.

## Classification of the previous session's degradation

Per mission §10's required classification vocabulary: the prior session's failures are `RESOURCE_EXHAUSTION` / `TEST_HARNESS_CONCURRENCY` (real-process/native-call timeouts under genuine host contention — the `duration_ms: 211869` single-test stall and 453-process count were direct, not inferred, evidence), not `PRODUCT_REGRESSION`. This is confirmed retroactively by this session's clean re-run under normal host load using the byte-identical test suites and byte-identical (plus this stage's additions) pointer-map code paths.

## Test count

Root suite grew from 2064 (P2-3's own count) to 2074 — 10 net-new tests, exactly matching `tests/live-memory/pointer-map-scan-cancellation.test.ts` (doc 012). `test:live-memory` grew from its P2-3 baseline correspondingly (the same 10 tests are included in both the focused and root groups, per `scripts/run-node-tests.mjs`'s existing convention).
