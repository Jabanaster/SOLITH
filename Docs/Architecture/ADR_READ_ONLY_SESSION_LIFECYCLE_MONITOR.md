# ADR: Read-Only Session Lifecycle Monitor (V2 Scaffold)

**Date:** 2026-06-26  
**Status:** Accepted  
**Branch:** feature/v1-writable-real-world-pilot

---

## Context

The Wand/WeMod runtime investigation (see `Docs/Research/WAND_TALE_OF_IMMORTAL_RUNTIME_FINDINGS.md`) established that:

1. A trainer application's IPC session has a distinct lifecycle from the game process lifecycle.
2. Lifecycle transitions can be observed read-only from publicly accessible system metadata (process list, local TCP connections, session-marker files).
3. Reliable lifecycle state requires correlating multiple evidence sources — a single signal is insufficient.

ResourceForge needs a foundation for future live trainer features that (a) does not destabilize V1 and (b) models game lifecycle and session lifecycle as separate concerns from the start.

---

## Decision

Implement a read-only, disabled-by-default **Session Lifecycle Monitor** scaffold in V2.

The monitor observes publicly available system metadata to determine which lifecycle state is currently active. It takes no actions: it does not connect to game processes, inject code, open trainer sessions, or modify any file outside ResourceForge's own data directory.

---

## Why game and session lifecycle are separate

The Wand investigation confirmed that ending a trainer session does not terminate the game. The monitor must distinguish:

- Game running, no session active
- Game running, external session active
- External session ended, game still running
- Game exited

Collapsing these into "game running / not running" would prevent correct diagnosis of session cleanup issues and would mislead future trainer features about the state they're operating in.

---

## Why the monitor is read-only

ResourceForge V1 is a file-backed trainer. V2 live modification capabilities are deferred pending:

1. A ResourceForge-owned authenticated local service protocol (not yet designed).
2. A separate TrainerHost process architecture.
3. A memory access safety audit.

Building modification before observation would couple these concerns. Starting with observation only establishes the state model cleanly before adding write paths.

---

## Why V1 remains file-backed

V1's save-editing architecture is proven, tested, and shipping. The V2 monitor sits behind a feature flag (`v2SessionMonitorEnabled`, default: `false`) and does not alter any V1 data path. V1 tests must pass before and after V2 changes.

---

## Why external sessions are not ResourceForge-owned sessions

Observed Wand sessions are external research artifacts. ResourceForge has no authentication mechanism to verify ownership of a localhost IPC endpoint opened by a different application. Claiming ownership of an external session would be architecturally dishonest and could mislead future diagnostic tooling.

The data model distinguishes:
- `ExternalSessionObservation` — evidence that some external trainer has an active session
- ResourceForge-owned session — future state, not yet implemented

---

## Why transient ports and PIDs are not hardcoded

Port `57363` and PIDs `40744`, `3048` were specific to one session captured on 2026-06-25. Dynamic ports are assigned by the OS at session start. PIDs are reused by the OS after process exit. Hardcoding either would cause false positives in future sessions and break if the game or trainer uses a different port.

---

## Why overlays and capture are excluded

`capture.exe` (OBS Studio–based) loads ~187 modules including FFmpeg, NVENC/QSV/x264 encoders, and Windows.Graphics.Capture. This is a substantial dependency footprint with significant attack surface (video encoding, audio capture). ResourceForge does not require game capture for lifecycle monitoring. Overlay rendering requires a separate design review.

---

## Why future authenticated IPC must use ResourceForge-owned protocols

Connecting to Wand's private `tophat_service` IPC without authorization would violate the terms of service of third-party applications and could trigger anti-cheat detection in games that inspect network activity. ResourceForge's own IPC protocol, when implemented, must use a separately registered endpoint with a defined authentication handshake.

---

## Consequences

**Positive:**
- V1 is unaffected.
- Lifecycle state model is established before write paths are added.
- Read-only observation is auditable and safe.
- External and ResourceForge-owned sessions are distinguishable from day one.

**Negative:**
- No live modification capability from this ADR.
- `service-ports.json` observation is specific to Wand's current file layout; if Wand changes this path, the marker observer config must be updated.
- The monitor cannot observe IPC message content (read-only boundary).

---

## Deferred Work

| Item | Reason deferred |
|------|----------------|
| ResourceForge-owned game IPC | Requires TrainerHost design, protocol spec, auth |
| Trainer option dispatch | Depends on owned IPC |
| Memory read/write | Requires separate safety audit |
| Memory / pointer scanning | Depends on memory access |
| DLL injection / hooking | Out of scope permanently for this architecture |
| Game capture / overlay | Separate design review required |
| TrainerHost process | Separate design required |
| Hotkey service | Depends on session ownership |
| Private Wand protocol | Must not be implemented |

---

## Related Documents

- `Docs/Research/WAND_TALE_OF_IMMORTAL_RUNTIME_FINDINGS.md`
- `Docs/Architecture/TRAINER_MODE.md`
- `Docs/Security/` (existing security architecture)
- `src/core/v2/lifecycle/types.ts` (state machine)
