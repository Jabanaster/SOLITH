# Atomfall L3 Live-Memory Evidence

## Certification result

- **Status:** PASS
- **Certification level:** L3 — restart-stable live pointer
- **Certified feature:** `atomfall-current-weapon-ammo`
- **Feature name:** Set Current Weapon Ammo
- **Process/module key:** `Atomfall_dx12.exe` / `atomfall_dx12.exe` (case-insensitive Windows module match)
- **Data type:** `int32`
- **Certification date:** 2026-07-16 (UTC-7)
- **Harness:** `scripts/certify-live-pointer.mjs`
- **Native path:** `memoryjs` using `ReadProcessMemory` / `WriteProcessMemory`
- **Test environment:** Live Atomfall save loaded in an offline, single-player gameplay session

## Certified pointer chain

```text
atomfall_dx12.exe + 0x1959a28
  -> dereference uint64 pointer
  -> + 0x18 (schema.v1 pointerChain: [24])
  -> int32 current-weapon ammo value
```

Schema.v1 resolution:

```json
{
  "moduleName": "atomfall_dx12.exe",
  "baseOffset": "0x1959a28",
  "pointerChain": [24]
}
```

## Session A — initial live attach

- **Timestamp:** `2026-07-17T02:30:10Z`
- **Process:** `Atomfall_dx12.exe`
- **PID:** `32148`
- **Module base:** `0x140000000`
- **Static pointer slot:** `0x141959a28`
- **Pointer value:** `0xbf5e640`
- **Resolved value address:** `0xbf5e658`
- **Initial read:** `97`
- **Safe probe write:** `999`
- **Read-back:** `999` — verified
- **Restore write/read-back:** `97` — verified
- **Result:** PASS

Resolution trace:

```text
0x140000000 + 0x1959a28 = 0x141959a28
read uint64 at 0x141959a28 -> 0xbf5e640
0xbf5e640 + 0x18 = 0xbf5e658
read int32 at 0xbf5e658 -> 97
write int32 999 -> read int32 999
restore int32 97 -> read int32 97
```

## Session B — full process restart

Atomfall was completely closed, relaunched, and the saved game was loaded before this run.

- **Timestamp:** `2026-07-17T02:33:34Z`
- **Process:** `Atomfall_dx12.exe`
- **PID:** `32732` (changed from Session A)
- **Module base:** `0x140000000`
- **Static pointer slot:** `0x141959a28`
- **Pointer value:** `0x7a18640`
- **Resolved value address:** `0x7a18658` (changed from Session A)
- **Initial read:** `97`
- **Safe probe write:** `999`
- **Read-back:** `999` — verified
- **Restore write/read-back:** `97` — verified
- **Result:** PASS

Resolution trace:

```text
0x140000000 + 0x1959a28 = 0x141959a28
read uint64 at 0x141959a28 -> 0x7a18640
0x7a18640 + 0x18 = 0x7a18658
read int32 at 0x7a18658 -> 97
write int32 999 -> read int32 999
restore int32 97 -> read int32 97
```

## L3 conclusion

The process ID changed from `32148` to `32732`, and the resolved heap address changed from
`0xbf5e658` to `0x7a18658`. In both live sessions, the same module-relative pointer chain
resolved successfully and supported a verified `97 -> 999 -> 97` read/write/restore cycle.

This proves the definition is not tied to a session-local absolute address. The
`atomfall-current-weapon-ammo` feature meets ResourceForge L3 restart-stability requirements
for the tested Atomfall build and is formally tagged `certificationLevel: 'L3'`.

## Safety notes

- Testing was performed in an offline, single-player session.
- The harness used only process attach, memory read, and memory write operations.
- No DLL/code injection, debugger attachment, kernel driver, networking, or anti-cheat bypass was used.
- The original value was restored and verified after each probe.
