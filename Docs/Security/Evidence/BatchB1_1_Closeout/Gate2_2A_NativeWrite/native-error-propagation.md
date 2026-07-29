# Native Error Propagation — Gate 2.2A

## memory.h

Every `writeMemory` overload now returns `bool` (previously `void`):

```cpp
template <class dataType>
bool writeMemory(HANDLE hProcess, DWORD64 address, dataType value, DWORD* lastError = nullptr) {
  SIZE_T bytesWritten = 0;
  BOOL ok = WriteProcessMemory(hProcess, (LPVOID)address, &value, sizeof(dataType), &bytesWritten);
  bool success = ok && bytesWritten == sizeof(dataType);
  if (lastError) *lastError = success ? 0 : GetLastError();
  return success;
}
```

A **short write** (partial `bytesWritten`) is treated as failure, not partial success — matching
the "treat a short write as failure" requirement exactly. The buffer/string overload and the
`char*` overload (used by `writeBuffer`, the byte-level rollback path) received the identical
treatment.

## memoryjs.cc

- `writeMemory` (scalar types: int8..double, ptr/uptr, bool, string, vector3/4): every branch now
  captures the returned `bool` into a shared `writeSucceeded` flag and the Win32 error into
  `writeLastError`. After the type-dispatch chain, if `writeSucceeded` is false, a
  `Napi::Error` is thrown with message `write_failed:<win32ErrorCode>` instead of returning
  `env.Null()` (silent success).
- `writeBuffer`: same treatment, one call site.
- `openProcess`: unchanged error path (still throws/callback-passes `errorMessage` on failed
  process open) — Gate 2.2A only added the write-capable-handle option here, not new error
  handling, since process-open failure was already surfaced correctly.

## What the JS-facing error contains (and does not contain)

The thrown error string is exactly `write_failed:<decimal Win32 error code>` — e.g.
`write_failed:5` for `ERROR_ACCESS_DENIED`. It contains:
- A stable string prefix (`write_failed:`) callers can pattern-match on.
- The native Win32 error number, useful for diagnosing environment/permission issues.

It never contains: the memory value being written, the target address, consent tokens, full
executable paths, or any other process's information. `native-memory-driver.ts`'s `writeMemory`
wrapper (unchanged in this respect) already wraps native errors in its own message template
(`writeMemory(${address}, ${dataType}, ${value}) failed: ${err.message}`) — that outer message
does include the address/value/dataType for the operation the *caller itself* requested, which is
not a new disclosure (the caller already knows what it asked to write); only the *native* error
detail was previously silently absent and is now the Win32 code, nothing more.

## Downstream propagation (live-memory-session.ts) — unchanged, now actually exercised

`confirmWrite` and the freeze tick handler already had `try { this.driver.writeMemory(...) } catch { ... }`
blocks that correctly treat a thrown write error as failure (`confirmWrite` returns
`{ success: false, error: ... }`; the freeze tick calls `stopFreezeInternal('write_failed')`).
Before this fix, that `catch` block was simply never reached because the native layer never threw.
No changes were needed in `live-memory-session.ts` itself — its error-handling was already
correct; it was starved of the failure signal it needed.
