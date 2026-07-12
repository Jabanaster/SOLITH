# RFSA v1 — ResourceForge Structured Save Archive

**Status:** Documented binary save format #1 (demo + test harness)  
**Profile id:** `rfsa-v1`  
**Extension:** `.rfsa`  
**Endianness:** little-endian  

---

## Purpose

Provides a **real, byte-documented** binary save layout for Solith binary-save-field tests and the support matrix — not a blind blob patch. This is the first structured binary profile before per-commercial-game research (Milestone X).

Demo file: `demo-game/save/player.rfsa`

---

## Layout (36 bytes minimum)

| Offset | Size | Field | Type | Notes |
|--------|------|-------|------|-------|
| 0 | 4 | magic | char[4] | `RFSA` |
| 4 | 4 | version | uint32 | Must be `1` |
| 8 | 4 | flags | uint32 | Reserved user flags |
| 12 | 4 | reserved | uint32 | Zero |
| 16 | 4 | gold | int32 | Currency |
| 20 | 4 | hp | float32 | Player health |
| 24 | 4 | stamina | int32 | Stamina pool |
| 28 | 4 | reserved2 | uint32 | Zero |
| 32 | 4 | checksum | uint32 | XOR of bytes 0–31 |

Checksum algorithm: `xor(bytes[0..31])` as uint32.

---

## Code map

- `src/core/saves/binary-formats/rfsa.ts` — parse/validate/write
- `src/core/saves/binary-save-field.ts` — field read/write API
- `tests/binary-save-field.test.ts` — round-trip tests

---

## Safety

- Writes require detected `rfsa-v1` profile with `canWrite: true`
- Field min/max enforced from profile map
- Invalid checksum rejects read/write

---

## Next formats (research queue)

Commercial candidates for format #2+ (require per-game byte research, not guessed):

1. Terraria `.plr` (complex, versioned)
2. Subnautica slot JSON-in-zip (not binary — already JSON path)
3. Darkest Dungeon (compressed payloads)

Do not add these until layout evidence is captured offline.
