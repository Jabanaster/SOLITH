# Phase 1 / Stage 6.1 — Defect Accounting Repair

## Why this exists

Doc 68's Stage 6 defect re-evaluation listed native-path status for Alignment (D03) and int64 (D06) but **omitted their shipping-product rows entirely** — the "Shipping-product defects" table named only AOB and 1 MiB. This repeats, in miniature, the exact class of mistake Stage 5.1 (doc 46) already corrected once (the original Stage 5 accounting wrongly marked the 1 MiB shipping defect "N/A"): a defect's native-path fix must never be allowed to make its shipping-product row silently disappear from the record. This document repairs that omission with freshly re-verified, real evidence — not by copying the prior session's assumptions forward.

## B — Audit 2 defects re-verified against live shipping code (read-only, `G:\ACTIVE_PROJECTS\SOLITH`, default worktree)

**Audit 2's actual baseline commit, verified from ROADMAP.md itself:** `review/gate2-5-doc-audit @ 317baf0e` (ROADMAP.md:33 — not `0432be9`, which is a later, unrelated commit). All git-history checks below are against `317baf0e`, the correct baseline, not the later commit an earlier pass in this investigation initially (and incorrectly) used.

### D03 — forced alignment: still present, confirmed by direct code reading, not just described

`src/core/live-memory/memory-scanner.ts` computes `step = valueSize(dataType)` (`:59` `valueSize()`; e.g. `int32`/`uint32`/`float` → 4, `byte` → 1, `double`/`int64` → 8) and uses that fixed step to advance the scan-candidate offset in **every** scan function: `scanFirstRange` (`:209`, loop `:236`), `scanNextFromSnapshot` (`:390`, loop `:406`), `scanNextFromSnapshotMultiType` (`:534-535`), `scanFirstByComparison` (`:584`, loop `:611`). A direct grep of the file for `alignment`/`bytewise`/`unaligned` returns **zero matches** — there is no mode, flag, or code path anywhere in this file that scans at any granularity other than the value's own natural width. This is the real mechanism the Audit 2 finding's "forced 4-byte alignment" shorthand describes (4 being the width of the most commonly scanned types, `int32`/`uint32`/`float`) generalized correctly to "forced type-width alignment" for every type: any real, genuinely present value sitting at a non-type-width-aligned offset (e.g. inside a packed struct) is silently never checked and never appears as a candidate. Unchanged since the Audit 2 baseline (`git log 317baf0e..HEAD -- src/core/live-memory/memory-scanner.ts` returns zero commits).

### D02/D01 — 1 MiB cap and its silent-skip truth-reporting gap: confirmed present in the CORE scanner, not only in `aob-resolver.ts`

`src/core/live-memory/native-memory-driver.ts:361` still enforces `if (size <= 0 || size > 1048576) { throw ... }` on every `readBuffer` call — unchanged since the Audit 2 baseline (`git log 317baf0e..HEAD` for this file shows only `fb0b180`, a PATH-hijack security fix with no relation to this line, confirmed by direct diff review).

**New, more precise evidence than doc 46 previously scoped:** `memory-scanner.ts` itself — not only `aob-resolver.ts` — calls `driver.readBuffer(handle, region.baseAddress, region.size)` with the **entire** region size in one call, at six separate call sites (`:157`, `:228`, `:355`, `:399`, `:527`, `:603`). Regions are pre-filtered only against `maxRegionBytes` (default 64 MiB), a limit with no relationship to the driver's real 1 MiB per-call ceiling — so any real region between roughly 1 MiB and 64 MiB passes the scanner's own selection filter and then throws inside `readBuffer`. Every one of these six call sites wraps the call in `try { ... } catch { continue; }` (e.g. `:154-159`), silently moving to the next region. Critically, `truncated` — the one flag a caller could check to learn "not everything was covered" — is set only for the caller-configured total-byte budget or match-count cap (e.g. `:167-170`, `:222-225`); **it is never set when a region is skipped for being over the 1 MiB read ceiling.** This is the exact D01 (truth-reporting) mechanism applied to the exact D02 (1 MiB cap) condition, confirmed in the scanner's own primary value-scan path, which is more central to Audit 2's "95.5% of a real game's writable memory unread" finding than the AOB-specific instance doc 46 already recorded. Unchanged since the Audit 2 baseline (confirmed above).

### D06 — int64: still present, confirmed at both the IPC boundary and the decode path

`native-memory-driver.ts:222-224` unconditionally throws on any `int64`/`uint64` read (`memoryjs` returns a JS `bigint` for these types; the guard `if (typeof result !== 'number')` rejects that), re-wrapped at `:227-230`. `electron/live-memory-ipc.ts`'s IPC handlers call `session.readValue(address)` and return a sanitized error response on throw — so `readMemory(...,'int64')` at the IPC boundary always resolves to failure, never a value, exactly as Audit 2 found. Separately, `memory-scanner.ts:106-107`'s `case 'int64': return Number(buf.readBigInt64LE(offset));` performs a silent, lossy `bigint`→`number` narrowing (incorrect above 2^53) when decoding from an already-read buffer — the other half of D06's "lossy above 2^53" finding. `live-memory-session.ts`'s own `compareRollbackValue` independently guards an int64 comparison with `Number.isSafeInteger`, which is itself evidence the codebase already knows this narrowing is unsafe. Neither `native-memory-driver.ts`'s throw nor `memory-scanner.ts`'s narrowing has changed since the Audit 2 baseline (`native-memory-driver.ts`'s only post-baseline commit, `fb0b180`, is the unrelated PATH-hijack fix; `memory-scanner.ts` has zero post-baseline commits at all).

### Production routing confirmed unchanged (PRODUCTION SCANNER SWITCHED: NO)

`native/solith-scanner-napi` does not exist in this worktree at all — the only native/Rust component present in the default `SOLITH` worktree is the unrelated `solith-readonly-scanner.exe` helper (used solely for one narrow read-only pointer-validation path, `headless-verification.ts`'s `VALIDATE_POINTER_L2_READONLY`, never for scanning). A full grep of `src/core/live-memory/` and `electron/` for any reference to the native scanner crate returns nothing. Production scan/read/write routing goes exclusively through `memory-scanner.ts` + `native-memory-driver.ts`'s `memoryjs`-backed driver, exactly as every prior stage's accounting already stated.

## C — corrected defect states

| Defect | Native path | Shipping product | Reasoning |
|---|---|---|---|
| 1 MiB cap (D02) | `NATIVE_PATH_FIXED` | `PRODUCT_DEFECT_NOT_YET_CLOSED` | Re-confirmed live and unchanged in `native-memory-driver.ts`/`memory-scanner.ts`, this session, independent of doc 46's original (narrower) finding |
| Alignment (D03) | `NATIVE_PATH_FIXED` | `PRODUCT_DEFECT_NOT_YET_CLOSED` | Re-confirmed live and unchanged in `memory-scanner.ts`; this is the first Phase 1 doc to state the shipping-product row explicitly — Stage 5's doc 44 never covered D03, and Stage 6's doc 68 omitted it |
| AOB (D04) | `NATIVE_PATH_FIXED` | `PRODUCT_DEFECT_NOT_YET_CLOSED` | Unchanged from doc 44/46's original finding, re-confirmed present this session |
| int64 (D06) | `NATIVE_PATH_FIXED` | `PRODUCT_DEFECT_NOT_YET_CLOSED` | Re-confirmed live and unchanged in `native-memory-driver.ts`/`memory-scanner.ts`; this is the first Phase 1 doc to state the shipping-product row explicitly |
| Truth-reporting | `STRUCTURALLY_HARDENED` (native path; Stage 6, docs 59-66) | `PRODUCT_DEFECT_NOT_YET_CLOSED` for every shipping TypeScript scan path (`memory-scanner.ts`'s six untruncated silent-skip sites confirmed above are the concrete, current instance of this) | Native-path hardening does not touch a single line of shipping TypeScript this stage |
| Pointer depth/truncation (D05) | Not in Stage 5 or Stage 6 scope | **Retained unchanged: `Not yet closed`** (doc 44's own wording, P1-SCAN-001) | Neither stage touched pointer-scanning code; this status must not be read as closed by anything in Stage 5 or 6 |

**Why "N/A" was incorrect (for the pattern this repair generalizes):** Stage 5.1 already corrected one instance of this mistake (the 1 MiB shipping row). Stage 6's doc 68 repeated the same *shape* of mistake for two different defects (Alignment, int64) by omitting their shipping-product rows rather than writing "N/A" — the omission has the identical practical effect of making a reader believe the item was closed or never applicable. Per this mission's explicit rule (§D): `NATIVE_PATH_FIXED` never implies `PRODUCT_DEFECT_CLOSED`; a product-level defect closes only after production routing uses the native implementation, parity is verified, shipping tests exercise the new path, and the old implementation is no longer authoritative — none of which has happened for any defect in this table.

**Production migration dependency:** every `PRODUCT_DEFECT_NOT_YET_CLOSED` row above depends on the same, single, not-yet-scheduled event: production routing switching from `memory-scanner.ts`/`native-memory-driver.ts` to the native Rust scanner, with parity verification and shipping-test coverage — Stage 7's stated objective, not attempted in Stage 6 or this repair.

## E — FNV-1a wording review

Reviewed every Stage 6 evidence document and the `session_snapshot.rs` source for language implying a security property the checksum does not provide. Doc 63 (§6.11) already used "non-cryptographic" language but described a mismatch as "tampered... content," which reads as an adversarial-defense claim; corrected to "accidentally corrupted or manually/hand-edited content," and the surrounding sentence now explicitly states the checksum provides no authentication, tamper protection, or security-signing property, and names what would be needed (an HMAC or digital signature) if such a guarantee is ever required. `session_snapshot.rs`'s `SessionSnapshot` struct doc comment said "integrity-checked," which in isolation (without the neighboring `fnv1a64` function's own correct caveat) could be read the same way; corrected to "checksum-verified" with an explicit pointer to `fnv1a64`'s documented, narrow scope. No other document or comment was found using cryptographic/authentication/tamper-protection/security-signing language. **No implementation change was made or needed** — `fnv1a64`'s behavior, `ErrorKind::CorruptSnapshot`'s meaning, and every test already correctly reflect a non-cryptographic corruption check; only prose describing it was corrected.

## F — verification result

No production/native source was modified — this repair is evidence-only plus two doc-comment wording corrections in `session_snapshot.rs` (no behavior change). Focused verification, run to prove no repository drift:

- `cargo fmt --check` (scanner core): clean.
- `cargo test --release --lib session_snapshot` (scanner core): 11/11 pass, unchanged.
- `cargo test --release` (scanner core, full suite): 185/185 pass, unchanged.
- `cargo build` (scanner core) + `cargo build --release` (napi): both succeed.
- `node --test test/session.test.js` (napi): 14/14 pass + 1 documented skip (the `--expose-gc`-gated test), unchanged.

A full fresh-worktree rerun was not performed, per this mission's own instruction ("If no source changed, full fresh-worktree rerun is NOT required") — no `native/` production/behavioral source changed, only two Rust doc comments and this evidence set.
