# ResourceForge V1 Compatibility Support Matrix

Evidence classifications distinguish fixture testing, real-world sandbox inspection, and
authorized original-save testing. No entry is promoted based on extension or parser success.

| Game | Version | Platform | Format | Evidence tier | Status | Writable | Validated targets | Limitations | Last validated |
|---|---|---|---|---|---|---|---|---|---|
| Atomfall | 1.23.105.0 | Xbox | Unknown 4 MiB proprietary binary | `REAL_WORLD_SANDBOX` | `READ_ONLY` | No | None | Possible integrity metadata; no parser, serializer, checksum rules, apply, or restore compatibility | 2026-06-24 |

## Interpretation

Atomfall inspection and source-copy hashing are verified. Its original save was not modified.
The result is neither a failed experiment nor evidence of writable support. A second game with
a deterministic structured local format is required for the writable pilot.
