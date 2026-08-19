# Independent hostile review — NEW-1 / NEW-2

Reviewer: fresh agent, no prior context on this task, read-only (made no edits/commits), instructed to reproduce every claim itself rather than trust the evidence pack.

Reviewed: the 4 commits on `security/new-1-new-2-trust-boundary` as they existed immediately after the "docs: record NEW-1 and NEW-2 closure evidence" commit, diffed against base `a63e9f5`.

## Verdict

**VERIFIED WITH CONDITIONS**

## What the reviewer independently reproduced (not just re-read)

- Check ordering: `requireTrustedSender(event)` is the literal first synchronous statement inside every one of the 6 `live-memory-ipc.ts` handlers and `main.ts`'s `trainer-host-approve-and-write`, before any `await`/schema-parse/business logic.
- All 7 call sites pass `['main']` — none loosened.
- `src/core/security/trusted-sender-registry.ts`'s actual check logic (`validateTrustedSender`, `isApprovedUrl`, `normalizedPathname`) is byte-identical to base — only visibility/comments changed.
- No legitimate-caller regression: main window registration happens synchronously in `createWindow` before load completes; hash/query variations still match.
- `will-navigate` not firing for same-document navigation is a real Electron behavior but not exploitable here because `isApprovedUrl` ignores hash/query anyway.
- Both `window.open` and `target="_blank"` are denied in real Electron.
- Wisp isolation is genuinely clean — `git diff a63e9f5..HEAD -- src/core/companion/wisp.ts tests/companion-wisp.test.ts` empty, `electron/wisp-overlay.ts` diff is exactly import line + window-creation call site.
- Reproduced all claimed test totals and exit codes with no discrepancy (tsc x2, unit 16/16, e2e 16/16, build:electron 29/29).

## Conditions raised, and disposition

| # | Finding | Severity (reviewer) | Disposition |
|---|---|---|---|
| 1 | `in-process-confirm-hook`/`in-process-rollback-hook` (electron/live-memory-ipc.ts) — direct shellcode-write path, liveness-only | HIGH | **NOT FIXED — out of authorized scope.** Not in the explicitly authorized 6-channel list. Recorded in remaining-risks.md for an explicit scope decision; not silently dropped. |
| 2 | `trainer-host-rollback` (electron/main.ts) — same asymmetry as the handler that was hardened | MEDIUM | **NOT FIXED — out of authorized scope.** Same disposition as #1. |
| 3 | `http://localhost:3000` trusted unconditionally in packaged builds, for both IPC trust and the new nav guard | MEDIUM-HIGH | **FIXED** — all three windows now gate the dev origin behind the existing `isDev` flag; packaged builds only trust the packaged `file://` route. |
| 4 | `will-redirect`/`will-frame-navigate` not hooked (redirect and child-iframe navigation gaps) | LOW-MEDIUM | **Not independently exploitable given fix #3** (the only origin capable of redirecting was `http://localhost:3000`, now dev-only) and the 7 hardened handlers already reject child frames via the `isMainFrame` check. Left as a documented residual for the unhardened channels, consistent with the "beyond B1.1" roadmap boundary — not fixed in this pass. |
| 5 | NEW-1 e2e tests proved only non-regression, not that the check is wired (would still pass if the check were deleted) | MEDIUM (test quality) | **FIXED** — added a negative-control test calling all 7 hardened channels from the real Wisp overlay window, asserting genuine `sender_rejected:unauthorized_window_type`. This assertion fails if the check is removed. |
| 6 | Denying all popups silently broke a real `target="_blank"` external link (`src/app/pages/ExternalTrainerResearchLab.tsx`), and the doc rationale ("no supported external-browser handoff flow exists") was factually wrong | LOW (functional regression) | **FIXED** — `applyWindowNavigationPolicy` now hands strictly-`https:` popup requests to `shell.openExternal`; all other schemes remain denied with no handoff. Doc rationale corrected. |
| 7 | Evidence pack's "intentionally untouched" list omitted findings #1/#2 | MEDIUM (evidence accuracy) | **FIXED** — remaining-risks.md now explicitly lists both as reviewed-but-out-of-scope. |
| 8 | `http://localhost:3000` framed only as a test-coverage gap, not a trust-surface issue | LOW-MEDIUM (evidence accuracy) | **FIXED** — superseded by fix #3; remaining-risks.md updated accordingly. |

Findings #1 and #2 are real and are the only remaining open items from this review. They require an explicit decision on whether to broaden this patch's scope (or file as a separate, similarly-scoped follow-up) — not a silent close.

## Re-verification after the corrective pass

Re-ran: both tsc checks, the unit test file (16/16, unchanged), `npm run build:vite`, `npm run build:electron` (29/29), the full e2e suite (17/17 — 16 original + 1 new negative-control), the full `npm test`-equivalent (1056/1056), and `git diff --check` (clean). See tests-run.txt item 14 for the consolidated re-run.

This corrective pass and re-verification were performed by the implementer (not a second independent reviewer), per the task's "address in a separate corrective pass and repeat narrow independent verification" instruction — the "repeat" step here is the self-verification re-run above. Whether a second independent hostile-review pass is warranted before this is considered closed is a call for the task owner.

---

## Second corrective pass — closing the two remaining conditions

The task owner explicitly authorized hardening exactly the two open findings from the table above (#1 and #2), and nothing else, in a narrowly-scoped follow-up.

**This VERIFIED WITH CONDITIONS verdict above is left unmodified as the historical record of the first review.** This section records what happened after it.

### What changed

- `in-process-confirm-hook`, `in-process-rollback-hook` (`electron/live-memory-ipc.ts`) and `trainer-host-rollback` (`electron/main.ts`) each now run `requireTrustedSender(event)` as the first statement in the handler's `try` block, before any existing `requireSession`/ownership/gate/guard check — identical placement and pattern to the 7 channels hardened in the first pass. `trainer-host-rollback` reuses the exact same local `requireTrustedSender` helper already defined in `electron/main.ts` for `trainer-host-approve-and-write`.
- All existing protections are unchanged: in-process feature gate (`isInProcessEnabled`), online-guard recheck (`session.recheckOnlineGuard`), session/bundle ownership (`requireSession`), TrainerHost ownership-by-`webContents.id`, and supervisor state checks all still run, in the same order, after the new sender check passes.
- Test coverage extended: 3 new positive-control e2e tests (legitimate main-frame caller reaches business logic, never `sender_rejected:*`), and all 3 new channels added to the existing shared negative-control test (now asserts all **10** hardened channels — not 7 — genuinely reject the real Wisp overlay window with `sender_rejected:unauthorized_window_type`).

### Re-verification (self, by the implementer)

tsc (electron + main): both exit 0. Focused suite (`new1-new2-sender-validation.test.ts` + `trusted-sender-registry.test.ts` + `live-memory-rollback-freeze-ipc-validation.test.ts`): 59/59. e2e (`new1-new2-trust-boundary.e2e.test.ts`, rebuilt via `build:vite`+`build:electron` first): 20/20 (up from 17). `test:live-memory`: 257/257. Full-suite equivalent (literal `npm test` still blocked by this environment's Node 24 vs. the repo's pinned Node 22 — reconfirmed, not assumed, by running it and observing the same `check-node.mjs` failure before substituting the identical underlying command): 1056/1056, unchanged from the first pass. `git diff --check`: clean. Full detail in `tests-run.txt` item 15.

### Independent hostile review — second pass (scope: these 3 handlers + their tests/evidence only)

**Verdict: VERIFIED WITH CONDITIONS**

The reviewer independently re-read every changed line, reran both tsc checks (exit 0/0), the full e2e suite (20/20), the focused unit suite (59/59), `test:live-memory` (257/257), and rebuilt (`build:vite`+`build:electron`, 29/29, confirming the rebuilt bundle was byte-identical in size to the one already tested — source and tested artifact agree). It then went further than asked and **mutation-tested the fix**: on the gitignored build output only (backed up and restored bit-for-bit; confirmed `git status` clean afterward), it deleted the `requireTrustedSender` check from each of the 3 handlers individually and reran the negative-control test each time. All three mutants were killed — deleting the check makes the corresponding negative-control assertion fail with the pre-existing business-logic error (`not_attached` / `not_running`) instead of `sender_rejected:unauthorized_window_type`. This is real, reproduced proof that the check is genuinely load-bearing for all 3 channels, not just present in source.

It also independently confirmed: check ordering (first synchronous statement, before every existing protection), that both `requireTrustedSender` helpers are unchanged and use the same `['main']` restriction, that removing the bare `isDestroyed()` in `trainer-host-rollback` is not a weakening (the same check happens inside `validateIpcSender` first), that the earlier dev/packaged origin-gating fix is still intact and is exactly what these 3 handlers now depend on, and that Wisp isolation and the unmodified original verdict text both hold.

**Findings:**

1. **MEDIUM (evidence accuracy)** — `remaining-risks.md`'s claim "No further NEW-1 gaps are open as of this pass" was false: `restore-backup` and `apply-proposal` (`electron/main.ts`) have zero sender check of any kind, and the TrainerHost lifecycle handlers are liveness-only. The reviewer was explicit that fixing these was **not** part of its authorized 3-handler scope, and that its condition was on the documentation, not the code: "correct the sentence in `remaining-risks.md`."
2. **LOW (coverage observation, not a defect)** — the negative-control test only exercises the `wisp-overlay` window type, not `trainer-overlay`, against the 10 hardened channels. Same code path (`validateIpcSender`'s window-type check), so residual risk assessed as nil; noted for completeness.
3. **Informational** — reconfirmed the known, previously-recorded limitation that positive-control tests alone are non-discriminating (this was never in question; the negative-control/mutation-testing result is what actually proves wiring).

**Disposition:** condition #1 fixed in this evidence file (see "Final same-class destructive-handler audit" above, added specifically in response to this finding) — the overclaim is corrected and `restore-backup`/`apply-proposal`/TrainerHost-lifecycle are now explicitly documented as a real, separately-tracked, out-of-scope gap rather than implied to be closed. Condition #2 and #3 required no code or test change (reviewer classified them as non-defects / low-priority coverage notes, not required for sign-off). No code changes were required by this review — the 3-handler fix itself was found sound as committed.

Separately, one of my own verification runs hit a single flaky Playwright worker crash on the `trainer-host-rollback` positive-control test (`worker process exited unexpectedly`); rerunning that test alone, and rerunning the full suite again, both came back clean (20/20), matching the reviewer's own clean 20/20 run. Logged as an environment flake, not a defect — see tests-run.txt.

---

## Third and final review — full-scope closure check

Scope: all NEW-1/NEW-2 production changes `a63e9f5..HEAD`, all tests, the complete destructive-handler classification (built independently, not read from this pack), navigation/popup policy, validation ordering, Wisp isolation, and evidence accuracy across every file in this directory.

**Verdict: VERIFIED WITH CONDITIONS**

**Required question, answered directly by the reviewer:** *"Is there any renderer-triggered destructive IPC handler in the reviewed NEW-1 class that lacks the established trusted main-window/main-frame/URL boundary?"* — **No.** The reviewer built its own handler ledger from scratch (42 in `electron/live-memory-ipc.ts`, 44 in `electron/main.ts`, 66 more across 10 other `electron/*.ts` files — grepped all of them for `WriteProcessMemory`/`writeProcessBuffer`/`spawn`/`execFile`/`unlinkSync`/injector primitives, zero hits outside the two audited files), independently verified all 16 `requireTrustedSender` call sites (6 pre-existing, 10 added by this branch) are the first synchronous statement in their handler before any existing protection, confirmed session-scoped ownership prevents an untrusted sender from reaching a hardened channel via an unhardened staging step, confirmed no subframe can pass the `isMainFrame` check, and confirmed NEW-2's navigation/popup wiring and dev/packaged origin gating on all 3 windows by reading both source and the built `dist-electron/main.js` artifact directly (byte-level grep for `setWindowOpenHandler`, `will-navigate`, `openExternal`, `sender_rejected` counts).

The reviewer also independently re-ran everything rather than trusting prior totals: both tsc checks (exit 0/0), the 3 focused unit suites (59/59), the full e2e suite (20/20, on the **first** run — the earlier flaky worker crash did **not** reproduce), `test:live-memory` (257/257), and the full-suite-equivalent command (1056/1056, matching exactly). It also read `.nvmrc`/`engines`/ran `node --version` itself and confirmed the Node-22-pin/Node-24-environment claims in `tests-run.txt` are accurate, not asserted.

It also explicitly assessed whether the "OUTSIDE NEW-1 CLASS" boundary for `restore-backup`/`apply-proposal`/etc. is a legitimate scope line or scope-avoidance, and concluded **legitimate** — citing that the roadmap item predates this branch (verified in the base commit), that the evidence pack "prominently self-incriminates rather than hides" the zero-sender-check gap, and that the branch never touched those files. It flagged the *stated rationale* for that boundary as imprecise (finding 4 below), not the boundary itself.

**Findings (all documentation/evidence-accuracy — no code defect, confirmed by the reviewer's own words: "No code change is required"):**

1. **Handler counts wrong in both directions** — this file said 41/45 for the two files; actual (reproduced via `grep -c`) is 42/44. **Fixed** — counts corrected above.
2. **"10 destructive channels" denominator inconsistent with the ledger's own 16 HARDENED rows** — "10" is how many *this branch* hardened; 6 were already hardened in base. Read as an internal contradiction. **Fixed** — both `design.md` and this file now state 16 total (6 pre-existing + 10 added by this branch), with the 10 named explicitly.
3. **`trainer-host-start` mislabeled "READ-ONLY / NON-DESTRUCTIVE"** — it spawns a native child process (fixed argv, `shell: false`, no renderer-controlled input — genuinely low risk, but factually not "read-only"). **Fixed** — relabeled "LIFECYCLE — fixed-argv process spawn, non-destructive".
4. **The OUTSIDE NEW-1 CLASS rationale was factually wrong as stated** — framed as "V1 file-based vs. V2 memory/hook-based," but `trainer-host-approve-and-write`/`trainer-host-rollback` (hardened, V2/TrainerHost) also do plain `fs.writeFileSync`/`fs.copyFileSync` file writes — structurally identical to `apply-proposal`/`restore-backup` (unhardened, V1). The reviewer's read: "a future reader could use the stated class rationale to justify leaving other file-write handlers unhardened on reasoning that is demonstrably false." **Fixed** — reframed as an audit-provenance boundary (never named by the original audit / never in Batch B1.1 or review scope) rather than an implementation-mechanism boundary.
5. **Informational, not a defect** — `in-process-propose-hook`'s proposal store is keyed by `proposalId` alone, not scoped by session, creating a confused-deputy-shaped coupling with the now-hardened `in-process-confirm-hook`. Not independently exploitable (still requires passing the trusted main-frame check). **Noted** in the ledger for future "beyond B1.1" awareness, not treated as a NEW-1 gap.
6. **Task-brief drift, not a repo defect** — the review brief said "12 commits"; actual is 10. No evidence-file claim was wrong here, just an inaccuracy in how this review was framed to the reviewer; noted for completeness, nothing to correct in the pack.

**Disposition:** all 5 in-scope findings (1-5) corrected in this evidence set (`remaining-risks.md`, `design.md`) in the same commit that added this section. No code or test change was required or made. The reviewer's own closing assessment: *"Once Finding 4's rationale is restated... this is VERIFIED COMPLETE territory."*

---

## Fourth review — final closure confirmation

Scope: narrow — verify the 5 corrections made in commit `1bfe1f3` in response to the third review are accurate, confirm the commit is docs-only, re-run core regression checks, re-confirm Wisp isolation, and give the final closure verdict.

**Verdict: VERIFIED COMPLETE**

**Explicit answer to "is this branch ready to be closed as NEW-1/NEW-2 verified complete at source/test level?": Yes.**

The reviewer independently reproduced every corrected claim rather than trusting the commit message:
- Recounted `ipcMain.handle` registrations itself: 42 in `electron/live-memory-ipc.ts`, 44 in `electron/main.ts` — matches the corrected figures exactly.
- Independently reproduced the 16 = 6 + 10 breakdown by diffing `requireTrustedSender`/`validateIpcSender` call sites between base `a63e9f5` (6: the freeze/rollback cluster, resolved back to their exact channel names) and HEAD (16 total) — exactly 10 added, matching the named list.
- Read `trainer-host-start`'s actual spawn call in `src/core/trainer-host/host-supervisor.ts:188` and confirmed the argv is genuinely fixed (`entryPath` derived only from `import.meta.url`; `start()` takes zero arguments; the renderer payload is parsed but never forwarded) — the new "LIFECYCLE — fixed-argv process spawn, non-destructive" label is accurate.
- Assessed the reframed OUTSIDE NEW-1 CLASS justification and found it "structurally immune to the old failure mode" — it no longer offers technical reasoning ("V1 vs V2", "file vs memory") that a future reader could misuse to justify leaving some other file-write handler unhardened; it states a scope/provenance boundary instead, immediately followed by an unminimized disclosure of the real gap.
- Independently enumerated **all 86** `ipcMain.handle` registrations across both files (not just the ones already in the ledger) and reconciled every single one 1:1 against the ledger's classifications, explicitly searching for — and finding none of — a handler that was actually in the NEW-1/NEW-2 audit's scope but left unhardened.
- Confirmed `git show 1bfe1f3 --stat` touches only the 3 evidence files, zero production/test code; reran both tsc checks (exit 0/0), `git diff --check` (clean), `git status` (clean); reconfirmed Wisp isolation (`git diff a63e9f5..HEAD` on `wisp.ts`/`companion-wisp.test.ts` → empty).

**Two informational findings, explicitly not blocking, no action taken:**

1. **LOW (evidence traceability)** — the phrase "never named by the original NEW-1/NEW-2 audit" isn't independently verifiable from an in-repo artifact (the strings "NEW-1"/"NEW-2" only appear in this evidence directory); what *is* verifiable in base is the roadmap deferral (`SOLITH_SECURITY_ROADMAP.md:1782`). Doesn't reproduce the prior defect and doesn't affect the scope boundary's soundness, which the reviewer confirmed independently via its own full 86-handler reconciliation.
2. **LOW (informational, pre-existing, not a NEW-1 destructive gap)** — `trainer-host-start` sets `trainerHostOwner` gated only by `isDestroyed()`; an untrusted window could claim ownership first, causing a denial-of-service against the legitimate window for `trainer-host-approve-and-write`/`trainer-host-rollback`. Not a privilege-escalation risk: `requireTrustedSender` still runs before the ownership check on both destructive channels, so the untrusted claimant still cannot write or roll back anything. Same shape as the already-documented `in-process-propose-hook` note.

Also noted: the review brief said "13 commits" / "12 commits" at different points; actual commit count on the branch is 10-11 depending on range. Task-brief drift only, not a repo or evidence-pack defect — nothing to correct here.
