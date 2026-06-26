# Drill Core — `master_volume` Sandbox Pilot Report

**Status:** READY FOR IN-GAME VALIDATION (sandbox workflow passed)
**Evidence tier:** `REAL_WORLD_SANDBOX`
**Live-file writing:** Not authorized / not performed
**Date:** 2026-06-25

## Scope

First writable real-world compatibility pilot. A single audio setting
(`master_volume`) in Drill Core's `settings.json` was changed from `100` to
`75` and restored to `100`, entirely within isolated sandbox copies. The live
configuration file was never modified — it was only read to hash-verify it
stayed byte-for-byte unchanged.

| Item | Value |
|------|-------|
| Game | Drill Core (Hungry Couch, GameMaker) |
| Config | `%LOCALAPPDATA%\Drill_Core\settings.json` |
| Format | UTF-8 JSON, no BOM, single-line, 719 bytes |
| Target | `master_volume` (top-level numeric) |
| Operation | `100 → 75`, restore `→ 100`, range `0–100` |
| Adapter | `drill-core-settings@1.0.0` (byte-preserving) |

## What was built

- **Narrow adapter** `src/core/adapters/drill-core-settings.ts` — the only
  authorized writable target is the top-level `master_volume` integer (0–100).
  It performs a **byte-preserving targeted token replacement** instead of a full
  JSON reserialize, so GameMaker's real-number style (`100.0`) and single-line
  layout are preserved and the diff is limited to one numeric token.
- Registered ahead of the generic JSON adapter so `settings.json` routes to it.
- A **Master Volume** slider recipe (Audio, min 0 / max 100 / step 1 / reset 100).
- Sanitized regression fixture + 24 adapter tests.

## Workflow proven (each run)

```
fresh copy → proposal → explicit approval → verified backup
→ atomic byte-preserving apply → strict post-write validation
→ exact SHA-256 restore → live-original integrity re-check
```

Both runs executed against fresh copies of the verified intake with **distinct
operation IDs, working files, backups, and manifests**. See
`DRILL_CORE_MASTER_VOLUME_EVIDENCE.md` for hashes and byte spans.

## Verification summary

| Check | Result |
|-------|--------|
| Unit suite (`npm test`) | 132/132 pass (incl. 24 new adapter tests) |
| Typecheck (`tsc --noEmit`) | clean |
| Electron build + output verify | 18/18 checks |
| Electron smoke / e2e / ipc | pass |
| Trainer states / trainer e2e | pass |
| Browser fallback / performance | pass |
| Accessibility e2e | 7/7 pass (no worker crash this run) |
| Pilot intake | 10/10 pass |
| Sandbox runs (run-01 / run-02) | both pass, live original unchanged |

## Limitation

Validated **only** for the tested Drill Core `settings.json` structure and the
`master_volume` target. No claim is made for other settings, other Drill Core
versions, progression saves, or Steam-emulator statistics.

## Decision

`READY FOR IN-GAME VALIDATION — Drill Core master_volume sandbox workflow passed`

The complete writable real-world pilot is **not** accepted yet: live in-game
loading and restoration have not been authorized or performed.

- Original live file modified: **No**
- Real pilot data committed: **No**
- `v0.3.0` was not created or pushed.
