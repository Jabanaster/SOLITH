# Real-World Compatibility Pilot Report

**Date:** 2026-06-24
**Pilot decision:** `BLOCKED — first real-world save remains read-only`

## Atomfall read-only result

| Field | Result |
|---|---|
| Game | Atomfall |
| Version | 1.23.105.0 |
| Platform | Xbox |
| Evidence tier | `REAL_WORLD_SANDBOX` |
| Format | Unknown proprietary binary |
| Size | 4,194,304 bytes |
| Compatibility | `READ_ONLY` |
| Writable | No |
| Original modified | No |
| Source hash preserved | Yes |

The user-approved source was copied to an ignored local workspace. The source-before,
workspace-copy, source-after-copy, and source-after-inspection SHA-256 values matched.
The full hash and personal filesystem paths remain only in ignored local evidence.

Read-only triage found an extensionless, fixed-size, sparse binary container with unknown
magic and possible integrity metadata at the trailer. ResourceForge has no deterministic
Atomfall parser, serializer, checksum implementation, or format-version validator.

No parser, serializer, candidate, recipe, write, apply, validation, or restore compatibility
is claimed. Atomfall is a successful real-world safety result: ResourceForge preserved the
source and refused to infer writable compatibility from opaque bytes.

This result does not satisfy the first writable real-game pilot. Release-candidate work
remains gated.
