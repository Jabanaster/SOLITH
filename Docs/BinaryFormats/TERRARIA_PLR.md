# Terraria `.plr` — Binary Save Research

**Profile ID:** `terraria-plr-v1`  
**Status:** Read-only detection stub  
**Code:** `src/core/saves/binary-formats/research-profiles.ts`

## Container

| Property | Value |
|----------|--------|
| Extension | `.plr` |
| Typical path | `%UserProfile%/Documents/My Games/Terraria/Players/<name>.plr` |
| Endianness | Little-endian |
| Max size guard | 16 MiB |

## Verified header (read-only)

Public Terraria save documentation describes a versioned layout. The research profile exposes only stable header fields:

| Field ID | Offset | Type | Notes |
|----------|--------|------|-------|
| `version` | 0 | `int32` | Save format version — drives downstream field map |
| `name-length` | 4 | `int32` | Player name length in following bytes |

Full player stats, inventory, and buff blocks are **version-dependent** and are not mapped until a pinned fixture is captured under `demo-game/saves/terraria/`.

## Promotion gates

1. Sandbox `.plr` fixture with known `version`
2. Round-trip read on `version` + `name-length` without corrupting checksums
3. Certification doc at `Docs/Certification/terraria/save-field.md`
4. `canWrite: true` only after TrainerHost path binding test passes

## References

- [Terraria wiki — Save games](https://terraria.wiki.gg/wiki/Save_game)
- `Docs/BinaryFormats/RESEARCH_INDEX.md`
