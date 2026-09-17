# P3-8.1 — Remote CI, Canonical Integration, Final Phase 3 Certification

## 1 — The remote CI problem and its resolution

`Docs/phase3/008` disclosed that PR #38 (targeting the shared Phase 3 branch
`feature/solith-parallel-phase3-catalog-identity`) never triggered the
repository's blocking CI workflows, because every one of them
(`ci-fast.yml`, `pr-windows.yml`, `pr-static.yml`, `semgrep.yml`,
`gitleaks.yml`, `osv-scanner.yml`, `memoryjs-integrity.yml`) is gated
`pull_request: branches: [master]`. This was a real, disclosed gap, not a
fabricated PASS — and per this mission's explicit instruction, it is not
resolved by weakening those branch filters or bypassing protected-branch
policy.

Resolution taken (mission's preferred option B): opened a new canonical
integration PR — [#39](https://github.com/Jabanaster/SOLITH/pull/39) —
from `feature/solith-phase3-xbox-msstore-discovery` directly targeting
`master`. This branch already contains the complete Phase 3 lineage (25
commits ahead of `master` at fork time: D07 closure, canonical
install/executable/session identity, BG3 and Crimson Desert Enhanced
evidence, P3-7 reconciliation, the Xbox/MS Store provider and Atomfall
discovery, and this mission's own P3-8.1 session-bind fix) — no separate
merge of multiple branches was needed.

PR #39 initially showed `mergeable: CONFLICTING` against `master` (master
had independently advanced with P2-4/P2-4.1 pointer-map work and a
test-runner refactor since this branch's fork point) — real CI simply does
not schedule a run for a PR GitHub cannot compute a merge ref for. Resolved
by merging `origin/master` into this branch (`git merge origin/master`),
resolving one real conflict in `package.json` (both sides had modified the
`test`/`test:live-memory` scripts — master's side replaced the inline
`tsx --test <hundreds-of-files>` string with a `scripts/run-node-tests.mjs`
wrapper that fixes the exact Windows command-line-length limit
`Docs/phase3/008` had disclosed as an open, undocumented-workaround-only
issue; kept master's wrapper and added this branch's two live-memory test
files — `process-watch-multi-match.test.ts`,
`process-watch-role-tiebreak.test.ts` — into `run-node-tests.mjs`'s file
lists), then re-ran the full typecheck + install-discovery + trainer-catalog
+ live-memory suites (all PASS, see §2) before pushing.

Once CI actually ran on PR #39, Semgrep failed for real:
`javascript.lang.security.audit.detect-non-literal-regexp` fired 3 times
against `src/core/install-discovery/xbox-manifest.ts` (this branch's own
Xbox manifest parser, written earlier this Phase 3 work), because its
`firstElement`/`attrValue`/`textElement` helpers built `RegExp` objects
from template strings interpolating a caller-supplied tag/attribute name.
Every call site passes a hardcoded literal (`'Identity'`, `'Name'`,
`'Executable'`, etc.) — never file content — so there was no real ReDoS
exposure, but the rule fires on the construction pattern itself and this is
a genuine, correctly-flagged finding, not a false-positive to suppress.
Fixed by rewriting the three helpers to use plain case-insensitive string
search instead of dynamic `RegExp` construction — no `RegExp` is built from
a variable anywhere in the module now. Verified byte-identical output
against the real installed Atomfall package's `appxmanifest.xml` and
`MicrosoftGame.config` before and after the rewrite; `tests/install-discovery-xbox.test.ts`
8/8 PASS; full `install-discovery` suite 112/112 PASS.

After that fix, every blocking check ran and passed on the first attempt —
**no retry-dependent certification, no rerun-to-green**:

| Check | Result | Duration |
|---|---|---|
| TypeScript and architecture checks | **PASS** | 16s |
| Windows native and Electron gate | **PASS** | 7m4s |
| fast (CI Fast) | **PASS** | 8m46s |
| scan (Semgrep) | **PASS** | 37s |
| scan (Gitleaks) | **PASS** | 9s |
| scan-pr / osv-scan (OSV-Scanner) | **PASS** | 27s |
| verify (Vendored memoryjs integrity) | **PASS** | 9s |
| scan-full | SKIPPED (scheduled/full-audit variant, not PR-gated) | — |

`gh pr checks 39` exits 0; `gh pr view 39` reports
`mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`. Final canonical SHA:
`9d40ecddd4ddc2510ca2065fca4dae0c5beadeae`.

**REMOTE BLOCKING CI EXECUTED: YES. REMOTE CI: PASS.**

## 2 — Fresh worktree re-verification at the exact final SHA

A second fresh, isolated worktree (`solith-p381-fresh-verify2`, detached
HEAD) was created at `9d40ecddd4ddc2510ca2065fca4dae0c5beadeae` — this
mission's actual final code SHA (the earlier `docs(phase3)` commit at
`94c7a30` used for the first fresh-worktree check in `Docs/phase3/009`
predates the master-merge and Semgrep fix, so it is superseded by this
check, not a substitute for it). `npm ci` clean, then:

- `tsc --noEmit -p tsconfig.json` (renderer) — **PASS, 0 errors**
- `tsc --noEmit -p tsconfig.electron.json` (electron) — **PASS, 0 errors**
- `npm run test:install-discovery` — **112/112 PASS**
- `npm run test:trainer-catalog` — **204/204 PASS**
- `process-watcher.test.ts` + `process-watch-multi-match.test.ts` +
  `process-watch-role-tiebreak.test.ts` — **18/18 PASS**

Worktree removed cleanly afterward (`git worktree remove --force`, no
leftover `p381` worktrees).

**FRESH WORKTREE: PASS.**

## 3 — Canonical integration audit

`git diff origin/master...9d40ecd --name-only` (checked before opening PR
#39, re-confirmed after the merge+fix commits) touches no path under
`solith-phase2-structure-discovery` or any P2-5-named file — P2-5 is
untouched by this entire mission, consistent with SOLITH.MD's explicit
"DO NOT TOUCH P2-5" instruction. The diff is exactly the Phase 3 lineage
described in §1 plus this mission's session-bind fix, the master-merge
(bringing in unrelated, already-integrated P2-4/P2-4.1 pointer-map work
that master had independently gained — not authored by this mission, only
merged in as part of reconciling with master), and the two new commits
this pass added (`5545064` session-bind fix, `94c7a30` docs, `d7ba902`
merge, `9d40ecd` Semgrep fix).

**Canonical integration PR:** [#39](https://github.com/Jabanaster/SOLITH/pull/39)
(`feature/solith-phase3-xbox-msstore-discovery` → `master`), CI green,
mergeable, **not yet merged** — merging into `master` is a protected-branch,
shared-history action; per this mission's own §13 ("merge using normal
protected-branch workflow with explicit owner authorization... If the
platform blocks merge: report the exact ready-to-merge state and wait for
owner action"), this is reported as ready-to-merge rather than merged
unilaterally. The PR is fully green and conflict-free; the owner can merge
it via GitHub's UI or `gh pr merge --merge 39` at any time.

**CANONICAL MERGE SHA: not yet merged — PR #39 is ready, HEAD =
`9d40ecddd4ddc2510ca2065fca4dae0c5beadeae`.**

## 4 — Final certification

Every item of SOLITH.MD's Final Phase 3 Gate is satisfied with reproducible
evidence:

- Xbox/MS Store discovery implemented — `Docs/phase3/008`.
- Atomfall install discovered automatically — `Docs/phase3/008`, §2 of this
  doc (fresh-worktree re-confirmation).
- Atomfall canonical executable explicitly resolved — `bin\Atomfall_dx12.exe`
  (`Docs/phase3/008`, unchanged).
- Atomfall canonical live process binds correctly — `Docs/phase3/009` §4
  (fixed this pass; previously the launcher bound instead).
- Atomfall 3/3 launch-bind proof — `Docs/phase3/009` §4.
- Seven-title matrix 7/7 including session identity — `Docs/phase3/009` §7.
- BG3 regression PASS — `Docs/phase3/009` §7 (carried forward, zero code
  path touched).
- Palworld regression PASS — `Docs/phase3/009` §5 (re-verified live this
  pass; corrected from wrapper-PID to engine-PID bind, the same generic fix
  as Atomfall).
- Crimson Desert PASS — `Docs/phase3/009` §7 (carried forward, zero code
  path touched).
- install-discovery PASS — 112/112, this doc §2.
- trainer-catalog PASS — 204/204, this doc §2.
- session-binding PASS — `process-watcher.test.ts` +
  `process-watch-multi-match.test.ts` + `process-watch-role-tiebreak.test.ts`,
  18/18, this doc §2.
- production catalog path used — every proof script this pass set
  `ELECTRON_USER_DATA_PATH` to a real copy of `%APPDATA%/solith/solith.db`
  and called `initDatabase()` directly; no fixture/fallback DB was used for
  any live proof.
- fallback DB not used — see above.
- fresh worktree PASS — this doc §2.
- blocking remote CI actually executed — this doc §1 (previously
  never triggered; root-caused to branch-gating + a real merge conflict,
  both resolved).
- blocking remote CI PASS — this doc §1, first attempt, no retries.
- canonical integration complete — PR #39 open, green, mergeable; not yet
  merged pending explicit owner authorization (see §3).
- ROADMAP updated — see the P3-8.1 reconciliation note appended to
  `ROADMAP.md`.
- P2-5 untouched — this doc §3.
- local/remote state reconciled — `git fetch origin` +
  `git rev-parse HEAD` + `git rev-parse origin/feature/solith-phase3-xbox-msstore-discovery`
  both equal `9d40ecddd4ddc2510ca2065fca4dae0c5beadeae`.
- worktree clean — `git status --short` empty.

**Phase 3 verdict: CERTIFIED COMPLETE**, with the canonical integration PR
(#39) open, green, and ready for the owner's merge action.
