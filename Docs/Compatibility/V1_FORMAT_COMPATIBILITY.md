# V1 Format Compatibility

## Supported Formats (Fixture-Tested)

| Format | Adapter | Read | Write | Evidence Tier |
|--------|---------|------|-------|---------------|
| JSON (`.json`) | `json-adapter` | Yes | Yes | Tier 2 — Sandbox |
| Nested JSON | `json-adapter` | Yes | Yes | Tier 2 — Sandbox |

## Pending Formats (Not Yet Tested)

| Format | Notes |
|--------|-------|
| INI / `.cfg` | Adapter planned; no test fixture |
| XML (`.xml`) | Adapter planned; no test fixture |
| Binary `.sav` | READ-ONLY — adapter blocked for unknown binary |
| SQLite `.db` | Discovery supported; write path untested |
| Protobuf | Not yet supported |
| LZ4 / Zlib compressed | Blocked — decompression required before parse |
| Encrypted | Blocked — decryption never attempted |
| Signed / packed | Blocked — modification rejected |

## Evidence Tier Definitions

- **Tier 1 — Actual-save-tested**: apply/restore confirmed with a real game's save file in the isolated sandbox. Source file hash recorded before and after. Requires user to provide the save file.
- **Tier 2 — Sandbox-tested**: apply/restore confirmed with a synthetic fixture in the real Electron runtime. All Gate 13 and Trainer E2E tests use Tier 2 evidence.
- **Tier 3 — Unit/parse**: Parser round-trips and hash validation pass in Node.js tests. Does not prove Electron IPC is functional.
- **Tier 4 — Visual**: Screenshot or browser preview output. Does not prove any write or restore path works.

## Current Status

No Tier 1 (actual-save-tested) evidence exists. All verification is Tier 2 (sandbox fixture in real Electron runtime).

Tier 1 evidence requires the user to provide real-world save files per the Compatibility Pilot specification.
