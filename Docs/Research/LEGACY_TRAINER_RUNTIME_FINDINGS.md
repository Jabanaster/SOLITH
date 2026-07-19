# Research Findings: Wand / WeMod Runtime Architecture
## Tale of Immortal Session Observation — 2026-06-25/26

**Source workspace:** `C:\Users\chase\Desktop\Wand-TaleOfImmortal-Monitor-20260625-231321\`  
**Primary report:** `final-report\WAND_TALE_OF_IMMORTAL_RUNTIME_REPORT.md`  
**Method:** Read-only PowerShell metadata snapshots (CIM/WMI, `Get-NetTCPConnection`, named pipe enumeration).  
No memory was read. No code was injected. No binaries were modified.

---

## States Captured

| State | Description |
|-------|-------------|
| A | Wand open, Home screen |
| B | Tale of Immortal trainer page loaded in Wand |
| C | Game launched through Wand |
| D-active | "Max Drop Rate" toggle activated (Off → On → Off) |
| E | Game session ended, Wand closed |

---

## Confirmed Observations

### O-1: Game launched through cmd.exe intermediary

**Status: OBSERVED**

Process tree at State C:
```
Wand renderer (36776)
  └── cmd.exe (3048)
        └── guigubahuang.exe (40744)
```

Wand did not launch the game directly. A `cmd.exe` intermediary decoupled the renderer from being the direct parent of the game process.

**Solith implication:** Do not treat the direct-parent PID as a reliable session ownership marker. PIDs in a process tree can be separated by shell intermediaries.

---

### O-2: IPC port registry written at game launch and cleared at session end

**Status: OBSERVED**

`%APPDATA%\Wand\service-ports.json` transitions:
- States A, B: `[]`
- State C (game launched): populated, containing port `57363`
- State E (session ended): `[]`

This file is a live session indicator owned by `WandAuxiliaryService.exe`. It is **not** a Solith file. Solith can observe its presence as external evidence that a Wand session is active.

**Port values are session-specific.** Port `57363` was observed in this session only. Future sessions will use different dynamic ports. Never hardcode `57363` as a protocol constant.

---

### O-3: tophat_service localhost listener lifecycle

**Status: OBSERVED**

`tophat_service_x64.dll` loaded into `guigubahuang.exe` and opened a TCP listener on `127.0.0.1:57363`.

A Wand renderer connected from `127.0.0.1:57364`.

At State E, the listener on `:57363` stopped and both sides of the connection pair disconnected.

---

### O-4: TrainerHost_x64.exe was NOT spawned for this toggle option

**Status: OBSERVED**

For the "Max Drop Rate" toggle (a runtime probability flag), `TrainerHost_x64.exe` was not observed starting. The toggle was delivered through the existing `tophat_service` IPC channel.

**Caveat (do not suppress):** This observation applies only to the specific toggle option tested. TrainerHost is architecturally present in the Wand installation and is expected to spawn for options requiring memory scanning, pointer resolution, or repeated write-back. Whether the observed toggle caused in-process memory modification is **unknown** — memory reads were out of scope.

---

### O-5: capture.exe has strict game-session lifetime

**Status: OBSERVED**

`capture.exe` (OBS Studio–based overlay, spawned by Wand main process at State C) stopped when the session ended at State E. Its lifetime was exactly the game session.

Solith does not need to reproduce this subsystem for lifecycle monitoring.

---

### O-6: Game process remained alive after session end

**Status: OBSERVED**

At State E, `guigubahuang.exe` (PID 40744) and `cmd.exe` (PID 3048) remained present. Wand did not force-kill the game when the trainer session ended.

**Solith implication:** "Trainer session ended" and "game exited" are separate conditions and must be modeled separately.

---

### O-7: Trainer DLL persisted after session end

**Status: OBSERVED**

`Trainer_46908_2110d80892.dll` remained in `%APPDATA%\WeMod\App\trainers\` after the session ended. It was cached at game launch (State C) and not removed at session end (State E).

Solith must not copy, load, or depend upon this binary.

---

### O-8: Wand renderer processes persisted after session close

**Status: OBSERVED**

Several `Wand.exe` renderer processes (including PIDs 3004 and 28120 from the trainer session) remained after the session ended. Electron applications commonly retain background processes.

---

## Architectural Inferences

These are conclusions drawn from the evidence. They are defensible but not directly measured.

### I-1: tophat_service IPC protocol is unknown

The message format exchanged over `127.0.0.1:57363` was not captured (memory reads and packet sniffing were out of scope). Messages are likely JSON or protobuf over a plain TCP socket based on the OpenTelemetry logging pattern, but this is an inference.

Solith must not attempt to connect to or replicate this private protocol.

### I-2: TrainerHost spawning is option-type dependent

Based on architecturally expected patterns: TrainerHost is likely reserved for options requiring memory scanning, pointer resolution, or repeated value patching. Toggle-only options that communicate via in-process hooks may not require it. This was not proven directly.

### I-3: service-ports.json is written by WandAuxiliaryService

The file's timing (written at game launch, cleared at session end) is consistent with `WandAuxiliaryService.exe` being the session manager. This is an inference from the observed correlation, not a direct measurement.

---

## Unknown / Not Observed

| Item | Status |
|------|--------|
| tophat_service IPC protocol | Not captured (out of scope) |
| TrainerHost_x64.exe lifecycle for memory-patching options | Not observed — only a toggle was tested |
| Whether the tested toggle caused in-process memory modification | Unknown — memory reads out of scope |
| service-ports.json full schema | Partially observed (port field confirmed) |
| OTel log content | Not read |
| x86 trainer host | Not observed (game is 64-bit only) |

---

## Solith V1 / V2 Boundary

**V1 (unchanged):**
- File-backed save editing
- JSON, XML, INI, CSV parsers
- Proposals, diffs, backups, rollback
- Read-only game-running detection via `tasklist`

**V2 scope established by this research:**
- Read-only session lifecycle monitoring (disabled by default)
- Observes game process identity, local TCP endpoint metadata, and configured external session markers
- Does not connect to Wand's private IPC protocol
- Does not read process memory
- Does not inject code
- Does not write to external application directories

---

## Legal and Safety Notes

- No Wand or WeMod proprietary binaries, algorithms, pointer paths, or patch bytes are present in Solith.
- `service-ports.json` is observed as a readable file. Solith does not write to it.
- The Wand IPC protocol was not reverse-engineered.
- Solith marks any observed Wand session as **externally observed**, not as a Solith-owned session.

---

*Research workspace: `C:\Users\chase\Desktop\Wand-TaleOfImmortal-Monitor-20260625-231321\`*  
*Evidence reviewed: 2026-06-26*
