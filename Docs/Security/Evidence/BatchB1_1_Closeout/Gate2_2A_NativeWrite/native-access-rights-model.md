# Native Access-Rights Model — Gate 2.2A

## Final model

`process::openProcess(pid, errorMessage, requestWriteAccess = false)` (process.h/process.cc):

| requestWriteAccess | Rights requested |
|---|---|
| `false` (default) | `PROCESS_QUERY_INFORMATION \| PROCESS_VM_READ` (unchanged from before this fix) |
| `true` | `PROCESS_QUERY_INFORMATION \| PROCESS_VM_READ \| PROCESS_VM_WRITE \| PROCESS_VM_OPERATION` |

`PROCESS_ALL_ACCESS` is never requested anywhere in this code path.

## JS binding surface

`memoryjs.cc`'s `openProcess` N-API binding keeps its original 1-argument and
2-argument-with-callback signatures unchanged (backward compatible), and adds a third
accepted shape: a 2nd argument that is a `boolean` (not a function) requests a write-capable
handle. This is additive — no existing call site's behavior changes unless it explicitly opts in.

## Why the single handle gets both read and write rights

`native-memory-driver.ts`'s `openProcess(pid)` always calls `mem.openProcess(pid, true)`. This
driver's one handle serves the entire live-memory session lifecycle for an attached process —
read, scan, propose-write, freeze — so the handle that will read is the same handle that will
later write. There is no separate read-only "discovery" handle in this architecture to leave
unprivileged; the alternative (opening a second, read-only handle for scan/read operations and a
distinct write-capable handle only for confirmWrite/freeze) was considered but rejected as
unnecessary complexity for a single-session, single-handle design, and out of scope for a narrow
remediation — flagged in remaining-risks.md as a possible future hardening, not a defect.

## What stays read-only

- `process::openProcess(name, errorMessage)` / `openProcess(pid, errorMessage)` calls with the
  default (`requestWriteAccess` omitted) keep the original read-only rights. No existing call
  site in this codebase passes `true` except the one added in `native-memory-driver.ts`.
- `getProcesses()`'s internal enumeration handles (used only to read process name/PID for listing,
  never kept or written through) are untouched — still `PROCESS_QUERY_INFORMATION | PROCESS_VM_READ`.
- Read-only discovery paths (`listLiveMemoryProcesses`, AOB/pointer scanning) do not request write
  access — they operate on process enumeration or on the session's already-open read+write handle,
  neither of which needed a rights change for read behavior.
