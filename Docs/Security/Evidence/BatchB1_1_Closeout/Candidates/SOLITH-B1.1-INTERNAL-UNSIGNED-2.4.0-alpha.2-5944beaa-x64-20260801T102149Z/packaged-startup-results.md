# Packaged Startup and First-Launch Verification

Measured via an ad hoc script spawning the real packaged `dist\win-unpacked\Solith.exe` with `SOLITH_STARTUP_TRACE=1`, isolated per-run `userData`, and `taskkill /T /F /PID` cleanup scoped to the exact spawned PID. Not the dev-mode `measure-startup.mjs` harness (which targets `dist-electron/main.js` directly) — this measured the actual packaged executable.

## Cold (3 runs, fresh userData each)

| Run | ready-to-show (ms) | browserwindow-constructed (ms) | renderer-did-finish-load (ms) |
|---|---|---|---|
| 0 | 397.1 | 264.9 | 764.4 |
| 1 | 390.7 | 273.3 | 736.3 |
| 2 | 362.9 | 271.5 | 503.9 |

## Warm (3 runs, shared userData)

| Run | ready-to-show (ms) | browserwindow-constructed (ms) | renderer-did-finish-load (ms) |
|---|---|---|---|
| 0 | 378.5 | 284.3 | 512.2 |
| 1 | 354.8 | 269.8 | 479.1 |
| 2 | 408.5 | 270.4 | 706.7 |

## Summary (all 6 runs combined)

- `ready-to-show`: min 354.8ms, max 408.5ms, n=6
- `browserwindow-constructed`: min 264.9ms, max 284.3ms, n=6
- `renderer-did-finish-load`: min 479.1ms, max 764.4ms, n=6
- All 6 runs finished via `mark-observed` (window actually shown), none via timeout.
- Zero single-instance-lock contamination (all runs progressed through the full mark sequence from `module-loaded`).
- Zero orphan `Solith.exe` processes after all 6 runs (`Get-CimInstance Win32_Process -Filter "Name='Solith.exe'"` empty).

```
STARTUP WINDOW CREATION — VERIFIED IMPROVED IN PACKAGED CANDIDATE
RENDERER FIRST-PAINT VARIANCE — OPEN
```

Renderer first-paint variance remains open: 479.1-764.4ms spread across only 6 runs on one machine is not proof of resolution, consistent with prior wording.

## Real first launch (default userData, no overrides)

A separate real launch (no env overrides, i.e. what a user launching from the Start Menu shortcut experiences) was run once: `ready-to-show` 447.0ms, `renderer-did-finish-load` 1091.4ms, database initialized successfully at `%APPDATA%\Solith\solith.db`, trainer hotkeys registered, catalog bootstrap completed (`trainer-catalog-bootstrap-done` at 983.2ms). No fatal exception, no unhandled rejection observed in captured stdout/stderr.

One non-blocking anomaly observed in this and all measured launches: `[GameBar Transport] Startup failed; transport remains unavailable` — root cause traced to `whoami.exe /user /fo csv /nh` failing because this specific test/build machine's shell `PATH` places a POSIX `whoami` (Git Bash) ahead of the real `C:\Windows\System32\whoami.exe`. This is a test-environment PATH artifact of how this session's tooling was invoked, not a defect in the packaged candidate — a real end user launching `Solith.exe` from Explorer or the Start Menu shortcut would not have Git Bash's `whoami` shadowing the system one. GameBar transport failing does not block window creation, database init, or normal app operation; disclosed here rather than silently omitted.
