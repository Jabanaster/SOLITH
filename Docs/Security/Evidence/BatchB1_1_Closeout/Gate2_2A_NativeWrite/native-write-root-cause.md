# Native Write-Path Root Cause — Gate 2.2A

## Defect 1: Insufficient process access rights

`vendor/memoryjs-3.5.1-patched/lib/process.cc`, both `openProcess` overloads (name-based and
PID-based — the PID-based one is what `native-memory-driver.ts`'s `openProcess(pid)` calls)
opened every handle with:

```cpp
OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid)
```

No `PROCESS_VM_WRITE`, no `PROCESS_VM_OPERATION`. Every handle returned by `openProcess` was
structurally read-only at the OS level, regardless of any later write attempt.

## Defect 2: WriteProcessMemory result discarded

`vendor/memoryjs-3.5.1-patched/lib/memory.h`, all `writeMemory` template/overload bodies called
`WriteProcessMemory(...)` and threw the return value away (`void` return type, no bytes-written
check). `lib/memoryjs.cc`'s JS-facing `writeMemory`/`writeBuffer` bindings never inspected any
result either — they always returned `null` (success) to JavaScript no matter what happened
natively.

## Compounding effect

Because of Defect 1, every real `WriteProcessMemory` call against a live-memory-attached process
failed with `ERROR_ACCESS_DENIED` (Win32 error 5). Because of Defect 2, that failure was silent:
JavaScript received no error, no exception, and no signal — `confirmWrite`, `rollback`, and
freeze ticks all reported success while writing nothing. This was first observed directly via the
Gate 2.2 fixture (`Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_2/verify-fixture-real-memory-driver-output.txt`):
`driver.writeMemory` returned normally, but the fixture's independently-observed value never
changed.

## Scope of impact

Confirmed to affect the packaged app's `NativeMemoryDriver` (`src/core/live-memory/native-memory-driver.ts`)
for every live-memory feature that writes: `confirmWrite`, `rollback`, and freeze ticks
(`live-memory-session.ts`). All prior "packaged real-process write/freeze/rollback verified"
claims from Gate 2 and Gate 2.1 were **not** exercising a real write against a real process —
Gate 2's `FakeMemoryDriver`-based rollback tests and Gate 2.1's packaged E2E scenarios never
attempted a real memory write against a real target, only attach/cleanup/identity/crash paths.
No prior evidence document claimed otherwise, but this gap was not previously identified or
disclosed as a distinct risk — it is recorded as new here.
