# PHASE 7 CLOSEOUT — RECONCILIATION PASS (2026-08-20)

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
