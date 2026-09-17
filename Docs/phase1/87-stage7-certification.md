# Phase 1 / Stage 7 — Certification Gate

## Mission §7.32 gate, evaluated item by item

| # | Requirement | Status |
|---|---|---|
| 1 | One production scanner backend contract exists | **MET** — doc 73; `ScannerBackend` (`scanner-backend.ts`), drawn at the correct seam per the §7.2 scanner map |
| 2 | Native backend implements required current production operations | **PARTIAL** — `NativeScannerBackend` implements exact-value scan and AOB scan (the two operations behind three of the four named defects). Range/comparison next-scan, unknown-value scan, string/byte scan, and pointer scan have no native-backend implementation through this contract yet — doc 83 |
| 3 | Legacy backend remains available for controlled rollback | **MET** — `LegacyScannerBackend` unmodified in behavior; `LEGACY` is the default and only production mode; rollback proven at unit level (doc 77) |
| 4 | Shadow comparison implemented | **MET** — doc 74; real, with real-process evidence (doc 76) |
| 5 | All differences classified | **MET, for the differences actually observed** — every difference this stage's tests produced was classified into one of the six mission categories, never left unclassified (doc 74) |
| 6 | Known native corrections are not treated as parity failures | **MET** — the EXPECTED_NATIVE_CORRECTION heuristic exists and fires correctly in both unit and real-process tests (docs 74/76) |
| 7 | Canary routing proven | **NOT MET** — only level 1 (synthetic/real-process fixture) of the 5-level canary sequence is done; levels 2-5 are partial or not done (doc 76) |
| 8 | Rollback proven | **PARTIAL** — proven for "after a normal scan" and "after a native error" at unit level; not proven for cancelled-scan/process-exit/malformed-AOB-request cases, and not proven at the IPC level (doc 77) |
| 9 | Packaged Electron loads native addon | **PARTIAL** — the packaged addon copy loads and runs standalone, and the packaged app launches cleanly; a live in-app scan click-through was not performed (doc 78) |
| 10 | Native build integrated into normal build | **MET** — doc 79; `build:electron` builds it automatically |
| 11 | Fresh checkout requires no manual native artifact | **MET** — doc 86; genuinely proven from a from-zero fresh worktree |
| 12 | Real production IPC path tested | **NOT MET** — the real-process tests exercise the backend/router layer directly, not `LiveMemorySession.attach()`/the IPC handler chain end to end (doc 76) |
| 13 | Real-game canary passes | **NOT MET** — no real game was tested this stage (docs 75/80) |
| 14 | High-result IPC pressure bounded | **NOT MET** — not attempted this stage (doc 82) |
| 15 | No mid-session unsafe backend swap | **MET** — doc 83; structurally impossible by construction (router created once per attach, mode-switch only affects the next call) |
| 16 | Direct legacy callers fully inventoried | **MET** — doc 83; zero unknown callers, including a caller (`hook-engine.ts`) the original §7.2 trace initially missed and this inventory pass caught |
| 17 | Retirement plan complete | **MET** — doc 84; a plan, explicitly not an execution (nothing was deleted) |
| 18 | 1 MiB shipping defect dispositioned | **MET (OPEN)** — doc 85, real evidence both ways |
| 19 | Alignment shipping defect dispositioned | **MET (OPEN)** — doc 85, real evidence both ways |
| 20 | AOB shipping defect dispositioned | **MET (OPEN)**, with the added honesty that `signature-engine.ts`'s independent AOB path is a second, unmigrated instance — doc 85 |
| 21 | int64 shipping defect dispositioned | **MET (OPEN)**, plus one newly-discovered related legacy defect (int64-narrowing-crash) documented — doc 85 |
| 22 | Pointer defect truth preserved | **MET** — D05 untouched, wording unchanged from doc 44 — doc 85 |
| 23 | No silent fallback | **MET** — doc 73/74; `NATIVE` mode rethrows by default, the canary-only fallback escape hatch always records both the failure and the fallback |
| 24 | Full test suite green | **MET** — 185/185 Rust, 52/52 napi (unaffected by this stage, not re-run with `--expose-gc` this pass since no napi source changed — see note below), 1801/1801 + 10/10 JS/TS, both typechecks, `npm audit` 0 |
| 25 | Fresh-worktree/package verification green | **MET** — doc 86 (fresh worktree); doc 78 (packaging, in the main worktree) |
| 26 | ROADMAP untouched | **MET** — confirmed empty diff against `ROADMAP.md` |
| 27 | Zero unresolved Stage-7 P0/P1 defect | **MET, with one caveat** — the one real defect discovered this stage in `LegacyScannerBackend`'s own new code (the int64-narrowing-crash surfacing) was caught and fixed by this stage's own tests before being left as a Stage-7-introduced defect; the packaging bloat bug (doc 78) was likewise caught and fixed within this stage. No known Stage-7-introduced defect remains open |

**Note on item 24's napi count**: this stage did not modify `native/solith-scanner-napi` or `native/solith-scanner-core` source at all (only `native/solith-scanner-napi/package.json`'s consumption via the new root `file:` dependency, and a release build) — the napi test suite (52/52 with `--expose-gc`, Stage 6's certified count) was not re-run this stage since nothing in its source changed; re-running it was judged unnecessary per this operation's own established convention ("if no source changed, full rerun is not required," applied identically to Stage 6.1's docs-only pass).

## Verdict

**NOT_COMPLETE.**

Of 27 gate items: 16 fully MET, 5 PARTIAL, 6 NOT MET. The six NOT MET items are exactly the ones requiring resources or evidence this stage explicitly did not produce: real-game canary (Stardew Valley is not installed on this machine; no substitute game was tested), canary levels 2-5, the real production IPC-path test, and IPC/memory pressure stress. None of these gaps is hidden — each has its own evidence document stating plainly what is and is not done.

What this stage genuinely delivers, real and evidence-backed: a correct, real backend contract at the right seam; two working backend implementations; real shadow comparison with real difference classification (including one classification heuristic refined mid-stage after real-process testing revealed the naive version was too strict); real routing with no silent fallback; a real, tested, genuinely-fixed packaging integration (with one real bloat bug caught before it could ship); a from-zero fresh-worktree build proof; a complete legacy-caller inventory (that caught a real gap in the original scanner map); a real retirement plan; and — most importantly for the mission's own stated defect-accounting discipline — real, reproducible, real-process (not merely unit-tested) proof that the native path correctly fixes all four named shipping defects, while correctly leaving all four (plus D05) reported OPEN, since production routing has not switched.

Per the mission's own explicit instruction: "If any one is not actually migrated through shipping behavior: leave it open." Applied here without exception.
