# NEW-1 / NEW-2 — Independent Integration Review

Review date: 2026-07-30 (session continuation)
Worktree: `G:\ACTIVE_PROJECTS\solith-new1-new2`
Source branch: `security/new-1-new-2-trust-boundary`
Source SHA: `cf7745d756352afc9d00c7b07070c7a1c59ab730`
Target branch: `integration/b1-1-closeout`
Target SHA: `a63e9f57bc608e70212da1b09fb578f40eab889a` (unmoved since the security branch was created off it)
Reviewed commit range: `a63e9f5..cf7745d` (12 commits)

## Verdict

**READY FOR CONTROLLED INTEGRATION**

## Starting-state verification

```
branch:        security/new-1-new-2-trust-boundary
HEAD:          cf7745d756352afc9d00c7b07070c7a1c59ab730
status:        clean, nothing staged
merge-base:    a63e9f57bc608e70212da1b09fb578f40eab889a (matches expected base exactly)
commit count:  12 (git rev-list --count a63e9f5..HEAD)
git operation: none active
```

## Commit ledger (12 commits, each independently inspected via `git show --stat --summary`)

| SHA | Subject | Class | Files | Coherent | Unrelated content |
|---|---|---|---|---|---|
| 7a62fee | security: enforce trusted senders for write and injector IPC | prod | electron/live-memory-ipc.ts, electron/main.ts | yes | none |
| e0ca15a | security: block untrusted navigation and popup creation | prod | electron/main.ts, sender-validation.ts, wisp-overlay.ts, trainer-overlay.ts, trusted-sender-registry.ts | yes | none |
| 7939b41 | test: cover NEW-1 and NEW-2 trust boundaries | test | 2 new test files, package.json | yes | none |
| a01a8ac | docs: record NEW-1 and NEW-2 closure evidence | docs | 3 new evidence files | yes | none |
| 8780433 | fix: address independent-review conditions for NEW-1/NEW-2 | prod | main.ts, wisp-overlay.ts, trainer-overlay.ts, sender-validation.ts | yes | none |
| 152a608 | docs: record independent review verdict and corrective-pass evidence | docs | 5 evidence files (+ new independent-review.md) | yes | none |
| c5953fe | security: enforce trusted senders for hook and trainer rollback | prod | electron/live-memory-ipc.ts, electron/main.ts | yes | none |
| bf43742 | test: cover remaining NEW-1 sender boundaries | test | 1 test file | yes | none |
| 8a4cf3b | docs: close remaining NEW-1 review conditions | docs | 3 evidence files | yes | none |
| 9d69ce3 | docs: record final NEW-1 independent closure | docs | evidence files | yes | none |
| 1bfe1f3 | docs: correct final NEW-1 evidence per third independent review | docs | design.md, independent-review.md, remaining-risks.md | yes | none |
| cf7745d | docs: record VERIFIED COMPLETE and close NEW-1/NEW-2 evidence chain | docs | independent-review.md, verification-final.txt | yes | none |

No commit depends on a *later* corrective commit to be individually coherent — each stands as a complete unit at the time it landed (later commits correct earlier evidence claims, which is expected of an iterative review chain, not a sign of incoherent commits). Rollback boundary: any prefix of this 12-commit sequence can be reverted cleanly back toward `a63e9f5`; the security commits (7a62fee, e0ca15a, 8780433, c5953fe) are the ones with runtime effect — reverting only docs/test commits has zero runtime impact.

## Combined-diff review (`a63e9f5..cf7745d`)

```
15 files changed, 1594 insertions(+), 20 deletions(-)
```

6 new evidence files, 2 new test files, 5 modified production files (`electron/live-memory-ipc.ts`, `electron/main.ts`, `electron/sender-validation.ts`, `electron/wisp-overlay.ts`, `electron/trainer-overlay.ts`), 1 modified core file (`src/core/security/trusted-sender-registry.ts`, visibility-only change), `package.json` (2 script additions). `git diff a63e9f5..cf7745d --check`: clean, no whitespace/conflict-marker errors.

Read the full combined production-code diff directly (not just per-commit): no contradictory checks, no duplicate trust helpers (main.ts's local `requireTrustedSender` and live-memory-ipc.ts's are separate by necessity of file scope but both call the same underlying `validateIpcSender`), no accidental weakening of any pre-existing check, no unreachable tests, no unexplained file changes, no stale SHA references that were left uncorrected, no false packaged-verification or merge-readiness language anywhere in the 6 evidence files.

## NEW-1 destructive-handler result

16 destructive channels in the NEW-1 subsystem (V2 live-memory / injector-launch / in-process-hook / TrainerHost) now require `requireTrustedSender(event)` → `validateIpcSender(event, ['main'])`: 6 pre-existing before this branch (`live-memory-rollback`, `live-memory-freeze-propose/-issue-consent/-start/-stop/-status`), 10 added across this branch's two implementation passes (`live-memory-issue-write-consent`, `live-memory-confirm-write`, `in-process-propose-injector-launch`, `in-process-issue-injector-consent`, `in-process-register-injector-helper`, `in-process-confirm-injector-launch`, `trainer-host-approve-and-write`, `in-process-confirm-hook`, `in-process-rollback-hook`, `trainer-host-rollback`). Confirmed by direct inspection: the check is the first synchronous statement in every one of the 16 handlers, before every pre-existing protection (session/bundle ownership, native consent, process-identity verification, Authenticode/path checks, in-process feature gate, online-guard recheck, TrainerHost ownership-by-webContents-id).

Explicitly reviewed and reconciled: `in-process-confirm-hook`, `in-process-rollback-hook`, `trainer-host-rollback` (this branch's final hardening targets) and the six earlier reference channels — all consistent, no divergence.

V1 legacy save-editor channels (`restore-backup`, `apply-proposal`, `delete-game`, `delete-recipe`, `revoke-save-location`) are accurately classified `OUTSIDE NEW-1 CLASS — JUSTIFIED` in `remaining-risks.md`, on a provenance basis (never named by the original audit, never in Batch B1.1 scope — not an implementation-mechanism distinction, which the third independent review found and corrected). They are not falsely presented as fixed; their zero-sender-check gap is explicitly documented as a real, separately-tracked item for a future "Privileged IPC hardening beyond B1.1" pass. The evidence does not claim all destructive Electron IPC is secure — the claim is narrower and accurate: all destructive handlers in the reviewed NEW-1 class are hardened.

## NEW-2 result

All three privileged windows (main, Wisp overlay, trainer overlay) call `applyWindowNavigationPolicy` immediately after `registerTrustedSolithWindow`, with the identical `allowedUrlPrefixes` array used for both. Verified in code and via the real-Electron e2e suite:
- Navigation deny-by-default: same-window navigation to unexpected HTTP/HTTPS origins, local files, `data:` URLs, and wrong-port localhost look-alikes are all blocked (tests 2-5, 96-132).
- Popup deny-by-default: `window.open()` and `target="_blank"` never create an in-app `BrowserWindow` (tests 6-7).
- Dev/packaged origin separation is exact: `isDev ? ['http://localhost:3000'] : [packagedFileUrl]` — no window ever trusts both simultaneously; packaged builds never trust the dev-server origin (closes the corrective-pass finding).
- Approved `https:` popups get a controlled OS-browser handoff via `shell.openExternal`, called as a side effect while `{action:'deny'}` is still always returned — no in-app window is ever created for any popup regardless of scheme.
- No other privileged `BrowserWindow` exists in the codebase beyond these three (confirmed via `grep -r "new BrowserWindow"` across `electron/`).
- Wisp functionality was not altered by the window hardening — confirmed via the Wisp isolation proof below.

## Test-quality assessment

62/62 focused unit tests, 20/20 real-Electron e2e tests — both totals independently reproduced this review, not accepted from the evidence pack. Test source was read, not just totals: the e2e suite's 10 positive-control tests (legitimate caller reaches business logic) are paired with a single negative-control test that calls all 10 hardened channels from the real Wisp overlay window and asserts genuine `sender_rejected:unauthorized_window_type` — this is the assertion that actually proves wiring (a prior independent review mutation-tested this exact claim by deleting each check and confirming the negative control fails; documented in `independent-review.md`). Positive-control tests alone would not catch a deleted check — this is a known, documented limitation, not a hidden one, and the negative control closes it for all 10 channels.

Unit tests (`tests/new1-new2-sender-validation.test.ts`) cover child frame, destroyed sender, vanished/missing frame, unregistered sender, wrong window type, and navigated-away sender rejection against the real `validateIpcSender` function (not a reimplementation) via faithful faked Electron shapes, plus the navigation-policy allow/deny matrix. DevTools-sender and live-child-iframe reproduction remain unit-level rather than live-Electron — a documented limitation, judged proportionate by three prior reviews since the underlying `isMainFrame` check is generic Electron identity comparison with no Solith-specific surface to spoof.

## Real-Electron test integrity

`tests/new1-new2-trust-boundary.e2e.test.ts` launches the real, non-packaged `dist-electron/main.js` via Playwright's `_electron.launch` (same pattern as the pre-existing `tests/electron.e2e.test.ts`) — real `BrowserWindow`, real `webContents`, real navigation events, real Wisp-overlay/trainer-overlay window creation via their production IPC toggle channels. This is **not packaged** (no electron-builder artifact involved) and evidence never claims otherwise. DevTools-sender and raw child-iframe-sender scenarios are unit-level/faked, not live-Electron, and are labeled as such in `remaining-risks.md`.

Transient worker-process crash: one prior test run hit a single Playwright worker crash (Windows exit code consistent with an access-violation-style termination) on one specific test. Rerunning that test in isolation passed; rerunning the complete 20-test suite passed cleanly (20/20) both then and again in this review's own fresh run (no retries needed, first attempt clean). Classified: **resolved flake** (sequential real-Electron process launches under sandbox load), not a reliability issue — reproduced clean twice more in independent review passes with zero recurrence.

## Independent verification battery (this review, executed fresh)

| Check | Command | Result |
|---|---|---|
| Node/npm | `node --version` / `npm --version` / `where node` / `where npm` | v24.15.0, npm 11.12.1, `C:\Program Files\nodejs\node.exe` — no local Node 22 toolchain exists; none downloaded |
| Electron TS | `npx tsc -p tsconfig.electron.json --noEmit --pretty false` | exit 0 |
| Main TS | `npx tsc -p tsconfig.json --noEmit --pretty false` | exit 0 |
| Focused security tests | `new1-new2-sender-validation` + `trusted-sender-registry` + `live-memory-rollback-freeze-ipc-validation` + `gate2-1-test-build-hooks` | 62/62 pass |
| Real-Electron e2e | `npx playwright test tests/new1-new2-trust-boundary.e2e.test.ts` | 20/20 pass, 1.6m |
| Live-memory | `npm run test:live-memory` | 257/257 pass |
| Literal `npm test` | `npm test` | exit 1, blocked at `pretest` → `scripts/check-node.mjs`: "Unsupported Node.js v24.15.0. Required: Node.js 22.x" — NOT claimed as passed |
| Full suite equivalent | exact `package.json` `"test"` script string, run directly with `node_modules/.bin` on PATH | 1046 pass + 10 pass = 1056/1056, exit 0 |
| Vite build | `npm run build:vite` | exit 0 |
| Electron build | `npm run build:electron` | exit 0, verifier 29/29 |
| Whitespace/conflict | `git diff --check` (working tree and full range) | clean |
| Working tree | `git status --short --untracked-files=all` | empty |

No local Node 22 toolchain was found or installed; this matches the repo's own documented environment limitation and is not a defect in the security work.

## Wisp isolation

```
git diff a63e9f5..cf7745d -- src/core/companion/wisp.ts tests/companion-wisp.test.ts   → empty
git log --name-only --format= a63e9f5..cf7745d -- src/core/companion/wisp.ts tests/companion-wisp.test.ts → empty
```

`electron/wisp-overlay.ts` diff (full range) contains exactly: one import-line change (added `applyWindowNavigationPolicy`), one array hoist (`allowedUrlPrefixes` extracted to a local const, now `isDev`-gated), and one added `applyWindowNavigationPolicy(...)` call at the window-creation site. Zero changes to reducers, state, quiet mode, mood logic, expressions, lifecycle, positioning, visual behavior, growth/evolution, Game Bar functionality, or companion interactions.

## Secret and hygiene scan

`git diff a63e9f5..cf7745d` searched for API keys, bearer tokens, private keys/certificates, passwords, machine-specific absolute paths (`C:\Users\...`, `/home/...`) — zero matches. File list (`git diff --name-status`) contains only source, test, and evidence/doc files; no generated output, build cache, package artifact, binary, crash dump, or diagnostic log entered any commit.

## Integration compatibility

- `integration/b1-1-closeout` is still at `a63e9f5` — unmoved since the security branch was created off it, confirmed via `git rev-parse HEAD` in that worktree.
- `git merge-base --is-ancestor a63e9f5 HEAD` on the security branch: true — `a63e9f5` is a direct ancestor of `cf7745d`, meaning **a clean fast-forward is possible**; no merge commit or cherry-pick is structurally required.
- No file touched by the security branch overlaps with the untracked/modified noise already present in the `solith-b11-integration` worktree (a modified evidence JSON and unrelated .NET test-fixture build artifacts) — zero conflict surface.
- The 12-commit sequence should be preserved intact on fast-forward (not squashed) to keep the review trail — including the corrective-pass commits — auditable in `integration/b1-1-closeout`'s own history.
- No documentation currently references the security branch name in a way that would go stale after integration (evidence files reference commit SHAs, not the branch name, as the durable identifier).
- Post-integration, the full verification battery above should be rerun against `integration/b1-1-closeout` directly (not assumed to carry over) — packaged verification remains a separate, still-unperformed gate regardless of integration.

## Final verdict

**READY FOR CONTROLLED INTEGRATION.** Branch is stable, clean, and unpushed. All 12 commits are properly scoped and individually coherent. No same-class handler gap remains in the reviewed NEW-1 class. NEW-2 covers all three privileged windows. Tests genuinely prove the claimed properties (positive + negative control, one prior review's mutation-testing confirmed this directly). TypeScript, builds, and the full underlying test suite all pass. Wisp is fully isolated. Evidence is accurate as of this review (four prior independent reviews' findings were all closed with real corrections, not concealment). Secret scan is clean. The branch is fast-forward-compatible with `integration/b1-1-closeout`. Working tree ends clean.

## Remaining external conditions (unchanged, separate from this verdict)

- Owner integration authorization — not yet granted; this review recommends, does not grant.
- Post-integration verification — required, not yet performed (this battery must be rerun against the integration branch after fast-forward).
- Independent review of the resulting integration branch — required.
- Merge authorization to `master` — not granted.
- Post-merge verification — not performed.
- Packaged build (electron-builder) — not performed.
- Executable SHA-256 — not generated (no package built).
- Packaged Gate 2.5 verification (`tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts`) — not run, requires a packaged executable.
- Clean-machine acceptance — NOT PERFORMED, external environment required.
- B1.1 promotion — NOT AUTHORIZED.
- Release decision — DENIED.
- B2/B2A — NOT AUTHORIZED.

## Explicit non-actions (this review)

No integration performed. No merge. No push. No `master` modification. No packaging. No B1.1 promotion. No release authorization. No B2/B2A. No Wisp integration. No production code was modified during this review.

## Exact next step

Owner reviews this integration-review evidence and explicitly authorizes controlled integration of the verified security commit range (`a63e9f5..cf7745d`, fast-forward) into `integration/b1-1-closeout`. Immediate merge to `master` is not recommended.
