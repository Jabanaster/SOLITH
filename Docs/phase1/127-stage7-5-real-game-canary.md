# Phase 1 / Stage 7.5 §12 — Real-Game Canary

## Why re-run

Mission §12 requires the full 3-game re-run because common AOB/signature routing changed this stage. Doc 118's Stage 7.4 run is superseded rather than reused.

## Method

Harness: `scripts/stage75-real-game-canary.mts` (previously performed by hand; captured as a repeatable script this stage). Follows doc 118's method so results stay comparable:

- Real launch of each title's real installed executable from its Steam library.
- 12-second stabilization wait, then the real game process located **by loaded image path**, not by a guessed process name — doc 118 already recorded that 2 of these 3 titles start through a launcher, and Godlike Burger is installed in two Steam libraries on this machine, so Steam may start the copy that was not launched.
- Real `LiveMemorySession` attach on `nativeMemoryDriver` — the same production classes the Electron app uses.
- **Zero calls to `setScannerRoutingMode`.** The default is asserted, not configured.
- **No writes at any point.** Every process closed afterwards and verified closed.

New this stage, and the point of the exercise: a real **drift-tolerant** AOB resolution against each live game.

### How fuzzy ground truth is obtained without writing

Planting bytes in a commercial game process is not acceptable for a canary, so ground truth is read out of the game instead. A distinctive 16-byte window (≥12 distinct byte values) is read from the title's own main module; its final byte is XOR-flipped to produce a signature that cannot match exactly anywhere; the resolver is asked to find it with `maxDistance: 1, maxEdits: 0`.

The result is then **verified independently**: the bytes actually living at the returned address are re-read through a separate read-only attach and their Hamming distance to the searched signature is recomputed locally. A pass means the resolver returned an address whose real contents are genuinely one substitution away from what was asked for — not that the resolver agreed with itself.

## Real evidence

| Field | Bastion | Godlike Burger | Aegis Defenders |
|---|---|---|---|
| Exe | `Bastion.exe` | `Godlike Burger.exe` | `AegisDefenders.exe` |
| PID | 32572 | 22848 | 28628 |
| Architecture | x64 host, x64 read-only attach | x64 | x64 |
| Default routing mode | **NATIVE** | **NATIVE** | **NATIVE** |
| **Exact-value leg** | | | |
| Scan type | `scanExactViaBackend('uint32', 100)` | same | same |
| Backend selected | native, zero override | native, zero override | native, zero override |
| Regions | 1042 | 237 | 405 |
| Bytes read | 192,420,798 (~183.5 MiB) | 100,464,236 (~95.8 MiB) | 153,461,111 (~146.4 MiB) |
| Matches | 3,193 | 10,000 (cap) | 10,000 (cap) |
| Completeness | truncated/incomplete | truncated/incomplete (`DEFAULT_MAX_MATCHES` cap) | truncated/incomplete (cap) |
| Duration | 594 ms | 207 ms | 656 ms |
| **Fuzzy / drift leg** | | | |
| Scan type | module-scoped drift-tolerant AOB, 16-byte signature, `maxDistance 1` | same | same |
| Module | `Bastion.exe` | `Godlike Burger.exe` | `AegisDefenders.exe` |
| Backend selected | native, zero override | native, zero override | native, zero override |
| Ground-truth address | `0x622180` | `0x7ff69d771000` | `0x3e1020` |
| Resolved address | `0x622180` | `0x7ff69d771000` | `0x3e1020` |
| Reported distance | 1 | 1 | 1 |
| **Independently re-read distance** | **1** | **1** | **1** |
| Completeness | `complete` | `complete` | `complete` |
| Duration | 97 ms | 25 ms | 620 ms |
| **Both legs** | | | |
| `fallbackCount` | 0 | 0 | 0 |
| Difference classification | NONE — single-backend NATIVE run, no shadow comparison performed | NONE | NONE |
| Process closed and verified | yes | yes | yes |

**REAL-GAME CANARY: 3/3. Default backend NATIVE, zero override, on every title, on both legs.**

## Cleanup

All three processes were closed by the harness and confirmed gone. One stray `AegisDefenders` process (PID 21104) left over from an earlier diagnostic run of the harness was closed separately; a final sweep confirmed **no Bastion, Godlike Burger or Aegis Defenders process remains**.

## Findings worth recording

Three, all surfaced by the harness failing honestly before it passed.

1. **Process identification by name is unreliable for these titles.** Matching on loaded image path across every directory a title may run from is what makes the canary reproducible.

2. **A single fixed offset into a module is not a reliable sampling point.** The first readable page of a PE image is the header; section layout differs per title. The harness probes several offsets, and reads region-by-region rather than assuming a multi-kilobyte span sits inside one region — a mapped PE image is carved into many page-granular regions with differing protections.

3. **memoryjs module enumeration does not succeed against every real process.** Godlike Burger produced `getModules failed: method failed to retrieve the first module` on one run. This is a pre-existing legacy limitation rather than a Stage 7.5 regression — the legacy fuzzy path called the same `driver.getModules` for any module-scoped signature and failed identically — and it is precisely what native module enumeration would close. The harness falls back to hint-window scoping, the other real production scoping mechanism, rather than aborting or silently widening the search. Forward-assigned to Stage 8 (doc 133).

## Scope boundary, stated plainly

The fuzzy leg resolves a signature derived from each game's own live memory, not from a catalog definition. No shipped catalog definition for these three titles carries a drift-tolerant signature that could be exercised as-is, so a definition-driven fuzzy resolution against a commercial game remains unexercised. What is proven here is that the production fuzzy path, at its production default, resolves a real drift-tolerant signature to a real, independently verified address in a real commercial game process — which is the property mission §12 asks for.
