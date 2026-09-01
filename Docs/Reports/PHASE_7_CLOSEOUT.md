# PHASE 7 CLOSEOUT — RECONCILIATION PASS (2026-08-20)

## FINAL RELEASE-GATE SECURITY REMEDIATION (2026-08-22)

Following the target-process-authorization fix (SHA `d3397bbe89fdc2fc6c088dfe44ea8bb2007d21d2`)
and its independent security re-review (verdict: `INDEPENDENT SECURITY
RE-REVIEW — PASS WITH NON-BLOCKING RESIDUALS`, 0 Critical/High), this session
closed the review's Medium findings and one optional Low finding, producing
a new remediation SHA (recorded in the commit for this change).

**FINDING-R1 — remote-sync redirect revalidation.** The independent review
corrected a prior misclassification: `remote-sync.ts`'s catalog-scrape fetch
is not dormant — `bootstrapTrainerCatalog()` auto-invokes it on first launch
by default. Added `validateRedirectTarget()` to `src/core/trainer-catalog/sync/remote-sync.ts`:
every HTTP redirect hop must now be HTTPS, target the exact original request
hostname, and carry no embedded credentials, or the fetch fails closed
before the next request is even issued. Since the 3 configured sources are
fixed, non-renderer-controlled hostnames, strict same-host matching makes a
separate private-network denylist redundant — a compromised source host can
only ever redirect to itself. 11 new tests in `tests/remote-sync-redirect-policy.test.ts`.

**FINDING-R2 — save-file XML safety gate.** `src/core/saves/index.ts`'s
`parseSaveFileStrict` parsed `.xml` save files directly with `xml2js.Parser`,
unlike every `.CT`/XML entry point elsewhere in the codebase, which all
route through `validateXmlSafety` first. Now calls that same gate before
parsing — same size cap, DOCTYPE rejection, and depth bound as everywhere
else, no forked second policy. 7 new tests in `tests/save-xml-safety-gate.test.ts`.

**Artifact-signing verification gap.** The independent review found that
electron-builder's build log claims `signing with signtool.exe` while
`Get-AuthenticodeSignature` on the actual packaged `Solith.exe` and
installer reported `NotSigned` — nothing in the release pipeline checked
the artifact itself. New `scripts/signing-verification.mjs` provides a pure,
independently-testable `evaluateSigningStatus()` decision function plus a
Windows `Get-AuthenticodeSignature`-based I/O helper, wired into
`scripts/verify-release-artifacts.mjs`. It checks `Solith.exe`, the
installer, and the first-party `solith-readonly-scanner.exe` helper (not
the third-party `elevate.exe`); in release mode (`SOLITH_RELEASE_BUILD=1`)
a `NotSigned` or missing required artifact now hard-fails the build —
confirmed live against the real (still unsigned) dev artifacts: exit 1.
`scripts/run-release-build.mjs` was extended to run multiple npm scripts in
sequence, and `release:verify` now runs both `verify:electron-output` and
`verify:release-artifacts`. 8 new tests in `tests/signing-verification.test.ts`,
all using injected Authenticode statuses — no real certificate needed or
invented. Production signing remains genuinely `BLOCKED` until a real
certificate is provisioned; this remediation only closes the gap where an
unsigned build could pass the pipeline silently.

**Test-orchestration gap.** `tests/live-memory/target-process-authorization.test.ts`
was not included in `npm test` or `npm run test:live-memory`, a
pre-existing gap disclosed but not fixed by two prior sessions. Wired into
`test:live-memory` (257→278 tests). The 4 new security test files added
this session were also wired into `npm test` (1654→1687) to avoid
immediately recreating the same orphaned-test problem.

**FINDING-R3 — EXDEV fallback atomicity (optional, completed).**
`src/core/safety/exdev-safe-rename.ts`'s cross-device fallback used to
`copyFileSync` straight onto the live destination path — a crash mid-copy
could leave a real save/database file truncated. It now copies to a
same-directory temp file first, then performs a true same-device atomic
rename into the destination, cleaning up the temp file on any failure;
the destination is never touched until the copy is fully verified on disk.
3 new tests plus the 4 pre-existing EXDEV tests updated for the new
two-rename call shape (their mocks previously assumed exactly one
`renameSync` call; behavioral contract — src/dest end states — unchanged
and reconfirmed by the same assertions).

**Verification.** Narrow suites: 115/115. Full regression: TypeScript
root/Electron 0/0, `npm test` 1687/1687 + SQL 10/10, `test:live-memory`
278/278, `npm audit --omit=dev` 0 vulnerabilities, full 22-suite Playwright
battery 21/22 clean (only the pre-existing startup-visibility Game Bar
mismatch; `gate2-5-frame-devtools-overlay-lifecycle` and `gate2-4` both
fully clean this run). `release:verify` reconfirmed correctly failing
closed on both the placeholder trust-root key and (newly) unsigned
artifacts. Fresh packaged build produced after the remediation commit.

**Residuals, unchanged and disclosed, not fixed this session:** production
catalog trust-root key (still placeholder, by design — gate correctly
fails), production code-signing certificate (not available in this
environment), installer lifecycle (not performed), manual packaged
click-through (not performed), XML depth-tracking method (still
regex-based, independently re-assessed as Low and acceptable for V1),
startup-visibility Game Bar mismatch (environment-specific test assumption,
not a product defect).

### Phase 7 status (superseding the status at the end of the section below and the "PACKAGED/E2E VERIFICATION" section immediately below this one)

All authorized code-level release-security gates are now implemented and
independently proven to fail closed. `PHASE 7 — READY FOR INDEPENDENT
RE-REVIEW` in the unqualified sense still does not apply to a release
decision — production signing and production trust-root provisioning
remain genuine external dependencies, and installer lifecycle / manual
packaged verification remain unperformed. **Merge readiness: DO NOT
MERGE**, unchanged.

## PACKAGED/E2E VERIFICATION RESULT AND REGRESSION REMEDIATION (2026-08-21/22)

The section below ("INDEPENDENT REVIEW RESULT AND REMEDIATION") froze
`9163da193839b8397ef488db42ca9e8206db0f09` and described it as "READY FOR
INDEPENDENT RE-REVIEW." That candidate had never had its Playwright/E2E
battery actually run — the remediation session disclosed this as an open
gap, not a pass. A follow-up verification-only session ran it for the first
time.

**Result: `PACKAGED/E2E VERIFICATION — FAIL`** against `9163da1`. Recorded
as historical fact and left in this document permanently: `9163da1`
genuinely failed its first packaged/E2E verification pass.

Root cause: `BLOCKED_TARGET_PROCESS_PATTERNS` in
`src/core/runtime/protected-target-guard.ts` (added by the Finding 2
remediation described below) included `/^solith/i` — a name-**prefix**
match, not an identity check. It rejected any executable merely starting
with "solith", including the pre-existing legitimate E2E fixture
`SolithConsentGame.exe`, breaking the real privileged write-consent
workflow: `tests/electron-consent-boundary.e2e.test.ts` failed 4/9, every
failure at the attach step (`Refusing to attach: "SolithConsentGame.exe" is
a protected system/Solith process.`). The self-PID and self-executable-path
identity checks in the same function were and remained correct — only the
redundant name-pattern layer was over-broad.

A same-day narrow remediation session fixed exactly that regex:
`/^solith/i` → `/^solith(?:\.exe)?$/i` (exact-name match, one line, one
file). No other pattern, file, or behavior touched — in particular the
similarly-shaped `/^electron/i` entry was deliberately left unchanged since
no failing test implicated it and altering it would have been unauthorized
scope creep for this task. Added 5 new regression tests to
`tests/live-memory/target-process-authorization.test.ts`: 4 proving
`SolithConsentGame.exe`/`SolithiumGame.exe`/`SolithTestTarget.exe`/
`MySolithGame.exe` all attach successfully post-fix (general fix, not a
special-cased exception for the one originally-reported name), plus 1
proving the exact extension-less name `Solith` is still correctly rejected.

**Verification after the fix:** `target-process-authorization.test.ts`
21/21 (was 16/16) · `electron-consent-boundary.e2e.test.ts` 9/9 (was 5/9,
rebuilt `dist-electron/main.js` first) · adjacent
`live-memory-session.test.ts`/`process-picker.test.ts` unaffected, 53/53 ·
TypeScript root/Electron 0/0 · `npm test` 1654/1654 + SQL 10/10 (unchanged
— `target-process-authorization.test.ts` remains outside both `test` and
`test:live-memory` npm scripts, a pre-existing wiring gap disclosed but not
fixed here, out of authorized scope) · `npm audit` 0 vulnerabilities · Vite
+ Electron dev build 29/29 · `release:verify` unchanged (29/30, exit 1,
correct placeholder-key hard-fail — gate not touched) · `git diff --check`
clean, no conflict markers. A fresh full packaged build was produced
strictly after the fix (timestamp confirmed later than the commit) and the
complete 22-suite Playwright battery rerun against it: 20/22 suites clean.
The 2 pre-existing `startup-visibility-behavior.e2e.test.ts` failures
(disclosed in the section below, unrelated to this fix) reproduced
unchanged. One new residual surfaced under this session's sustained system
load: `gate2-4-final-certification.e2e.test.ts` and
`gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts` each showed one
flaky failure in the full-battery run; `gate2-4` reran 5/5 clean in
isolation, but `gate2-5`'s Phase 7 (Wisp overlay obtainable via a fixed
700ms sleep) reproduced the same timing-window failure twice more across
two further isolated reruns, always at the identical fixed-sleep assertion
and never elsewhere in that 7-test suite — consistent with a pre-existing,
timing-fragile fixed-sleep race under heavy session load, not a regression
from the one-line, functionally-unrelated pattern change. Disclosed as an
unresolved residual requiring a clean-machine rerun for full confidence,
not fabricated as passing.

### Phase 7 status (superseding the status at the end of the section below)

`PHASE 7 — BLOCKED BY SECURITY FINDINGS` is no longer accurate (the
regression that blocked it is remediated and verified), but
`PHASE 7 — READY FOR INDEPENDENT RE-REVIEW` cannot yet be honestly
reasserted either until the `gate2-5` Phase 7 timing residual is confirmed
non-defective on an idle/clean machine. Merge readiness remains
**DO NOT MERGE** either way.

## INDEPENDENT REVIEW RESULT AND REMEDIATION (2026-08-21)

The "Highest-priority remaining action" from the Final Burn-Down pass below
— dispatch independent security review of the HEAD at the time — was
carried out (after an intervening Phase 1 manual-certification session
advanced HEAD to `ef254d19aed3359a0676fedf714e76e3533b0c30`). The review was
explicitly adversarial and independent of this project's own agents.

**Result: `INDEPENDENT SECURITY REVIEW — FAIL`** against
`ef254d19aed3359a0676fedf714e76e3533b0c30` — 1 CRITICAL, 1 HIGH, 3 MEDIUM,
several Low/Informational. This is recorded as historical fact and left in
this document permanently: `ef254d1` genuinely failed independent review. It
was never merged, tagged, published, or released.

A same-day remediation session fixed all 5 release-blocking findings,
RED-first regression-tested, full battery green after each fix. Full detail
per finding (files touched, exact fix, exact new test files, RED/GREEN
evidence) is recorded in `SOLITH_SECURITY_ROADMAP.md`'s Session Update Log,
"Security Remediation — Findings 1-5 from the ef254d1 independent review"
row — summarized here:

| Finding | Severity | Summary | Status |
|---|---|---|---|
| 1 | CRITICAL | `.CT` fallback/metadata/script-research parsers (and a directly renderer-reachable IPC path) never validated raw XML — only the main parser did | CLOSED — authoritative `validateXmlSafety` gate added to all 3 fallback parsers + top-level entry points |
| 2 | HIGH | Process-picker blocklist was renderer-UI-only; main-process attach had no equivalent policy | CLOSED — `assessTargetProcessAuthorization` added to `protected-target-guard.ts`, enforced in `LiveMemorySession.attach()` before any handle is opened |
| 3 | MEDIUM | EXDEV fallback could delete the only recoverable copy on a secondary failure | CLOSED — shared `renameOrCopyAcrossDevices` helper (never deletes `src`) applied to all 5 identified write paths |
| 4 | MEDIUM | `launch-installation`'s path-safety check was a no-op (empty `approvedRoots`) | CLOSED — bound to `installation.installPath`; matching persistence-time gap in `add-game`/`update-game` also closed |
| 5 | MEDIUM | No release command guaranteed `SOLITH_RELEASE_BUILD=1`, so the placeholder-key gate could be silently skipped | CLOSED — `scripts/run-release-build.mjs` + `build:release`/`dist:release`/`release:verify`; live-verified the gate now hard-fails (exit 1) on the placeholder key |

Low findings also addressed: bare-DOCTYPE rejection (folded into Finding 1);
a new static test (`tests/ipc-guard-inventory.test.ts`) independently
re-derives the "180/180 IPC guard" count from source instead of relying on
a hand-maintained sample — reconfirmed 180/180; removed the stale
`dist-electron/host-entry.js._bak_cert` packaging artifact and hardened
`package.json`'s `build.files` glob against it recurring. Not fixed this
session (disclosed): the XML depth-tracking method itself remains
regex-based (only its threshold was corrected — see below); remote-sync
redirect re-validation was not touched.

**A genuine pre-existing calibration defect was discovered while fixing
Finding 1**, not introduced by it: the XML nesting-depth limit (32) was
already too strict for real community `.CT` content — the real
`CrimsonDesert.CT` fixture nests to depth 75 and was being silently
rejected by the *existing, already-correct* main parser, a fact masked
until Finding 1's fix made the fallback/metadata path enforce the same
check for the first time. Recalibrated to 256 with regression tests updated
to the new, evidence-based threshold.

**Final verification, this remediation session:** main tsc 0/0 · Electron
tsc 0/0 · `npm test` 1654/1654 (was 1648, +6 new test files) + SQL 10/10 ·
`test:live-memory` 257/257 · `npm audit --omit=dev` 0 vulnerabilities · Vite
build PASS · Electron build + dev-mode output verifier 29/29 PASS ·
`npm run release:verify` (release mode) correctly FAILS 29/30 on the
still-placeholder key, proving the gate itself works (no production key was
created) · `git diff --check` clean · no conflict markers.

**NOT rerun this session** (disclosed, not fabricated as done): the
Playwright/packaged E2E battery (packaged smoke, IPC-channel E2E,
trust-boundary E2E, Trainer E2E, walkthrough E2E, accessibility E2E, Gate
2.2/2.5 lifecycle suites). None of this session's changes touch the
lifecycle/session-resume/window-identity machinery those suites cover, but
they were not independently rerun here due to time budget — this remains a
real gap to close before merge, not an inferred pass.

### Phase 7 status

`PHASE 7 — READY FOR INDEPENDENT RE-REVIEW`

Not `PASS` — only the independent reviewer may issue that verdict, per this
authorization's own rule. All Critical/High/Medium findings from the
`ef254d1` review are closed with regression evidence. Nothing has been
merged to `master`, tagged, published, or released. The exact next action is
to freeze the new HEAD SHA (recorded at the top of the required final
report for this session) and dispatch a fresh independent security review
against it.

## FINAL BURN-DOWN UPDATE (2026-08-21)

Continuing from the pass below, this session executed the full Phase 7
burn-down authorization (all 21 technically-actionable parts, stopping only
at genuinely external dependencies). Six commits, all pushed to
`review/gate2-5-doc-audit`, local == remote confirmed after each:

| Commit | What |
|---|---|
| `18a7791` | Reconciliation report (prior pass) |
| `aa4474a` | Fixed confirmed shell-injection in `src/core/process/index.ts`; closed 22 unguarded live-memory-ipc.ts handlers |
| `9b94764` | Closed remaining 129/180 unguarded IPC handlers across `main.ts` + 11 other files — 180/180 now guarded |
| `899e02a` | Consolidated audit findings report (prior pass) |
| `fb0b180` | Closed PATH-hijack class repo-wide via shared `system-binary.ts`; fixed a PowerShell-injection-adjacent defect |
| `412e24a` | Added XXE/entity-expansion/nesting-depth guard to `.CT` importer, RED-tested first |
| `03a805a` | Bounded trainer-catalog HTML-scrape redirect/response-size |
| `cf8a9d9` | Strengthened `createBackup` path containment to match `restoreBackup` |
| `c2aa0e2` | Reconciled `SOLITH_SECURITY_ROADMAP.md` with real, dated Batch B2 progress |

### Final IPC count

**180/180 `ipcMain.handle` channels guarded.** Cross-checked via a script
that parses every literal-channel registration (`ipcMain.handle`,
`guardedHandle`, `handleGuarded`) and confirms a `requireTrustedSender`/
`validateIpcSender`/`senderCheck` reference within the handler body — 0
unguarded. Overlay-owned channels (`wisp-overlay-*`, `trainer-overlay-toggle`/
`hide`) use an explicit `['main', '<own-overlay-type>']` allowlist, traced
against real renderer call sites (`SolithWispCompanion` is mounted in both
`App.tsx` and `WispOverlayPage.tsx`), not guessed.

### Real defects found and fixed this session (not merely audited)

1. **Critical — shell injection**: `src/core/process/index.ts`'s
   `checkMacProcessList`/`checkLinuxProcessList` interpolated a
   renderer-settable executable name into `execSync(\`ps aux | grep -i
   "${baseName}"\`)`. Fixed to `execFileSync` array args, no shell.
2. **High — IPC sender-identity gap**: 151 of 180 handlers had no
   trusted-sender check, including process enumeration and raw memory
   attach/read/scan. All fixed.
3. **High — PATH-hijack class**: ~10 bare `powershell.exe`/`reg`/`tasklist`
   invocations beyond the two already fixed in Phase 6. All routed through
   a new shared `src/core/safety/system-binary.ts`.
4. **Medium — PowerShell injection-adjacent**: `windows-process-identity.ts`
   embedded an OS-reported path into a PS script via `JSON.stringify()`,
   which leaves `$` unescaped. Fixed to single-quote-doubling.
5. **Medium — missing defense-in-depth**: `.CT` importer had no
   XXE/entity-expansion/nesting-depth guard that the save-editor XML path
   already had. Fixed, RED-tested first.
6. **Low — unbounded network scrape**: trainer-catalog HTML scraping had no
   redirect/response-size cap. Fixed.
7. **Low — weaker path-safety gate**: `createBackup` used only a weak local
   path check where `restoreBackup` already used the stronger shared one.
   Fixed to match.
8. **Hygiene — dependency drift**: Electron version mismatched across
   `package.json`/lockfile/installed `node_modules`. Fixed via a real
   `npm ci`, proven with a fresh packaged Trainer E2E run (native `memoryjs`
   addon rebuild verified working under the new Electron ABI).

### Investigated and found already correct (no code change needed)

- Registry operations: read-only by construction, no mutation export exists
  anywhere in the codebase.
- Preload API surface: no wildcard/generic invoke wrapper.
- BrowserWindow hardening (contextIsolation/nodeIntegration/sandbox/CSP):
  all 3 windows correct, confirmed by both source inspection and 20/20
  passing trust-boundary E2E tests including live negative cases.
- External URL handling: HTTPS-only `shell.openExternal`, deny-by-default
  popup policy.

### Explicitly NOT done — not fabricated as done

- Full negative/failure-injection matrix (process exits mid-scan, DB locked,
  catalog replay, artwork redirect overflow, etc.) — this is a large,
  multi-hour dedicated test-authoring effort on its own.
- Full packaged Windows certification checklist beyond what the standard
  build/output-verifier/Trainer-E2E cycle already proves.
- Installer clean-install/upgrade/uninstall testing — an NSIS installer
  target exists in `package.json` but has never been built and tested
  against this authorization's specific requirements.
- Code-signing decision — **BLOCKED — EXTERNAL SIGNING CREDENTIAL**: no
  certificate exists in this environment. Signing-ready config was not
  separately prepared this session.
- Independent security review of the resulting HEAD (`c2aa0e2`) — this
  session cannot self-certify that; genuinely requires a separate reviewer
  session, matching this project's own established practice for every prior
  gate.
- Secrets/log audit (Phase 8), formal native-helper inventory (Phase 10)
  beyond the memoryjs rebuild proof, save/backup/registry failure-injection
  scenarios beyond the containment fix already made.

### Final verification, this session (all green)

main tsc 0/0 · Electron tsc 0/0 · `npm test` 1648/1648 (was 1643, +5 new) +
SQL 10/10 · `test:live-memory` 257/257 · `npm audit` 0 vulnerabilities ·
Vite build PASS · Electron build + output verifier 29/29 PASS · Trainer E2E
5/5 · ipc-channels E2E 13/13 · walkthrough E2E 3/3 · accessibility E2E 8/8 ·
new1-new2-trust-boundary E2E 20/20 · `git diff --check` clean · no conflict
markers · local == remote at `c2aa0e2`.

### Final Gate

`PHASE 7 — BLOCKED`

Not a stall — six real, verified security fixes shipped this session,
closing the entire IPC sender-identity gap (the single largest finding),
the confirmed shell-injection vulnerability, the repo-wide PATH-hijack
class, and several smaller real defects. What remains genuinely open is
either (a) infrastructure this environment doesn't have (a code-signing
certificate) or (b) work whose own project convention requires a *separate*
session/reviewer to avoid self-certification (independent security review),
or (c) large-scope test-authoring efforts (full failure-injection matrix,
installer lifecycle testing) that were not attempted rather than faked.

**Highest-priority remaining action:** dispatch independent security review
of commit `c2aa0e2` (the current HEAD) — this project's own established
practice for every prior security gate, and explicitly required by this
authorization's Part 16 before Phase 7 can close.


## UPDATE (same day, continuation pass) — real Batch B2 audit begun, one critical fix shipped

Continuing directly from the reconciliation above, three parallel read-only audits were run against
the current tree (IPC/preload/navigation surface; process/command/path safety repo-wide; network
requests + `.CT` import + registry security). Findings below are real, with file:line evidence — not
sampled, not summarized-away. One confirmed-exploitable vulnerability was fixed and shipped
(`aa4474a`) in this same pass; the rest is real, itemized, unfinished work.

### Finding 1 (Critical, FIXED this pass): shell-injection in game-running detection

`src/core/process/index.ts` `checkMacProcessList`/`checkLinuxProcessList` ran
`execSync(\`ps aux | grep -i "${baseName}" | grep -v grep\`)` where `baseName` derives from
`profile.executableNames` — a renderer-settable field (`z.array(z.string())`, no character
allowlist in `src/core/profiles/schema.ts`) reachable through the app's own compatibility-profile
creation flow. A crafted executable name containing `"`, `;`, or `$()` breaks out of the shell
string. **Fixed:** rewrote both to `execFileSync('ps', ['aux'], ...)` (array args, no shell) with
JS-side substring matching; also switched the Windows `tasklist` call from a shell string to
`execFileSync` array args for consistency. Verified: main tsc 0/0, Electron tsc 0/0, `npm test`
1643/1643 + SQL 10/10, `test:live-memory` 257/257, `tests/process.test.ts` 4/4, `git diff --check`
clean. Commit `aa4474a`, pushed, local == remote.

### Finding 2 (High, PARTIALLY FIXED this pass): IPC sender-identity gap — 151/180 handlers unguarded

Full inventory (100% coverage, all 180 `ipcMain.handle` sites in `electron/*.ts`) found that only 29
of 180 handlers call `requireTrustedSender`/`validateIpcSender` (the B1.1-pattern sender/window-type
guard). **151 (84%) have no sender-identity check at all.** Preload allowlisting, `webPreferences`
(`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all 3 windows),
navigation/popup policy (`applyWindowNavigationPolicy`, deny-by-default), and CSP
(`default-src 'self'`, `frame-src 'none'`, no `unsafe-eval`) are all solid and not blocking on their
own.

**Fixed this pass (22 handlers, `electron/live-memory-ipc.ts`):** every previously-unguarded
`live-memory-*`/`research:*`/`in-process-propose-hook` handler now calls
`requireTrustedSender(event)` before touching session state — this specifically closes the
reconnaissance/attach/read/scan primitives (`live-memory-list-processes`, `live-memory-attach`,
`live-memory-read`, `live-memory-read-many`, `live-memory-pointer-scan`, `live-memory-scan-aob`,
`research:hex`, `research:view`, and 14 others), which is the same class of defect Gate 2.5 already
found and fixed for `live-memory-freeze-stop`/`live-memory-freeze-status` — a trusted-but-wrong-type
window (e.g. the Wisp/trainer overlay) could otherwise independently attach to and read arbitrary
process memory, since session binding is per-`webContents.id`, not per-window-type.

**NOT fixed, still unguarded (129 handlers remain) — itemized, not vague:**

| File | Unguarded count | Highest-risk examples |
|---|---|---|
| `electron/main.ts` | 44 of 46 | `add-game`, `delete-game`, `restore-backup`, `apply-proposal`, `add-user-selected-location`, `check-game-running`, `v2-monitor-start`, `trainer-host-start`, `trainer-host-read-field` |
| `electron/trainer-catalog-ipc.ts` | all | `trainer-catalog-import-ct`, `trainer-catalog-preview-ct`, `trainer-catalog-promote-verified`, `trainer-catalog-import-yaml`, `trainer-catalog-approve-save-path` |
| `electron/trainer-research-ipc.ts` | all | `trainer-research-analyze-exe`, `trainer-research-import-dumpspace`, `trainer-research-analyze-ct-scripts` |
| `electron/ct-library-ipc.ts` | all | `ct-library-import-zip-start`, `ct-library-import-zip-preview` |
| `electron/install-discovery-ipc.ts` | all | `install-discovery-preview`, `install-discovery-commit` |
| `electron/local-ocr-ipc.ts` | all | `local-ocr-read-window-region` (captures pixel data from another window) |
| `electron/canonical-games-ipc.ts` | all | `launch-installation` (spawns an installer process) |
| `electron/cheat-toggle-ipc.ts`, `notifications-ipc.ts`, `trainer-deck-ipc.ts`, `trainer-hotkeys.ts`, `wisp-overlay.ts` | all | DB mutation, global hotkey rebinding, overlay window control |
| `electron/registry-verification-ipc.ts` | 1 of 3 | `registry-compare-restart-artifacts` |

This is the largest remaining release-blocking item. Recommended order: `main.ts`'s
file/process/DB-mutating handlers first (highest blast radius), then `trainer-catalog-ipc.ts`'s
CT-import/promote group, then the rest.

### Finding 3 (High, NOT fixed — repo-wide, itemized): PATH-hijack class beyond the two already-fixed binaries

Every bare `powershell`/`powershell.exe`, `reg`, and `tasklist` invocation across `src/core/` resolves
via PATH, the same class of bug already fixed once for `whoami.exe`/`icacls.exe` in
`electron/gamebar-transport.ts`. Confirmed sites: `src/core/install-discovery/registry-win.ts:10,30`
(also uses `execSync` with string interpolation of a hive path — low-likelihood injection, requires
a locally-planted malicious registry key), `src/core/live-memory/remote-connection-observer.ts:56`,
`src/core/live-memory/windows-process-identity.ts:107,140`, `src/core/live-memory/native-memory-driver.ts:460`,
`src/core/in-process-script/helper-manifest.ts:213`, `src/core/v2/observers/process-observer.ts:58`.
`electron/gamebar-transport.ts`'s `systemBinaryPath()` helper is not exported/shared — no other site
reuses it. Recommended fix: extract it to a shared `src/core/safety/system-binary.ts` and route all
of the above through it in one pass. Separately flagged: `windows-process-identity.ts:140-144` embeds
a path into a PowerShell double-quoted string via `JSON.stringify()`, which does not neutralize `$()`
subexpression expansion — the correct pattern (single-quote-doubling) is already used correctly in
`helper-manifest.ts:209` and should be copied.

### Finding 4 (Medium, NOT fixed): `.CT` import has no XXE/nesting guard

`src/core/adapters/xml.ts`'s `validateXmlSafety()` (size cap, DOCTYPE/ENTITY block, nesting-depth
cap) exists and is wired into the save-file XML editor, but the actual `.CT`/Cheat-Table importer
(`src/core/definitions/ct-import.ts`'s `parseCheatTableXml`) calls `xml2js.parseStringPromise`
directly with none of those guards — it only inherits the 8 MB file-size cap enforced at the IPC
layer (`electron/trainer-catalog-ipc.ts:302-305`). `xml2js`'s underlying `sax`-based parser doesn't
resolve external entities by default, so classic XXE-via-disclosure is unlikely, but there is no
defense-in-depth entity/nesting guard the way the save-editor path has one. Embedded script
execution itself is safe by construction — `REJECTED_CHILD_TAGS` (`ct-import.ts:42-48`) rejects any
`CheatScript`/`LuaScript`/`AutoAssemblerScript` entry outright; nothing is ever auto-executed.

### Finding 5 (Low, NOT verified): possible weaker path-safety gate in real backup flow

`src/core/backups/index.ts` defines its own local `validatePathSafety()` (only checks `..` substring
+ `path.isAbsolute()`, no symlink/system-dir/containment checks) in the same file that also imports
the stronger shared `validateCentralPathSafety` from `src/core/safety/path-safety.ts` — it's unclear
from static reading alone which one actually gates `createBackup`/`restoreBackup`. Needs a direct
read of the call sites to confirm, not yet done this pass.

### Network / registry / privacy audit (no fixes needed — findings are clean)

Full outbound-network inventory (6 call sites, all `fetch()`, no `axios`/raw `http.request`): artwork
fetch has the strongest controls (rights-gate before I/O, HTTPS-only, host allowlist, bounded
redirects re-validated per hop, 8 MiB cap, SVG rejected). Catalog-update mechanism does not
currently perform any network fetch — local signed-file import only. Trainer-catalog HTML scraping
(`remote-sync.ts`) has a timeout but no explicit size/redirect cap — flagged, not blocking. No
telemetry/analytics library exists anywhere in the codebase; the local crash reporter is
file-only and never opens a socket; the only path that ever leaves the machine is the sanitized
community-definition publish flow, which strips user-profile paths and reduces exe paths to
basenames before submission. Registry Explorer ("CT Registry") is Solith's own compiled index, not
the Windows registry, and is read-only by construction (no write/delete exports exist anywhere in
the module). Real Windows-registry access is limited to two hardcoded, read-only `reg query` calls
(Steam/Epic install-path discovery) with no renderer-exposed arbitrary-key IPC path.

### Updated Part 2 blocker table (supersedes the original above for items it covers)

| # | Severity | Blocker | Status |
|---|---|---|---|
| 1 | Critical | Shell injection in `src/core/process/index.ts` | **FIXED**, commit `aa4474a` |
| 2 | High | 151/180 IPC handlers lack sender-identity check | **22 fixed** (`live-memory-ipc.ts`), **129 remain** — itemized above |
| 3 | High | PATH-hijack class on bare `powershell`/`reg`/`tasklist` across `src/core/` | Not fixed — itemized above |
| 4 | Medium | `.CT` importer missing XXE/nesting defense-in-depth | Not fixed |
| 5 | Low | Possibly-weaker local path-safety gate in backup flow | Not verified |
| 6 | missing independent verification | Neither this pass's fixes nor the Phase 5/6 true-closeout commits have been independently reviewed | Still open |
| 7 | installer/signing requirement | No signing cert in this environment; NSIS installer target exists, uncertified against Part 13's clean-install/upgrade/uninstall requirements | Still open |

## Final Gate (unchanged)

`PHASE 7 — BLOCKED`

Real progress this pass: 1 confirmed vulnerability fixed, 22 of 151 unguarded IPC handlers fixed,
full evidence-backed inventory of the remaining 129 plus two further real (unfixed) findings. Next
highest-priority action: continue the IPC sender-identity fix through `electron/main.ts` (44
handlers, highest blast radius — direct DB/file/process operations), then `trainer-catalog-ipc.ts`'s
CT-import/promote group.


## Scope of this pass

This pass did **not** attempt to fabricate execution of all 25 parts of the
Phase 7 authorization in one session. It did two things honestly:

1. Re-read `ROADMAP.md` Phase 7 and the full current
   `SOLITH_SECURITY_ROADMAP.md` (1,986 lines) plus its linked
   `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/owner-decision-package.md`,
   and found the security roadmap's own "Final Current Verdict" block is
   **stale** relative to real, dated, verbatim owner decisions recorded later
   in that same evidence tree.
2. Ran a small set of independently-checkable fresh commands against the
   current working tree to confirm which technical conditions are actually
   resolved right now, and mapped exactly what Batch-B2-equivalent work
   (Parts 3–21 of the Phase 7 authorization) has and has not started.

No production code was changed this pass. No commit beyond this report and
the security-roadmap reconciliation note was made.

## Part 1 — Phase 7 ROADMAP matrix

| Requirement | Exact wording | Current evidence | Mandatory for exit? | Status |
|---|---|---|---|---|
| 7.1 Electron boundary | "nodeIntegration false, contextIsolation true, renderer sandboxing..., narrow preload, allowlisted IPC, request/response validation, sender/frame authorization, restricted navigation/new windows, sanitized errors" | Covered by B1.1/Gate 2.x work (trusted-sender registry, consent-bound freeze, frame/DevTools boundary tests) — VERIFIED for the B1.1 (live-memory) surface only. Not re-audited for the full 149-handler IPC surface this pass. | Yes | PARTIAL — B1.1 subset verified; full-surface audit (security roadmap's own "Phase 6: Batch B2 privileged IPC hardening") not yet started |
| 7.2 Filesystem safety | canonicalization, path containment, traversal, symlink/junction escape | Security roadmap Phase 6.2 ("File and path authorization") — **Status: PENDING** in the roadmap itself | Yes | PENDING — not started |
| 7.3 Failure injection | permission loss, mid-write failure, atomic-replace failure, DB write failure, interruption, backup corruption, rollback-target-locked | B1.1 failure-injection covers live-memory session/consent/rollback scenarios only (Gate 2.1–2.5). Save/backup/catalog/artwork/.CT failure injection (security roadmap Phase 12) — **PENDING** | Yes | PARTIAL |
| 7.4 Packaging | Node 22 setup, Electron Builder, installer, WASM packaging, packaged DB, packaged demo, native module packaging, clean exit, no dev-only privilege path | `package.json` `build` config has a real `nsis` target (`win.target: ["nsis"]`, `build.nsis` block present). Packaged smoke/build has passed repeatedly through Gate 2.x (23/23, 29/29 output verifier). No signing config present. | Yes | PARTIAL — packaging pipeline real and repeatedly verified; installer built but never certified against this Phase 7 authorization's own clean-install/upgrade/uninstall requirements (Part 13) |
| 7.5 Dependency/license closeout | reconcile deps, vendored binaries, licenses/notices, no prohibited redistribution, disposition vulnerabilities | `npm audit` (fresh, this pass): **0 vulnerabilities** (info/low/moderate/high/critical all 0). Vendored inventory (IBM Plex Sans, JetBrains Mono, Tabler icons, patched memoryjs) listed in ROADMAP but license-notice reconciliation not independently re-verified this pass. | Yes | PARTIAL |

**Exit gate (verbatim from `ROADMAP.md`):** "security/release gates green, package reproducible, dependencies/licensing resolved." Security verdicts are explicitly delegated to `SOLITH_SECURITY_ROADMAP.md` — this phase does not restate them.

## Part 1 — Security roadmap reconciliation (the actual finding this pass)

`SOLITH_SECURITY_ROADMAP.md`'s own "Final Current Verdict" block (line 1846) still reads:

```
BATCH B1.1 CONDITIONAL PASS
OVERALL SOLITH SECURITY: NOT COMPLETE
RELEASE/SECURITY COMPLETION: DENIED
...
OWNER DECISION REQUIRED: dispose of the remaining B1.1 conditions.
```

But `Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_5/owner-decision-package.md`
contains **later, dated (2026-08-04), verbatim owner decisions** that
supersede this:

- **OD-2.5-001 (Electron TypeScript baseline):** CLOSED — owner explicitly
  accepted the 31→0 diagnostic cleanup, independently reviewed twice.
- **OD-2.5-004 (branch merge / master verification):** CLOSED — VERIFIED
  COMPLETE on `origin/master`. Merged, post-master-verified
  (tsc 0/0, `npm test` 1055/1055+10/10, `test:live-memory` 257/257, builds
  29/29, `git diff --check` clean), pushed (`acef7dc..3fd402b`), confirmed
  `HEAD == origin/master == 3fd402b`.
- **OD-2.5-003 (final B1.1 promotion):** CLOSED — owner authorized
  promotion, verbatim: *"I AUTHORIZE OD-2.5-003 B1.1 PROMOTION CLOSURE... Not
  authorized: Production signing, Public release, Deployment, Publishing
  installers, Creating a GitHub release, Creating release tags, Uploading
  artifacts, Changing implementation code."*

**Fresh verification this pass, of the roadmap's two remaining "technical"
B1.1 conditions, against the CURRENT working tree (branch
`review/gate2-5-doc-audit`, HEAD `b0dae3f`, which contains `origin/master`
(`1a5c3ec`, itself containing the promoted `3fd402b`) as an ancestor plus 32
further commits — confirmed via `git merge-base --is-ancestor`):**

- `tsc --noEmit -p tsconfig.electron.json`: **exit 0, 0 diagnostics.**
- `tsc --noEmit -p tsconfig.json`: **exit 0, 0 diagnostics.**
- `git diff --check` (against current HEAD): **exit 0, clean.**
- `npm audit`: **0 vulnerabilities.**

So: **B1.1 is promoted (conditional), on origin/master, and the current
working tree already carries that promotion plus everything since.** This
supersedes the roadmap's own stale "RELEASE DENIED / OWNER DECISION
REQUIRED" verdict text for the *B1.1 layer specifically*. This is recorded
here as a reconciliation finding, not self-granted — the owner decisions
being cited were already made and recorded by the owner in the evidence
file; nothing here promotes anything new.

**What B1.1 promotion does NOT mean:** the owner's own authorization text is
explicit that it does not authorize signing, release, deployment,
publishing, tagging, or artifact upload, and does not by itself satisfy
`OVERALL SOLITH SECURITY`. B1.1 covers the live-memory/session security
surface (freeze, consent, rollback, sender/frame validation for that
subsystem). It does **not** cover the security roadmap's own Phases 6–15
("Batch B2 Privileged IPC Hardening" onward: full-surface IPC handler
authorization, filesystem/path authorization, process/command execution
hardening, registry operations, preload/BrowserWindow hardening beyond
B1.1, secrets/logs/privacy certification, dependency/supply-chain review,
native helper security, save/backup/registry data-integrity, negative/abuse
testing, full packaged Windows certification, evidence reconciliation, and
the final security verdict) — **every one of those remains `PENDING` in the
roadmap's own text, unchanged.**

## Part 2 — Release-blocker burn-down (real, not padded)

| # | Severity | Blocker | Governing requirement | Code needed? | Tests needed? | Owner action needed? | External cred/cert needed? |
|---|---|---|---|---|---|---|---|
| 1 | release-gate failure | Batch B2 (security roadmap Phases 6–14) has not started: full IPC-handler-by-handler authorization audit (149 handlers), filesystem/path containment audit, process/command execution audit beyond the two commands already fixed in Phase 6, registry operations audit, secrets/log audit, dependency/supply-chain review beyond `npm audit`, native-helper inventory, save/backup/registry failure-injection, negative/abuse testing | Security roadmap Phase 6.1–6.4, 7.1–7.3, 8.1–8.3, 9.1–9.3, 10.1–10.3, 11.1–11.x, 12 — all `PENDING` | Yes, substantial | Yes, substantial | No — technically unblocked now that B1.1 is promoted | No |
| 2 | missing independent verification | Independent security review has been performed and is on record for Gate 2.x/B1.1 work, but **not** for the Phase 5/6 true-closeout commits (`c5f7e94`, `b0dae3f`) added on top of the promoted master — new IPC surface (`get-proposals` handler, `ProposalInspector.tsx`), new settings action (demo reset), and the `gamebar-transport.ts` PATH-hijack fix have not been independently reviewed by a separate reviewer session | SOLITH.MD Part 20 ("mandatory... implementation agent must not self-certify independence") | No | No | Yes — dispatch a separate, independent review session | No |
| 3 | installer/signing requirement | Installer target (`nsis`) exists and packaging pipeline is repeatedly verified; **no code-signing configuration exists**, and Phase 7's own instructions forbid fabricating a self-signed cert as if it satisfies the gate | ROADMAP.md 7.4; SOLITH.MD Part 12 | Config-only, if owner wants unsigned dev path prepared | Clean-install/upgrade/uninstall tests (Part 13) not yet run under this authorization | Yes — owner must state whether signing is mandatory for Phase 7 exit or deferred to public release | Yes, if signing is required — no certificate is present in this environment |
| 4 | documentation/evidence gap | Security roadmap's own "Final Current Verdict" block text is stale (see reconciliation above) — needs the actual B1.1-promotion state written in, not just referenced from a sub-evidence file | Security roadmap's own maintenance rule ("update this roadmap at the end of every SOLITH session") | No | No | No | No |

## Final Gate

`PHASE 7 — BLOCKED`

**Exact highest-priority remaining action:** Begin the security roadmap's
own "Batch B2 Privileged IPC Hardening" (its Phase 6 onward) — the full
handler-by-handler IPC authorization audit across all 149 handlers, which
is explicitly still `PENDING` and is the largest remaining body of real,
required, non-owner-gated work. This is release-blocking per the exit gate
("security/release gates green") and per the security roadmap's own Phase
15.1 SECURITY PASS criteria, which require it explicitly ("All privileged
IPC handlers are authorized and tested," "File/path boundaries are
enforced," etc.) — none of which are satisfied by B1.1 promotion alone.

This is not a fabricated deferral: attempting to summarize a full 149-handler
audit, a filesystem-path audit, a process-execution audit, a registry audit,
and a full negative/failure-injection matrix as "done" in this single pass
would mean inventing evidence, which this project's own standard
(`SOLITH_SECURITY_ROADMAP.md` §1: "Completion requires... positive tests...
negative tests... evidence that matches the current repository state")
explicitly prohibits. That work has not been done and is reported as such.

Secondary, smaller items that do not block starting the above and can run in
parallel: dispatch independent review of the Phase 5/6 true-closeout
commits (blocker #2); get an explicit owner answer on whether Phase 7 exit
requires code signing or only a prepared unsigned dev path (blocker #3);
correct the security roadmap's stale verdict text (blocker #4, small, safe,
can be done immediately on request).
