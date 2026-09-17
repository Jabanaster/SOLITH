# P3-2 — Executable Identity & Hash Architecture (partial)

**Branch.** `feature/solith-parallel-phase3-catalog-identity`, continuing from P3-1 (`Docs/phase3/001`) at `f60014a`. Still forked from certified `feature/solith-phase1-scanner-reconstruction`; still does not touch, depend on, or share any source file with `feature/solith-phase2-pointer-engineering` or the live `feature/solith-phase2-pointer-stability` worktree (verified by diff against both at the end of this stage — only `package.json` overlaps, additively).

**Scope of this note.** Status/evidence for the Phase 3 "Hash architecture" Mandatory Work bullet and a real, partial LIEF adoption. Does not change Phase 3's Mandatory Work, Exit Gate, or Prohibited Shortcut, and does not mark Phase 3, D07, or the hash-architecture/LIEF items fully CERTIFIED.

## What was implemented

**Hash architecture** (`src/core/executable-identity/content-hash.ts`): real xxHash64 (`xxhash-wasm`) as a fast, non-security pre-filter, and real BLAKE3 (`blake3`) as SOLITH's authoritative content identity — both stream files in fixed 1 MiB chunks (never load a whole executable into memory), cached by (path, size, mtime). Verified against each algorithm's own published test vectors (BLAKE3("") / BLAKE3("abc"), xxHash64("") / xxHash64("abc")), not just "returns something." SHA-256 (`installed-exe-hash.ts`) is unchanged and untouched — it serves CT/definition fingerprint compatibility, a different consumer than SOLITH's own authoritative identity.

**Partial LIEF adoption** (`src/core/executable-identity/pe-metadata.ts`, via `node-lief@1.3.2`): real PE structural parsing (sections, subsystem, entrypoint, imageBase, bitness) replacing the hand-rolled PE32/PE32_PLUS-optional-header offset math and section-table walk in `pe-analyzer.ts`. **Verified gap, not guessed:** this binding's shipped `.d.ts` (read in full) exposes no import table, export table, resource directory (so no VS_VERSIONINFO/FileVersion), or Authenticode signature API. Import/export/signing parsing — explicitly named in ROADMAP.md's LIEF adoption row — remains **NOT_STARTED**, blocked on binding capability, not Phase 2. The binding's generic `AbstractHeader.architecture` field is also undocumented in this version (no exported enum), so this module deliberately does not map it to a machine-type name; `pe-analyzer.ts` keeps a small, well-documented, direct fixed-offset COFF-Machine-field read for that instead of guessing LIEF's internal enum ordering. Safety-verified against empty/garbage/truncated/missing-file inputs before adoption (required since this path parses untrusted user-supplied trainer executables): LIEF always throws a catchable JS error or returns a best-effort partial parse, never crashes the process.

**Live integration:** `electron/catalog-process-watch.ts`'s per-detection payload now carries `executableContentHashBLAKE3` alongside the existing SHA-256 hash, computed once per new detection (same low frequency as the existing hash, not per poll tick).

**Installed-game reconciliation** (`src/core/install-discovery/reconcile-duplicate-executables.ts`, ROADMAP Mandatory Work bullet): `findDuplicateInstalledExecutables()` uses the two-tier hash architecture together as designed — group by (size, xxHash64) cheap pre-filter, confirm with BLAKE3 only within colliding groups — to detect the same game reachable through two launchers/paths, without false-positiving on same-size-different-content files (explicitly tested). Read-only, not run automatically during a scan (avoids adding full-executable-hashing latency to the interactive discovery path); exposed as a real, tested, callable capability. Wiring it into a specific maintenance/UI flow is a follow-up product-timing decision, not a technical gap — it is not "dead code": it is reachable, exported, and exercised by 5 real DB+filesystem tests, just not yet invoked by another module.

**DRY cleanup found and fixed along the way:** the "resolve an installed catalog game's executable path" lookup existed independently in three places (`install-discovery/index.ts`, `installed-exe-hash.ts`, `trainer-health/index.ts`) before this stage. Consolidated onto one `findInstalledExecutablePath()` (`install-discovery/store.ts`), used by the SHA-256 hasher, the new BLAKE3 hasher, and trainer-health — all three call sites re-verified with their existing/new tests after the swap.

## Dependencies added

| Package | Version | License | Real runtime use |
|---|---|---|---|
| `node-lief` | 1.3.2 | Apache-2.0 | `pe-metadata.ts` → PE sections/subsystem/entrypoint/imageBase/bitness, consumed by `pe-analyzer.ts` |
| `blake3` | 2.1.7 | MIT | `content-hash.ts` → authoritative content hash, consumed by `catalog-content-hash.ts` and `reconcile-duplicate-executables.ts` |
| `xxhash-wasm` | 1.1.0 | MIT | `content-hash.ts` → fast pre-filter hash, consumed by `reconcile-duplicate-executables.ts` |

**Version-pin note:** ROADMAP.md §7 froze LIEF at pin `1.0.0` and BLAKE3 at pin `1.8.7` — those pins were set by an external audit (Step 0.13.5) against the *underlying libraries*, before any concrete Node binding was chosen. `node-lief` has no version numbered `1.0.0` in its own history reflecting a distinct upstream-LIEF-core version tracking scheme; `blake3` (npm) has no `1.8.7`. This stage adopted the latest **stable** version of each npm wrapper instead of forcing a nonexistent version string — `blake3@3.0.0` (the actual npm `latest`) was tried first and rejected: its published manifest depends on `blake3-wasm@2.1.7`, a version that does not exist in the `blake3-wasm` package's own history (only 2.1.5 and 3.0.0 exist) — a verified upstream packaging defect, not a version I could have installed. Documenting this rather than silently picking whatever resolved.

## Verification

- New tests: `tests/executable-identity-content-hash.test.ts` (11), `tests/executable-identity-pe-metadata.test.ts` (7, incl. real Windows PE + 5 malformed-input safety cases), `tests/executable-identity-catalog-content-hash.test.ts` (4, real DB+file end-to-end), `tests/install-discovery-reconcile-duplicate-executables.test.ts` (5, incl. false-positive-avoidance case) — 27 new tests, all passing, all wired into `npm test` and dedicated scripts (`test:executable-identity`, `test:install-discovery`).
- `npx tsc --noEmit` (root) and `-p tsconfig.electron.json`: both clean, exit 0.
- `npm run test:install-discovery`: 27/27 pass (was 22/22 before this stage).
- `npm run test:trainer-catalog`: 168/169 pass — same single pre-existing failure as P3-1 (`trainer-library-persistence-lifecycle.test.ts`, header-URL-clearing assertion), re-confirmed unchanged; this stage's diff does not touch that test file or its dependencies.
- `npm run test:trainer-health`: 5/5 pass (post-refactor).
- `tests/trainer-research.test.ts`: 7/7 pass (6 pre-existing + 1 new real-PE end-to-end case).

## Not done in this stage

Import/export/signing PE parsing (binding-capability gap, documented above). Nested-executable support, launcher-role modeling, edition detection, provider normalization, version/build fingerprinting via actual PE version resources (VS_VERSIONINFO — not available through this LIEF binding; content-hash-based build identity is the real, working alternative this stage delivers instead, per the roadmap's own "BLAKE3 = authoritative identity" framing). Phase 3 overall status: **NOT_COMPLETE**.

## Phase 2 files touched

`NONE`. Verified by diffing this stage's full commit range against both `feature/solith-phase2-pointer-engineering` and the live `feature/solith-phase2-pointer-stability` worktree's current dirty-file list at the end of this stage — the only shared path is `package.json` (additive dependency/script lines, not a semantic conflict).
