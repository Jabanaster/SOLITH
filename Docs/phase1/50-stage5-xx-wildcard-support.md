# Phase 1 / Stage 5.3 — `xx`/`x` Wildcard Support

## Authorization

Owner decision #2 (this mission's SOLITH.MD): "AUTHORIZE native support for legitimate `xx`/`x` wildcard notation." Implemented in `native/solith-scanner-core/src/pattern.rs`.

## Evidence this was necessary (recap of Stage 5.2, doc 48)

16,392 real occurrences (`xx`: 10,286, `XX`: 3,650, `x`: 2,456) found across the recovered, hash-verified CT corpus — the single largest unsupported-syntax family found, spanning many unrelated real, published community Cheat Engine tables (e.g. Borderlands 2's `ResetAmmoStorageUpgradesAOB`). Confirmed real, legitimate Cheat Engine syntax by the official Cheat Engine wiki (doc 51): `'x'` is one of three documented wildcard characters, alongside `?` and `*`.

## Semantics implemented

`parse_token` (`pattern.rs`) now accepts a complete 1- or 2-character token consisting only of `x`/`X` (any case, including mixed, e.g. `xX`) as a full-byte wildcard — the same `PatternByte::wildcard()` (`mask=0x00`) every other full-wildcard spelling (`?`, `??`, `*`) already produces. Because `PatternByte` never records which spelling produced it, the internal representation is already canonical/unified across every full-wildcard spelling — no separate normalization step was needed.

**Scope boundary, exactly as instructed:** `'x'`/`'X'` is recognized **only** as a complete standalone token. A token mixing `x` with a hex digit (e.g. `"4x"`, `"x4"`) is **not** interpreted as a wildcard — it falls through to the existing `InvalidHexToken` rejection path, unchanged. This is deliberate: real Cheat Engine syntax does use `x` in a nibble position too (`"5x"`, doc 51), but that is a distinct, separate finding this mission did not authorize implementing (see doc 51's own scope note) — extending nibble detection to `x`/`*` was not requested by this mission and is flagged there for a future, separate authorization rather than implemented speculatively here.

A run of 3+ `x`/`X` characters (e.g. `"xxx"`) is classified `MalformedWildcard` (matching how an over-long `"???"` run is already classified) rather than `InvalidHexToken`, for a more accurate error category.

## Tests added

**Unit (`pattern.rs`, 10 new):** lowercase `xx`, uppercase `XX`, lowercase `x`, uppercase `X`, mixed with exact bytes, mixed with `??`, mixed with `*`, mixed with a nibble wildcard, `x`-embedded-in-a-hex-token rejection (`InvalidHexToken`), and an over-long `xxx` run (`MalformedWildcard`). All required by mission §G's checklist.

**Real Rust integration test (`pattern_scan_integration.rs`, 1 new):** `xx_and_x_wildcard_aob_matches_real_memory_regardless_of_wildcarded_byte` — plants the identical real bytes the existing `??`-wildcard test already proves against a real spawned process (`48 8B 05 FF 22 33 44 89`), and proves `"48 8B 05 xx 22 33 44 89"`, `"...XX..."`, and `"...x..."` all match the real wildcarded byte regardless of its value, against real process memory (not a unit-level mock).

**Real napi test (`test/pattern.test.js`, 1 new):** `pattern: xx/x full-byte wildcard AOB matches real compiled addon regardless of the wildcarded byte` — same real fixture, same three query spellings, through the actual compiled `.node` addon, no mocks.

## Results

Rust: 146/146 (was 136; +10 unit tests). napi: 40/40 (was 39; +1). `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings` both clean. See doc 52 for the full post-change verification battery and doc 53 for the certification determination.
