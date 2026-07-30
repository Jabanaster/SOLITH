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

[Result appended below once the dispatched reviewer returns.]
