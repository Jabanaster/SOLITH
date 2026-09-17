# Phase 1 / Stage 6 — Defect Status Re-evaluation

## §6.26 — native-path defects, re-evaluated

| Defect | Native-path status | Reasoning |
|---|---|---|
| 1 MiB / coverage cap | `NATIVE_PATH_FIXED` (unchanged) | No cap exists in the native chunked-read path; the mid-scan region-mutation tests (doc 66) additionally prove the native path handles regions changing state without silently under-reporting coverage |
| Alignment | `NATIVE_PATH_FIXED` (unchanged) | `AlignmentMode::{Bytewise, AlignedToType}` correctness is unaffected by this mission; `AlignmentMode::label()`/`from_label()` were added purely for session-snapshot serialization, not a behavior change |
| AOB | `NATIVE_PATH_FIXED` (unchanged) | Stage 5.4 certified the grammar; this mission's `is_authoritative_absence` wiring and region-mutation tests add hardening evidence around AOB scans specifically (`one_hundred_repeated_aob_scans_do_not_leak_handles`, the AOB-scan authoritative-absence proofs) without changing matching behavior |
| int64 | `NATIVE_PATH_FIXED` (unchanged) | BigInt round-tripping (`debug_echo_u64`, session refinement's u64-beyond-safe-integer tests) is unaffected by this mission |
| Truth-reporting | **Structurally hardened this mission** | The completeness/authoritative-absence/cancellation/stale-target/cleanup contracts (docs 59-66) are now centralized, tested across every scan surface, and proven under real region mutation and real concurrent use — not a new claim of correctness, but broader, deeper, real-process evidence for the truth-reporting guarantee Stage 1-5 already established |

## Shipping-product defects

**Corrected by Stage 6.1 (doc 71):** this table originally omitted the Alignment, int64, and Truth-reporting shipping-product rows entirely — an incomplete accounting that repeated the shape of Stage 5.1's own already-corrected "N/A" mistake (an omitted row reads the same as "closed" to anyone scanning the table). Doc 71 re-verified every row below directly against live shipping code, not assumption.

| Defect | Shipping-product status | Reasoning |
|---|---|---|
| AOB (D04) | `PRODUCT_DEFECT_NOT_YET_CLOSED` (unchanged) | The production `aob-resolver.ts` migration is out of Stage 6's scope, per the mission's own explicit "do not switch production scanner" instruction |
| 1 MiB (D02) | `PRODUCT_DEFECT_NOT_YET_CLOSED` (unchanged) | Same reasoning — remains open until production migration, tracked since Stage 5's own doc 44; doc 71 additionally confirms the same silent-skip mechanism in `memory-scanner.ts`'s core value-scan path, not only `aob-resolver.ts` |
| Alignment (D03) | `PRODUCT_DEFECT_NOT_YET_CLOSED` | **Row added by doc 71** — `memory-scanner.ts` still steps every scan by the value's own fixed type-width (`valueSize(dataType)`) with no bytewise/unaligned mode anywhere in the file, confirmed live and unchanged since the Audit 2 baseline |
| int64 (D06) | `PRODUCT_DEFECT_NOT_YET_CLOSED` | **Row added by doc 71** — `native-memory-driver.ts` still throws on any int64/uint64 read, and `memory-scanner.ts` still silently narrows a decoded int64 to a lossy `number`; both confirmed live and unchanged since the Audit 2 baseline |
| Truth-reporting | `PRODUCT_DEFECT_NOT_YET_CLOSED` | **Row added by doc 71** — every shipping scan function's `try { readBuffer(...) } catch { continue; }` never sets `truncated` for a region skipped by the 1 MiB cap; native-path hardening (docs 59-66) does not touch this shipping code at all |

**Zero new native-path defects were found this mission.** The one real correctness bug caught and fixed during this mission's own work (`classify_recovery_status` initially misclassifying an already-exited process as `recoverable_metadata` because it checked only `OpenProcess` success, not `GetExitCodeProcess`/`HandleStatus`) was caught by this mission's own new test before being shipped, and is documented as a design correction in doc 63 §6.12 — it never reached a committed, certified state as a defect, so it is not carried forward as one.
