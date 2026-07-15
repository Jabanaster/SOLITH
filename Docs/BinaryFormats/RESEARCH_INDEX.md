# Binary Save Format Research Index

**Status:** Research pack for Milestone X — read-only until byte layout is verified with fixtures.

Solith demo formats (`RFSA`, `SLTH`, `RSAV`, `BPKG`, `GDAT`) are internal test profiles. This index tracks **commercial game** containers researched offline from public documentation and save-path conventions.

| Profile ID | Game | Extension / path | Write | Evidence | Notes |
|------------|------|------------------|-------|----------|-------|
| `terraria-plr-v1` | Terraria | `.plr` | **read-only** | [Terraria wiki – Save games](https://terraria.wiki.gg/wiki/Save_game) | Versioned player blob; field map varies by `version` int at offset 0 |
| `hollow-knight-userdat-v1` | Hollow Knight | `user*.dat` | **read-only** | Community reverse-engineering summaries | AES-encrypted player container; no write until key material understood |
| `subnautica-json-slot-v1` | Subnautica | `saveX/savedgames/slot0000/game.json` | **read-only** | Unknown Worlds JSON schema in slot folder | Structured JSON inside slot — not a single binary blob |
| `factorio-zip-v1` | Factorio | `save.zip` / `%APPDATA%/Factorio/saves/*.zip` | **read-only** | Wube `level.dat` + JSON metadata in zip | Archive container; per-file JSON inside |
| `projectzomboid-bin-v1` | Project Zomboid | `map_*` / `player_*` under `%UserProfile%/Zomboid/Saves/` | **read-only** | The Indie Stone forums / modding notes | Mixed binary + Lua state; treat as opaque until version pinned |

## Verification gates before `canWrite: true`

1. Fixture save captured in `demo-game/saves/<game>/` (sandbox copy only)
2. Parser round-trip on fixture without checksum regression
3. Entry in `Docs/Certification/<game>/save-field.md`
4. TrainerHost integration test with approved path binding

### Wave 1 priority (one format per milestone)

| Order | Profile | Fixture | Status |
|-------|---------|---------|--------|
| 1 | `terraria-plr-v1` | `demo-game/saves/terraria/player-fixture-v279.plr` | **read verified** (version @0); write still blocked |
| 2 | `hollow-knight-userdat-v1` | — | read-only until decrypt research |
| 3 | `factorio-zip-v1` | — | zip slot JSON research |
| 4 | `subnautica-json-slot-v1` | — | slot folder JSON |

## Related code

- `src/core/saves/binary-formats/research-profiles.ts` — detection stubs (read-only)
- `src/core/discovery/binary-field-proposal.ts` — byte-diff candidate proposal
- `src/core/saves/binary-save-field.ts` — write path only for verified demo + future promoted profiles
