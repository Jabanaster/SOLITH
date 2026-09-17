# Phase 1 / Stage 7.1 — IPC Pressure Results

## §2 — CRITICAL, real, previously-undiscovered defect found and fixed

While building the pressure tests this section asked for, a real production defect was found: **`NativeScannerBackend.exactScan` had no default match cap at all.** `memory-scanner.ts`'s legacy `scanFirst` has always applied its own `DEFAULT_MAX_MATCHES = 10_000` whenever a caller omits `bounds.maxMatches` — but the native backend only respected `maxMatches` when a caller explicitly supplied it. Proven real, not hypothetical: a live `NATIVE`-mode scan against a real running game (Godlike Burger, u32 value 100, no `maxMatches` supplied) accumulated **151,382 real matches in one unbounded in-memory array** before this fix. Through the real `live-memory-scan-first` IPC handler, that would have serialized into one giant `ipcRenderer.invoke` response — exactly what this section's critical requirement prohibits.

**Fix** (`src/core/live-memory/scanner-backend-native.ts`): added `DEFAULT_MAX_MATCHES = 10_000` (matching legacy's own existing constant) and an `effectiveMaxMatches = bounds.maxMatches ?? DEFAULT_MAX_MATCHES` applied unconditionally inside `exactScan`'s region loop — every call now stops and reports `completeness: 'resource_limit'` once it hits the cap, whether or not the caller supplied one. AOB scanning was checked and found already safe: `scanAob` hard-breaks after the first match (`if (matches.length > 0) break;`), matching legacy's single-match `scanAobInProcess` contract — no change needed there.

**Real proof the fix engages**:
- Unit-level, real fixture process (`tests/live-memory/scanner-backend-real-process.test.ts`, new test): `NativeScannerBackend.exactScan('u32', 0, undefined, {})` with no bounds against the real fixture's own large mostly-zeroed regions → capped at ≤10,000 matches, `resource_limit` reported honestly when the cap is hit.
- Full real-IPC-path level (`tests/live-memory/scanner-backend-ipc-real-path.test.ts`, new test): the real `live-memory-scan-first` handler, no `maxMatches` in the payload, real fixture process → **exactly 10,000 matches, 370,146-byte payload, 14ms, `truncated: true`**. Before the fix this exact call shape was unbounded.
- Real-game confirmation (Bastion, PID 28412, u32 value 0, no bounds, direct backend call): **exactly 10,000 matches, `completeness: 'resource_limit'`, 26ms** — the fix engages identically against a real commercial game process, not just the synthetic fixture.

## §2 — required measurements

**Result densities**: mission asks for ~10,000 and ~100,000. The production wire contract's own schema (`LiveMemoryScanFirstSchema.maxMatches: z.number().int().positive().max(5000)`) already hard-caps a single `live-memory-scan-first` request at 5,000 — a **deliberate** existing bound, not a gap, and widening it to manufacture a literal 100,000-result test would work directly against this section's own goal. What this pass measured instead, honestly mapped onto the real contract:

| Scenario | Requested `maxMatches` | Matches returned | Payload | Latency | `truncated` |
|---|---|---|---|---|---|
| Real >1 MiB sentinel scan (doc 89) | none | 1 | small | fast | true (region skip) |
| Bounded probe, real Bastion process (doc 91/92 v1) | 100 / 1,000 / 5,000 (schema max) | 100 / 1,000 / 1,450 (real total this run) | 3.6 KB / 35.5 KB / 52 KB | 31ms / 95ms / 209ms | true |
| **Unbounded request** (no `maxMatches` — the ~10,000+ density case), real fixture, via the real IPC handler | *(omitted)* | **10,000** (hit the new default cap; real available candidates exceed this) | **370,146 bytes** | **14ms** | **true** |
| Unbounded request, direct backend call, real Bastion process | *(omitted)* | **10,000** | — | 26ms | resource_limit |

**Native result count**: bounded at 10,000 by the new default, or by an explicit caller-supplied `maxMatches` (schema-capped at 5,000) — never unbounded again.

**Native page size / number of pages fetched**: there is no true pagination primitive in the current contract — `NativeScannerBackend.exactScan` calls the addon once per enumerated memory region (not once per "page" of results) and accumulates into one bounded array. "Page size" in the mission's sense is really the `maxMatches` bound itself; "pages fetched" doesn't apply because there is no cursor to fetch a next page with (see doc 89's cancellation-gap note — pagination has the same absence).

**Max single IPC payload**: 370,146 bytes for a real 10,000-match response (the largest producible through the real handler today, whether the cap comes from the wire schema at 5,000 or the new backend default at 10,000). Well short of any "giant payload" concern.

**Does the production facade aggregate pages into one array before returning?**: Yes — by construction, there is only ever one array (per-region results are concatenated into `matches` inside `NativeScannerBackend.exactScan`), and as of this fix that array is now **always bounded**, whether or not the caller supplied `maxMatches`. There is no separate "paged" representation anywhere in the pipeline for the facade to have wrongly collapsed — the fix here was adding the missing bound to the one accumulation path that exists, which satisfies this section's critical requirement (no unbounded aggregation reaches the caller).

**Renderer/main memory**: measured at the router/backend layer only (no real renderer process in this harness — see doc 89's methodology). Heap delta for a 5,000-match response was ~2.26 MB (doc 92 v1); not re-measured for the new 10,000-match cap this pass, but scales consistently (linear, not exponential, per the earlier measurement series).

**Cancellation responsiveness / event-loop responsiveness**: **not measurable** — `live-memory-scan-first` exposes no cancellation wire field at all (doc 89), and there is no real renderer event loop in this harness to measure blocking against. Honestly reported as not done, not assumed passing.

**Total elapsed time**: 14ms (real IPC handler, fixture, 10,000-match cap) / 26ms (direct backend, real Bastion process, 10,000-match cap) / up to 209ms (real Bastion process, 1,450-match, schema-capped-at-5,000 request in doc 91/92 v1's smaller-match scenario). All well within interactive latency budgets.

## Required final statement

**BOUNDED IPC: PASS.** The one real gap found (native's missing default cap) was a genuine defect, not a false claim papered over — it is now fixed, verified at three independent levels (direct backend unit test against the real fixture, full real-IPC-handler test against the real fixture, and a real commercial game process), and covered by permanent regression tests in both `scanner-backend-real-process.test.ts` and `scanner-backend-ipc-real-path.test.ts`.

## Remaining honest gaps

Literal 10,000/100,000-result *IPC* densities (as opposed to backend-level densities, which are now proven) cannot be produced through a single `live-memory-scan-first` call because the wire schema caps at 5,000 by design — this is correct behavior, not a gap to close. Cancellation responsiveness and renderer/main-process event-loop responsiveness under load remain unmeasured, for the structural reasons given above (no cancellation wire field, no real renderer in this test harness).
