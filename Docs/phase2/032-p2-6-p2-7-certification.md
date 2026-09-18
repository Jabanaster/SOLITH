# Phase 2 P2-6 / P2-7 — Typed Memory View + Value/Type Inference: Certification

Worktree `G:\ACTIVE_PROJECTS\solith-phase2-p2-6-through-p2-9`, branch `feature/solith-phase2-p2-6-through-p2-9`. Starting HEAD `d3c755a` (== `origin/master` at mission start).

See `Docs/phase2/031-p2-6-p2-9-authoritative-requirement-matrix.md` for the full requirement audit and the real ROADMAP-vs-SOLITH.MD checkpoint-split reconciliation (P2-8 = memory map + watchlists; P2-9 = freeze/write/revert + address-validation/hotkeys, per `ROADMAP.md` lines 309-315 — not SOLITH.MD's own guessed split).

## Cross-cutting fix (mission §3), closed first

Root cause of P2-5's disclosed post-exit stale-read finding: `native-memory-driver.ts`'s `readMemory`/`readBuffer`/`readPointer`/`writeMemory`/`writeBuffer` never re-validated process liveness before delegating to memoryjs. Windows keeps a process's kernel object — and its mapped memory — alive for as long as any HANDLE reference exists, including this driver's own `openProcess` handle; `ReadProcessMemory`/`WriteProcessMemory` never re-check that independently. `getModules`/`getRegions` never showed the symptom because memoryjs backs them with a different, OS-process-table-backed API. Fixed with a cheap `process.kill(pid, 0)` liveness probe (queries the live OS process table directly) as the first check in every raw read/write primitive — `native-memory-driver.ts`. PID-reuse-safe identity re-verification remains `LiveMemorySession.verifyAttachedProcessIdentity()`'s job on write/freeze/revert (already present pre-mission, confirmed by audit, too expensive to run per-read). Proven with a real spawned-and-killed fixture process (`tests/live-memory/native-memory-driver-liveness.test.ts`): every one of the 5 primitives now fails promptly and truthfully (`PROCESS_EXITED:` prefix) instead of the previously-observed unbounded-success window.

## P2-6 — Typed memory-view expansion

- Canonical model: `src/core/live-memory/typed-memory-view.ts` — builds directly on P2-5's `FieldInterpretation`/`decodeInterpretations` (structure-interpretation.ts), not a second decode engine. Added one new interpretation kind, `utf8` (structure-interpretation.ts's `decodeUtf8Candidate` — only reported for genuinely multi-byte-encoded text, never duplicating a pure-ASCII reading), extending `FieldInterpretation.kind` additively.
- Supported types: `u8, i8, u16, i16, u32, i32, u64, i64, f32, f64, pointer, ascii, utf8, utf16` plus raw bytes (`rawHex`, always present, not a separate interpretation kind). 64-bit values are bigint-exact end-to-end (`readBigUInt64LE`/`readBigInt64LE`, decimal-string display) — no `Number()` coercion anywhere in the read or display path.
- Service: `LiveMemorySession.readTypedValue/readTypedValues/refreshTypedValue/reinterpretValue` (live-memory-session.ts) — one session, no parallel subsystem. `reinterpretValue` performs zero I/O (pure recompute from an already-known `rawHex`).
- IPC/preload/types: `typed-view:read|read-many|refresh|reinterpret` (`electron/live-memory-ipc.ts`, schemas in `electron/ipc-validation.ts` — `TypedViewReadSchema` et al., width restricted to `{1,2,4,8}`, batch capped at 32), `electron/preload.ts`, `src/types/global.d.ts`.
- UI: `src/app/components/TypedMemoryViewPanel.tsx`, mounted in `LiveMemoryTrainerPage.tsx` next to `StructureDiscoveryPanel` — address/length inputs, Read/Refresh/Reinterpret buttons, a per-width interpretation table, and a raw-hex edit field feeding the pure reinterpret path.
- Focused tests: `typed-memory-view.test.ts` (10/10), `live-memory-session-typed-view.test.ts` (5/5).
- Real fixture: reuses P2-5's already-certified `STRUCT_REGION` plant (exact known int32/float32/u64/pointer/mutable-int32/raw-bytes/ASCII/unaligned values) — no `fixture.rs` change needed. `typed-memory-view-real-process.test.ts`: byte-exact/type-exact verification of every supported type against real known values, a real live-mutation-then-refresh cycle, and failure injection (unmapped address, oversized batch, malformed rawHex, invalid length). **10-restart stress: 10/10** (inside the main test). **Independent full-file certification: 3/3.**
- Real-game proof: Godlike Burger, production attach, PID 25920, module base `0x7ff6a8db0000`. Read 8 bytes at the module base; the `u16` interpretation decoded `23117` (`0x5A4D`, the real PE DOS-header magic `"MZ"`) — exact match against independently-known ground truth. **PASS.**

## P2-7 — Value/type inference

- Model: `src/core/live-memory/value-type-inference.ts`. Reuses P2-5's `FieldConfidence` (`low`/`medium`/`high`) as the confidence vocabulary rather than inventing a second one (ROADMAP's own text permits "repository-equivalent"). Behavior candidates: `stable`, `monotonic_increasing`, `monotonic_decreasing`, `bounded_float`, `pointer_stable`, `string_like`, `volatile_unknown` — never a semantic field name, always ranked with confidence, never invented certainty (fewer than 2 readable observations yields zero candidates, period).
- Evidence source: an already-discovered structure's own captured snapshot history (P2-5's `structureCaptureSnapshot`/`structureListSnapshots` — no new capture mechanism, per mission §13). `LiveMemorySession.inferStructureBehavior(structureId)` sorts snapshots chronologically and decodes each field's byte slice per observation.
- IPC/preload/types: `inference:infer-structure-behavior` (read-only, no live memory access of its own — pure computation over already-captured session state).
- UI: an "Infer Behavior (P2-7)" button and results table added to `StructureDiscoveryPanel.tsx` (same panel, not a second app — inference is naturally a view over the same structure+snapshot state already tracked there).
- Focused tests: `value-type-inference.test.ts` (11/11 — stability, both monotonic directions, repeated-tick tolerance, bounded-float, string-like, volatile-unknown fallback, failed-snapshot exclusion, multi-field structure), `live-memory-session-inference.test.ts` (3/3).
- Real fixture: `value-type-inference-real-process.test.ts` — real fixture, real `writestruct` mutation sequence driving `STRUCT_MUTABLE_I32` strictly upward across 5 real captured snapshots, correctly inferred `monotonic_increasing`; a real never-mutated field correctly inferred `stable`; a single real snapshot correctly yields zero claims; an unknown structure id is a truthful IPC failure. **Independent full-file certification: 3/3, all clean.**
- Real-game proof: same Godlike Burger session as P2-6, 3 real snapshots of the static PE header 1.5s apart via the production `structureCaptureSnapshot`/`inferStructureBehavior` path — every field correctly inferred `stable` (the truthful outcome for immutable header bytes, not a defect; no fabricated volatility). Recorded honestly as `READ_ONLY_TYPED_VIEW_AND_INFERENCE_PROOF`, matching P2-5's own precedent for titles with no semantically-controlled field available.

## Regression (post P2-6/P2-7, primary worktree)

| Gate | Result |
|---|---|
| `native-memory-driver-liveness.test.ts` | 1/1 (real process, real kill) |
| `typed-memory-view.test.ts` | 10/10 |
| `live-memory-session-typed-view.test.ts` | 5/5 |
| `typed-memory-view-real-process.test.ts` | 3/3 file runs, 10/10 fixture-restart stress inside run 1 |
| `value-type-inference.test.ts` | 11/11 |
| `live-memory-session-inference.test.ts` | 3/3 |
| `value-type-inference-real-process.test.ts` | 3/3 file runs |
| `test:live-memory` (full group, includes all of the above) | 612/612, 0 failed, 1 intentional skip |
| Renderer typecheck | PASS |
| Electron typecheck | PASS |
| `structure-discovery.test.ts` + P2-5 real-process/session suites (regression check for the additive `utf8`/liveness changes) | 24/26 pass, 2 intentional skip, 0 fail |

One transient `test:live-memory` run earlier in this stage reported 1 failure with no identifiable failing test name in the captured tail (a background `npm ci`/native-build process was still finishing on the same host at that moment) — root-caused as host contention, not a code defect, per this project's own established precedent (ROADMAP doc 013). A subsequent isolated re-run, and every run since, is clean (612/612, 0 failed, 1 skipped, real exit code 0 verified directly, not through a piped `tail`).
