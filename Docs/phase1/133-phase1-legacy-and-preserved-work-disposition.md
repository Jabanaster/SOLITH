# Phase 1 — Legacy and Preserved-Work Disposition

## Part 1 — Preserved branches

No branch is deleted. Each is given an explicit disposition so no preserved work is left unaccounted.

| Branch | Tip | In `master`? | In this branch? | Commits ahead of `master` | Disposition |
|---|---|---|---|---|---|
| `preserve/review-gate2-5-working-tree-2026-09-12` | `9fdc6e7` | no | no | 14 | `FUTURE_PHASE` |
| `preserve/ct-selective-import-2026-09-12` | `6696667` | no | no | 1 | `NOT_RELEVANT_TO_PHASE1` |
| `preserve/catalog-process-detection-fix-2026-09-12` | `965e604` | no | no | 8 | `FUTURE_PHASE` |
| `feature/adaptive-wisp-platform` | `0f8e211` | no | no | 20 | `NOT_RELEVANT_TO_PHASE1` |
| `feature/adaptive-wisp-consent-completion` | `d1b4018` | no | no | 15 | `NOT_RELEVANT_TO_PHASE1` |
| `feature/solith-canonical-convergence-phase0` | `3b8c1c3` | no | **yes** | 5 | `ALREADY_INTEGRATED` |

### Notes per branch

**`preserve/review-gate2-5-working-tree-2026-09-12`** — also the checked-out branch of the read-only shipping tree at `G:\ACTIVE_PROJECTS\SOLITH`. Contents are the online-foundation track: Cloudflare Workers/D1 catalog backend, provider ingest schema and orchestration, tombstone state engine, submission invariant closure, plus a provider-ingest scheduler contract. It does touch `electron/live-memory-ipc.ts` and several `src/core/live-memory/` files, but for *different features* — `read-preflight.ts`, `trainer-deck-read.ts`, `attach-catalog-verification.ts` — none of which is a scanner primitive, an AOB path, or a pointer path. **No scanner-reconstruction code is preserved here**, consistent with ROADMAP.md's own Phase 1 statement: *"Preserved Work Inputs. None — no preserved ref contains scanner-reconstruction code."* Destination: the online/community phases.

**`preserve/ct-selective-import-2026-09-12`** — a single commit capturing the CT selective-import feature. Touches no `live-memory`, `scanner`, `signature`, `aob` or `native` file. Destination: Phase 5 (CT compatibility).

**`preserve/catalog-process-detection-fix-2026-09-12`** — catalog process-detection and multi-match fixes plus the SOL-1 authority track (domain routing, single-use grants, emergency stop, packaged runtime E2E). Touches `live-memory-session.ts` and `process-watcher.ts`, but for authority routing and process detection, not scanning. Destination: Phase 13 (safety/security hardening) and the catalog track.

**Wisp branches** — Phase 11. No scanner content.

**`feature/solith-canonical-convergence-phase0`** — PR #29's head, and an ancestor of this branch: Phase 0's canonical reproducibility work is already in the Phase 1 lineage. PR #29 itself remains OPEN against `master` and is not merged.

**PRESERVED WORK WITH UNKNOWN DISPOSITION: 0.**

## Part 2 — Pull requests

| PR | Title | Base | Head | Head SHA at check | State | Merged |
|---|---|---|---|---|---|---|
| #31 | Phase 1 Stage 7.3: production scan cancellation + native default migration (CI validation only, DO NOT MERGE) | `master` | `feature/solith-phase1-scanner-reconstruction` | see doc 129 | **OPEN** | **no** |
| #29 | Phase 0: canonical reproducibility and validation truth | `master` | `feature/solith-canonical-convergence-phase0` | `3b8c1c3` | **OPEN** | **no** |

Neither was merged, and neither was modified beyond pushing new commits to #31's existing head branch. Required checks and their outcomes: doc 129.

Also open and untouched by this work: #30 and #28 (Dependabot), #26 (SOL-1 closeout).

## Part 3 — Forward assignments

Every item below is explicitly carried forward with a named destination. Nothing is left as a silent carryover.

### FA-1 — D05 pointer-depth truth-reporting → **Phase 1 (cannot be forward-assigned)**

- **Defect.** Pointer-scan depth truncation and misreporting: `levelsSearched: 1` against `maxDepth: 3`, with `truncated: false`.
- **Reason it is open.** Untouched by every Stage 7.x pass, by explicit instruction each time.
- **Target phase.** ROADMAP line 165 assigns D05 to Phase **1**. Line 116 splits pointer scanning into "1 (truth-reporting), 2 (feature)", so only the *feature* work belongs to Phase 2 — the truth-reporting half is Phase 1 scope. **This item therefore cannot be forward-assigned**, and it is the reason Phase 1 is not complete (doc 136).
- **Dependency.** None blocking. The fix is truth-reporting in `pointer-scanner.ts`, in the same shape as the five sibling `catch{continue}` repairs already proven.
- **Evidence.** ROADMAP.md lines 96, 116, 165, 270; doc 119 row; doc 132 D05.

### FA-2 — Native module enumeration → **Stage 8**

- **Defect.** `NativeScanTarget` cannot enumerate modules, so `NativeScannerBackend` depends on an injected legacy module list; and `memoryjs`'s `getModules` genuinely fails against some real processes (observed on Godlike Burger, doc 127).
- **Reason deferred.** Requires new Rust in the scanner core. Not a regression — the legacy fuzzy path had the identical dependency and identical failure mode.
- **Target.** Stage 8 (legacy scanner retirement), where the legacy driver is removed and the dependency must go with it.
- **Evidence.** Docs 124, 126, 127.

### FA-3 — Unrouted legacy value-scan paths → **Stage 8**

- **Scope.** `scanFirstAutoMatrix`, `scanNext`, `scanFirstUnknown`, `scanNextFromUnknown` — range/comparison, multi-type fan-out and unknown-initial-value scans, all still served by `memory-scanner.ts`. `scanFirstAutoMatrix` in particular can still run exact-value comparisons on the legacy engine.
- **Reason deferred.** The canonical backend contract does not yet define a range/comparison or unknown-initial operation; this was the stated migration boundary from Stage 7 onward, not an oversight discovered late.
- **Target.** Stage 8.
- **Evidence.** `scanner-backend.ts` module doc; docs 83, 97, 126.

### FA-4 — Point-read call sites → **Stage 8**

- **Scope.** `real-time-scanner.ts`, `live-correlation-watcher.ts`, `research/memory-viewer.ts`, `research/hex-inspector.ts`, `runtime/windows-readonly-process-module-reader.ts`, `hook-engine.ts`'s original-byte snapshot.
- **Reason deferred.** None enumerates regions or performs a search; they are single-address reads at already-resolved addresses, so they are not primitive or AOB scan paths.
- **Target.** Stage 8, for uniformity when the legacy driver is retired.
- **Evidence.** Doc 126.

### FA-5 — Semgrep full-repo audit findings → **security follow-up, outside Phase 1 scanner scope**

- **Scope.** 81 findings from `semgrep scan --config p/default` over the whole repository: 44 `path-join-resolve-traversal`, 17 `unsafe-formatstring`, 6 `prototype-pollution-loop`, 4 `detect-child-process`, 4 `spawn-shell-true` (scripts only), 3 `detect-non-literal-regexp`, 3 others.
- **Classification.** `SECURITY_FOLLOWUP_REQUIRED` / `OUT_OF_PHASE1_SCANNER_SCOPE`.
- **Why not fixed here.** None is in a file this stage touched; none is in `src/core/live-memory/`; and the job that produces them runs without `--error` and therefore does not block. The blocking PR gate reports **0** findings. Fixing 81 unrelated findings inside a scanner-certification stage would be exactly the contamination mission §14 forbids.
- **Target.** Phase 13 (safety, security and recovery hardening), or a dedicated security pass.
- **Evidence.** Doc 123.

### FA-6 — Dependabot findings → **security follow-up**

- **Scope.** 18 findings / 12 high, as separately reported. **Not verified or re-counted by this stage, and explicitly not claimed as fixed.** `npm audit` reports 0 against the current lockfile, which is a different tool over a different surface and is not evidence that the Dependabot findings are resolved.
- **Classification.** `SECURITY_FOLLOWUP_REQUIRED` / `OUT_OF_PHASE1_SCANNER_SCOPE`. None blocks the build or any required CI check.
- **Open PRs carrying some of this work:** #30, #28. Neither merged.
- **Target.** Phase 13 / dedicated dependency pass.

### FA-7 — `x86_on_wow64` positive validation → **Stage 8 or Phase 12**

- **Scope.** `TargetArchitecture` reports `x86_on_wow64`, but has never been validated against a real 32-bit target — no i686 Rust target is installed in this environment.
- **Classification.** Disclosed continuously since Stage 2 doc 17; `DETERMINISTIC_PASS` in the failure matrix rather than a real pass.
- **Target.** Stage 8 or Phase 12's certification program, where a 32-bit title can be included deliberately.

### FA-8 — Real-game coverage percentage → **Phase 1 (open exit-gate item)**

- **Scope.** ROADMAP Phase 1 requires *"real-game scan coverage measured against at least one of the 7 curated titles with a recorded, honest coverage percentage — not a synthetic-fixture-only claim"*, and doc 10's exit gate names Stardew Valley and Palworld specifically.
- **Status.** Not recorded. Stardew Valley is confirmed **not installed** on this machine (docs 80 and 91, reconfirmed twice). The Stage 7.3/7.4/7.5 canaries use Bastion, Godlike Burger and Aegis Defenders and record regions, bytes read, matches, completeness and duration — but **not** a coverage percentage against total committed memory, and not against a curated-roster title.
- **Target.** Phase 1. See doc 134.
