# V1 Game Validation

## Real-World Pilot Status

**Status: `SANDBOX WRITABLE — Drill Core master_volume sandbox workflow passed`**
(live in-game validation not yet authorized)

Drill Core 1.0.0.0 (Steam, Hungry Couch, GameMaker) is the first writable
sandbox-validated game. Its `settings.json` `master_volume` target completed the
backup → apply → validate → restore pipeline twice on real-format copies, with
byte-preserving edits (`100.0 → 75.0`) and exact SHA-256 restore. The live file
was only read for hash verification and remained byte-for-byte unchanged. This is
sandbox evidence; the game has not yet been launched to confirm it loads the
modified value. See `Docs/Reports/DRILL_CORE_MASTER_VOLUME_SANDBOX_PILOT.md`.

Atomfall 1.23.105.0 (Xbox) has real-world sandbox evidence at `READ_ONLY`. Hash-verified
copying and source preservation passed. Its extensionless 4 MiB save is an unknown sparse
proprietary binary with possible integrity metadata, so no writable compatibility is claimed.

Atomfall must not be promoted to `SUPPORTED` or `EXPERIMENTAL`, and its trailer/checksum must
not be guessed, removed, regenerated, or repacked.

## What Is Required to Validate a Real Game

1. User provides a save file path for a specific game (JSON, INI, or supported format)
2. Sandbox isolates the file (copy to temp directory)
3. Pre-hash the workspace file
4. Run Discovery Lab to identify candidate fields
5. Create a recipe for a safe, reversible field (e.g., gold, HP, a numeric setting)
6. Run apply → parse → verify value changed → hash workspace → restore → hash workspace
7. All four hashes must satisfy the invariants:
   - `workspace_before = verified_backup = workspace_after_restore`
   - `workspace_after_apply = expected_output`
   - `workspace_after_apply ≠ workspace_before`
   - `source = source_after` (immutable reference untouched)
8. Record: game name, format, adapter, field path, confidence, issue codes, hashes
9. Set profile level to VERIFIED

## Candidate Pilot Games

The user must nominate a specific game. Criteria for a good pilot candidate:

- JSON or plain-text save format (highest adapter confidence)
- Single-player only (no anti-cheat, no online validation)
- Save file located in a user-writable directory (not program files)
- At least one numeric field that is safe to change and verify
- Game can be closed during testing

## Games That Cannot Be Used for the Writable Pilot

- Games with encrypted, signed, or packed saves
- Online-only games with server-authoritative state
- Games with anti-cheat that scans save files on launch
- Games that validate save file checksums on load
- Games distributed through stores that maintain cloud sync without local-copy isolation

Xbox container saves like the observed Atomfall format remain read-only unless a deterministic,
versioned adapter understands their full structure and integrity rules.

## After a Successful Pilot

1. Update the profile with VERIFIED level and hash evidence
2. Add RF-xxx issue codes for any limitations discovered
3. Update `Docs/Compatibility/PILOT_RESULTS.md`
4. Do not commit save file contents — only metadata, hashes, and profile schema
