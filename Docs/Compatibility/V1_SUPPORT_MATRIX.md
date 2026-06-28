# ResourceForge V1 Compatibility Support Matrix

Evidence classifications distinguish fixture testing, real-world sandbox inspection, and
authorized original-save testing. No entry is promoted based on extension or parser success.

| Game | Version | Platform | Format | Evidence tier | Status | Writable | Validated targets | Limitations | Last validated |
|---|---|---|---|---|---|---|---|---|---|
| Atomfall | 1.23.105.0 | Xbox | Unknown 4 MiB proprietary binary | `REAL_WORLD_SANDBOX` | `READ_ONLY` | No | None | Possible integrity metadata; no parser, serializer, checksum rules, apply, or restore compatibility | 2026-06-24 |
| Drill Core | 1.0.0.0 | Steam (Hungry Couch, GameMaker) | UTF-8 JSON, no BOM, single-line | `REAL_WORLD_SANDBOX` | `SANDBOX_WRITABLE` | Sandbox only (live not authorized) | `master_volume` (0–100) | Validated only for the tested `settings.json` structure and `master_volume`; no other settings, versions, progression saves, or Steam-emulator stats; in-game load not yet validated | 2026-06-25 |

## Interpretation

Atomfall inspection and source-copy hashing are verified. Its original save was not modified.
The result is neither a failed experiment nor evidence of writable support.

Drill Core `settings.json` is the first **writable sandbox** entry: the
backup → apply → validate → restore pipeline was proven twice on real-format
copies with byte preservation and exact SHA-256 restore, while the live original
remained byte-for-byte unchanged. This is sandbox evidence only — live in-game
loading/restoration has not been authorized, so the entry is not promoted to a
verified writable tier. See `Docs/Reports/DRILL_CORE_MASTER_VOLUME_SANDBOX_PILOT.md`.
