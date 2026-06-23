# Compatibility Profiles — Architecture

## Purpose

Compatibility profiles record how well ResourceForge works with a specific game's save files. They gate which operations are allowed and surface evidence quality to the user.

## Profile Levels

| Level | Meaning |
|-------|---------|
| `VERIFIED` | Backup/apply/validate/restore cycle confirmed with real save data; source file hashes recorded |
| `SUPPORTED` | Core read/write operations work; restore not yet confirmed with full hash evidence |
| `READ_ONLY` | Parse and display supported; write path blocked or untested |
| `EXPERIMENTAL` | Partial support; may work but not confirmed end-to-end |
| `UNSUPPORTED` | Save format not recognized or rejected by adapters |
| `BLOCKED` | Explicitly blocked (e.g., encrypted, signed, multiplayer-only) |

`BLOCKED_PENDING_USER_DATA` is not a profile level — it is a dashboard display note indicating no real-world pilot data has been submitted yet.

## Evidence Tiers

Evidence quality governs which gates a profile can satisfy:

| Tier | Description | Example |
|------|-------------|---------|
| 1 — Runtime | Actual apply/restore confirmed in live Electron session with real save file | Gate 13 E2E run with real save |
| 2 — Sandbox | Apply/restore confirmed with synthetic fixture under real Electron runtime | Gate 13 demo game workflow |
| 3 — Unit/parse | Parser round-trips and hash validation tests pass | `npm test` |
| 4 — Visual | Screenshot or browser devtools output | Vite preview screenshot |

Gates 10, 13, and 18 require Tier 1 or Tier 2 evidence. Tier 3–4 evidence alone never satisfies a gate.

## Schema (`src/core/profiles/schema.ts`)

Key fields on `CompatibilityProfile`:
- `id`: UUID
- `schemaVersion`: semver string
- `gameId`: UUID linking to `games` table
- `gameName`: display name
- `store`: where the game was purchased (Steam, Epic, GOG, Unknown…)
- `supportedAdapters`: adapter IDs that can parse this game's saves
- `executableNames`: process names for game-running detection
- `limitations`: free-text list of known limitations
- `fingerprint`: any additional format-specific detection hints

## IPC Channels

| Channel | Handler |
|---------|---------|
| `get-compatibility-profile` | Returns first profile for given gameId |
| `get-all-profiles` | Returns all profiles (used by CompatibilityDashboard) |

## Issue Taxonomy (RF-001 – RF-020)

20 issue codes used in compatibility reports:

| Code | Category | Description |
|------|----------|-------------|
| RF-001 | Parse | Unknown format — adapter returns null |
| RF-002 | Parse | Partial parse — some fields unreadable |
| RF-003 | Parse | Schema drift — field paths changed after game update |
| RF-004 | Parse | Encoding issue — non-UTF-8 or unusual byte order |
| RF-005 | Write | Atomic write failed — disk full or permission denied |
| RF-006 | Write | Hash mismatch after write — file corrupted |
| RF-007 | Write | Game-running write rejected — safety interlock fired |
| RF-008 | Write | Backup creation failed — target not writable |
| RF-009 | Restore | Backup hash mismatch — backup file corrupted |
| RF-010 | Restore | Backup file missing — deleted by OS or user |
| RF-011 | Safety | File outside approved location — path containment blocked |
| RF-012 | Safety | Binary/encrypted format — write path blocked |
| RF-013 | Safety | Signed or packed format — modification rejected |
| RF-014 | Safety | Cloud-save sync conflict — local copy may be overwritten |
| RF-015 | Compat | Game version mismatch — recipe schema no longer matches |
| RF-016 | Compat | Fingerprint drift — save layout changed |
| RF-017 | Compat | Adapter version mismatch — parser needs update |
| RF-018 | Compat | Multiple save slots — recipe targets wrong slot |
| RF-019 | Compat | Platform-specific path — save location differs across OS |
| RF-020 | Compat | DRM or store-specific wrapper — format varies by storefront |

## Pilot Status

As of the V1 Trainer UX pilot commit, no commercial game saves have been submitted. All profiles in the database are either:
- Synthetic demo fixtures (VERIFIED via Tier 2 sandbox evidence)
- Absent (no profile → dashboard shows BLOCKED_PENDING_USER_DATA)

Real-world pilot data must be provided by the user per the Compatibility Pilot milestone. ResourceForge will never automatically fetch, store, or transmit commercial game saves.
