# Remaining Risks — Gate 2.2A

## R-2.2A-001 (packaged/Electron-ABI addon not yet rebuilt with this fix)

The rebuilt native addon (`vendor/memoryjs-3.5.1-patched/build/Release/memoryjs.node`,
SHA256 in `native-binary-hashes.csv`) was built and verified against **Node 22.23.1**, the
trusted dev/test runtime. It was **not** rebuilt against Electron's ABI, and no packaged
(`dist:dir`/electron-builder) build was produced this cycle. This means:

- All 18 real-process write/failure/freeze/rollback checks in this report exercised the fix
  under Node 22, not inside the packaged Electron app.
- The packaged app currently in `dist/win-unpacked/` (if any exists from a prior cycle) still
  contains the **pre-fix** native addon and would still silently fail writes.

AcceptanceStatus: Deferred by design — Gate 2.2A's authorization explicitly scoped this
remediation to the native write path and its Node-ABI verification, and explicitly prohibited
resuming Gate 2.2's remaining packaged-lifecycle scenarios. Packaging + Electron-ABI rebuild +
packaged-smoke re-verification is the natural first step of any resumed Gate 2.2.

## R-2.2A-002 (single-handle read+write design, not read/write-separated per call site)

`native-memory-driver.ts` always requests a write-capable handle at attach time, even for
sessions that end up only reading. This is the minimum viable model given the current
single-handle-per-session architecture (see `native-access-rights-model.md`) — not
`PROCESS_ALL_ACCESS`, and strictly less than before would have been if a naive fix had just
added write rights to every handle including the enumeration-only ones in `getProcesses()`
(which remain read-only, unaffected). Splitting into a distinct read-only handle for pure-read
operations and a separate write-capable handle only for confirmWrite/freeze was considered and
rejected as unnecessary scope expansion for a narrow remediation.

## R-2.2A-003 (failure-mode tests for "no rollback record after failed write" / "freeze stops after repeated write failure" verified by code inspection, not a fresh live-process test this cycle)

`confirmWrite`'s and the freeze tick handler's `try/catch` around `driver.writeMemory` were
already correct and already unit-tested (Gate 2, `FakeMemoryDriver`-based). Gate 2.2A's fix was
making the *native* layer actually throw on failure so that pre-existing catch logic is reached —
proven indirectly by the "read-only handle fails closed" and "unmapped address rejected" tests
(both now correctly throw). A fresh end-to-end test forcing `confirmWrite` to hit a native
failure against the real fixture (e.g. via a deliberately read-only-reopened handle mid-session)
was not separately built this cycle; classified low-risk since the throw-vs-swallow behavior is
what was fixed and is directly proven by the failure-matrix tests already run.

## Final Gate 2.2A verdict

GATE 2.2A NATIVE WRITE REMEDIATION PASS.

All required outcomes met:
- Correct minimum access rights (VM_WRITE|VM_OPERATION only when requested; never ALL_ACCESS).
- WriteProcessMemory failures and short writes detected (bytesWritten check) and propagated as
  `write_failed:<code>` — no memory values/addresses/tokens/paths exposed.
- Real fixture write succeeds through `nativeMemoryDriver` (was previously silent no-op).
- Real fixture restore succeeds.
- Failed writes never report success (read-only-handle and unmapped-address tests both throw).
- Real freeze behavior proven (applies, restores after external mutation, stops cleanly).
- Real rollback behavior proven (restores original value, single-use, refuses to clobber an
  intervening external change).
- No unrelated process touched (only the dedicated fixture and non-existent test PIDs).
- Full regression: `npm test` 1040/1040, `test:live-memory` 257/257, main TypeScript 0
  diagnostics, Electron TypeScript 31/13 unchanged baseline, `git diff --check` unchanged
  (GameLibrary.tsx only).
- Evidence complete under `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2A_NativeWrite/`.

Not yet done (see R-2.2A-001): packaged/Electron-ABI rebuild and packaged-smoke
re-verification — required before Gate 2.2's remaining packaged-lifecycle scenarios resume, and
before any packaged build is treated as containing this fix.

BATCH B1.1 remains: **BATCH B1.1 CONDITIONAL PASS**. This investigation identified and fixed a
real silent-write-failure defect in the dev/test-verified native path; it does not by itself
prove an *exploitable* authorization or safety regression in the packaged app (the packaged app's
pre-fix addon fails writes closed/silently rather than writing somewhere unauthorized — a
correctness/reliability defect, not a privilege-escalation or unauthorized-write-target defect),
so FAIL is not warranted. The B1.1 conditional-pass conditions from Gate 2/2.1 (unrelated Electron
TypeScript baseline, unrelated GameLibrary.tsx whitespace, and now R-2.2A-001) all remain open,
narrowed, not reversed.

Gate 2.2 may resume for its remaining packaged-lifecycle scenarios (feature-disable mid-freeze,
window-identity/navigation) once the packaged/Electron-ABI rebuild is done and packaged-smoke is
re-verified against it — that rebuild-and-smoke step is the exact next milestone.
