# Drill Core — `master_volume` Sandbox Evidence (sanitized)

All values below are sandbox/derived artifacts. No real save contents, full
personal paths, usernames, account/platform identifiers, or local evidence
files are reproduced here.

## Verified intake (read-only source of truth)

| Field | Value |
|-------|-------|
| Redacted source | `%LOCALAPPDATA%\Drill_Core\settings.json` |
| Length | 719 bytes |
| Encoding | UTF-8, no BOM, single-line |
| SHA-256 | `10824febeb53ab516d5a08b10a56b6b489feeeb45d0e577f03ef533f77f7957e` |
| Strict JSON parse | OK |
| Semantic round-trip | MATCH |
| Original modified | No |

Byte round-trip differs from a naive `JSON.stringify` only because GameMaker
serializes reals as `N.0`. The narrow adapter preserves that style, so the
applied diff is a single numeric token.

## Byte-preservation evidence (`100.0 → 75.0`)

| Field | Value |
|-------|-------|
| Original token | `100.0` |
| Replacement token | `75.0` |
| Original token span | `[334, 339]` |
| Modified token span | `[334, 338]` |
| Number of changed regions | `1` |
| Prefix equality (bytes < 334) | true |
| Suffix equality (bytes after token) | true |
| Length delta | `1` (acceptable; prefix/suffix prove no unrelated change) |
| Semantic equality outside target | true |

## Run results

Both runs started from a fresh copy of the verified intake and used independent
operation IDs / working files / backups / manifests.

| Check | run-01 | run-02 |
|-------|:------:|:------:|
| pre-write hash == verified intake | ✓ | ✓ |
| backup hash == pre-write hash | ✓ | ✓ |
| post-write `master_volume == 75` | ✓ | ✓ |
| unrelated values unchanged | ✓ | ✓ |
| prefix/suffix bytes identical | ✓ | ✓ |
| restored hash == pre-write hash (exact) | ✓ | ✓ |
| restored `master_volume == 100` | ✓ | ✓ |
| backup immutable after restore | ✓ | ✓ |
| live original unchanged (hash) | ✓ | ✓ |

`pre_write_sha256 = 10824febeb53ab516d5a08b10a56b6b489feeeb45d0e577f03ef533f77f7957e`
(equals verified intake hash; the working file is restored back to this exact hash).

## Cross-run independence

- Distinct operation IDs, working files, backups, manifests — verified.
- Verified intake copy unchanged across both runs.
- Live original unchanged after both runs.

## Automated coverage

- 24 adapter tests (`tests/drill-core-settings.test.ts`): valid edits, invalid
  rejections (missing/duplicate/nested/wrong-type/fractional/negative/
  above-range/malformed/trailing/BOM/ambiguous/stale/wrong-target/wrong-file),
  byte/value preservation, and the production `applyProposal` + `restoreBackup`
  engine path with the narrow adapter selected.
