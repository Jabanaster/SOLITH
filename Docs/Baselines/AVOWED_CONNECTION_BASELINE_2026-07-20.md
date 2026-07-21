# Avowed WinGDK Connection Baseline — Session A

**Status:** MEASURED (provisional — single-session evidence)  
**Date:** 2026-07-20 (UTC) / 2026-07-19 local UTC-7  
**Harness:** `node scripts/measure-connection-baseline.mjs`  
**SOP:** `Docs/Plans/AVOWED_LIVE_VALIDATION_SOP.md` Phase A  
**Boundary:** Read-only process/network inspection only — no memory writes

## Why keep `connectionBaseline: 3`

A measured solo Game Pass session showed **3** ESTABLISHED non-loopback TCP
connections on the shipping process. Keeping **3** (rather than the strict
default **0**) is the honest minimum needed for attach during normal solo
play with Xbox/platform services active. This is **better than 0 for attach
usability**; it is **not** a claim of a strong or permanent safety boundary.

## Evidence LIMITATIONS (do not overclaim)

This baseline comes from **one** live observation. Treat it as provisional:

| Limitation | Detail |
|------------|--------|
| Single session | One attach / one play stretch — not repeated across launches |
| Single version | Package `Microsoft.Avowed_2.258.6997.0_x64__8wekyb3d8bbwe` only |
| Single machine | One operator PC; no cross-machine confirmation |
| Single process snapshot | Shipping PID `16696` at measurement time |
| Endpoint identity not validated | Count-only (see KI-017 residual risk); remotes sampled as HTTPS/443 platform services, not cryptographically proven |

**Before treating this as a strong safety boundary, re-measure across:**

1. Multiple cold launches / process restarts  
2. Distinct gameplay states (menu, open world, combat, pause)  
3. Explicit disconnected / airplane / no-net conditions (expect count drop if platform chatter dies)  
4. Known game or platform version bumps  
5. Known unsafe states (if any multiplayer / shared-world path exists for this build — confirm count rises above baseline)

Until then: useful attach floor vs default 0; **not** permanence; **not** multiplayer-proof.

## Process fingerprint

| Field | Value |
|-------|--------|
| Package | `Microsoft.Avowed_2.258.6997.0_x64__8wekyb3d8bbwe` |
| Shipping EXE | `Avowed-WinGDK-Shipping.exe` |
| Shipping path | `...\Alabama\Binaries\WinGDK\Avowed-WinGDK-Shipping.exe` |
| Shipping PID | `16696` |
| Working set | ~1123 MB |
| Launcher EXE | `Avowed.exe` |
| Launcher PID | `32640` |
| Platform | Xbox PC Game Pass (WinGDK) |

## Save / config roots (READ + COPY only)

| Root | Path | Exists |
|------|------|--------|
| WGS saves | `%LOCALAPPDATA%\Packages\Microsoft.Avowed_8wekyb3d8bbwe\SystemAppData\wgs` | Yes |
| Alabama WinGDK config | `%LOCALAPPDATA%\Alabama\Saved\Config\WinGDK` | Yes (`Engine.ini`, `GameUserSettings.ini` present) |

## TCP baseline (non-loopback ESTABLISHED)

### `Avowed-WinGDK-Shipping.exe` (PID 16696)

```json
{
  "pid": 16696,
  "processName": "Avowed-WinGDK-Shipping.exe",
  "establishedCount": 3,
  "reviewedAt": "2026-07-20",
  "evidenceTemplate": "Measured live against Avowed-WinGDK-Shipping (PID 16696) during solo play: 3 ESTABLISHED non-loopback TCP connections. Provisional — single session/version/machine; see Evidence LIMITATIONS."
}
```

Sample remotes (HTTPS/443 only — consistent with Xbox / platform services in this snapshot; **not** validated as exclusive of multiplayer):

| Remote | Port |
|--------|------|
| 20.109.157.180 | 443 |
| 20.201.192.56 | 443 |
| 199.46.35.129 | 443 |

### `Avowed.exe` launcher (PID 32640)

```json
{
  "pid": 32640,
  "processName": "Avowed.exe",
  "establishedCount": 0,
  "reviewedAt": "2026-07-20"
}
```

## Recommended `connectionBaseline` for schema.v1

For WinGDK shipping attach during solo play with Game Pass services active
(provisional Session A evidence):

```text
connectionBaseline: 3
```

Do **not** set lower than 3 on this build/session profile or the online-session
guard will fail-closed on the measured solo Game Pass chatter. Re-measure when
Microsoft changes service chatter, the game version bumps, or after the
LIMITATIONS checklist above — do not treat `3` as permanent.

## Memory certification status

Still **L0**. Prior `.tmp` research noted `NO_STABLE_MODULE_PATH_YET` — absolute
heap anchors from older PIDs are stale and must not be promoted.

Next: Phase B state-delta scan (one feature) after operator reports current HUD value.
