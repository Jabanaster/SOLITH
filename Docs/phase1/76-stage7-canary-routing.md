# Phase 1 / Stage 7 — Canary Routing

## §7.15 — canary sequence status

| Level | Status | Evidence |
|---|---|---|
| 1. Synthetic fixture | **Done** | `tests/live-memory/scanner-backend-real-process.test.ts`, 3/3 real-process tests against the actual `solith-scanner-fixture.exe` (the same Rust-crate fixture Stages 1-6 already certified against), attaching BOTH the real legacy driver (`nativeMemoryDriver`, real memoryjs) and the real native addon to the same real PID |
| 2. Production integration test harness | **Partial** | The real-process tests exercise `LegacyScannerBackend`/`NativeScannerBackend`/`ScannerBackendRouter` directly — the actual Stage 7 production seam — but do NOT go through `LiveMemorySession.attach()`/the IPC layer/`requireTrustedSender` end to end. The full attach-authorization/online-guard/protected-target-guard chain was not re-exercised with a real process through this new routed path this stage |
| 3. Packaged app | **Partial** | See doc 78: the packaged addon copy loads and functions standalone (`debugEchoU64` proof); the packaged Electron app (`dist/win-unpacked/Solith.exe`) launches cleanly with no crash. A live, in-app "attach + click scan while packaged" GUI walkthrough was NOT performed |
| 4. Stardew Valley | **Not done** | Not installed on this machine — see doc 75 |
| 5. Additional real game(s) | **Not done** | See doc 75 |

**Native is not made globally authoritative** — the default `ScannerBackendRouter` mode remains `LEGACY` for every `LiveMemorySession`; nothing in this stage changes shipping behavior for a real user. This satisfies mission §7.15's "do not make native globally authoritative before canary passes" by construction, not merely by claim: canary genuinely has not passed levels 2-5, so LEGACY remaining the default is the only honest state.

## Real-process defect-closure evidence (the actual content behind "canary level 1")

Three real-process tests, each against a fresh spawn of `native/solith-scanner-core/target/release/solith-scanner-fixture.exe`:

1. **1 MiB defect (D02)** — a real 4 MiB `VirtualAlloc`'d region with a `u32` sentinel (`0xCAFEBABE`) planted at offset 1,500,000 (>1 MiB). `LegacyScannerBackend.exactScan` against the real process genuinely misses it (`legacy metrics` in the test's diagnostic output: `regionsConsidered: 44, regionsRead: 41, regionsSkipped: 3` — three real regions silently skipped, confirmed via the independent region-recount added to `LegacyScannerBackend` this stage) and reports `complete_with_skipped_regions`, never a false `complete`. `NativeScannerBackend.exactScan` against the same real process finds the sentinel at its real address. `ScannerBackendRouter` in `SHADOW_COMPARE` mode classifies the disagreement `EXPECTED_NATIVE_CORRECTION`.
2. **Alignment + int64 defects (D03 + D06)** — the real, unaligned (offset 449) `i64` value the fixture plants (`-9,000,000,000,000,000,000`, magnitude ~9.46×10^18). Legacy's `scanFirst` never considers offset 449 a candidate at all (8-byte-stride alignment), so it is not found — proving D03 concretely, not just by code inspection. Native finds it and returns the exact value as `valueBigint`, proving both the alignment fix and D06's BigInt-exactness simultaneously for this real value.
3. **AOB defect (D01/D04)** — a real 5-byte pattern (`DE AD C0 DE 42`) the fixture plants 6 MiB into a real 8 MiB region. `LegacyScannerBackend.aobScan` (via `aob-resolver.ts`'s real `scanAobInProcess`) misses it; `NativeScannerBackend.aobScan` finds it at its exact real address.

All three tests skip cleanly (not a failure) if the fixture binary or the native addon is not built — they prove real behavior, they do not build their own prerequisites.
