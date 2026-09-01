# SOL-0 — Baseline and Authority Audit — Final Report

> **Repository:** `Jabanaster/SOLITH`
> **Worktree:** `G:/ACTIVE_PROJECTS/solith-master-integration`
> **Audit date:** 2026-09-01
> **Starting HEAD:** `0398c8a954a4a909b2e147fde84aed8dd249b085` (`master`, exact match)
> **Result branch/commit:** `docs/sol0-baseline-authority-audit` @ `a92e4d0` — **NOT PUSHED**
> **Full authority matrix:** [`SOL0_ACTION_AUTHORITY_MATRIX.md`](SOL0_ACTION_AUTHORITY_MATRIX.md)

## 1. Baseline

Worktree, branch, and HEAD matched the expected baseline exactly. Tree clean throughout; all 5 pre-existing stashes untouched. Work committed to a new isolated branch, not directly to `master`.

## 2. Action surface inventory

Filesystem read/write/rename/backup/archive/installer — present, contained. Process discovery/attach/detach/helper-launch — present; target-game launch/general input injection — not present. Live-memory read/write/patch/freeze — present. Hotkeys/overlay — present; general window control of other apps — not present. Network — 3 bounded surfaces (artwork cache, catalog sync, local-AI probe), no telemetry. Credentials — none stored. Registry — read-only, Steam/Epic install-path lookup only. Shell/PowerShell — bounded via absolute-path resolution (PATH-hijack defense). Elevation/UAC — none. Browser automation — confirmed absent. Full table: matrix §1.

## 3. Current authority model

No unified evaluator. A combination of: universal IPC sender-identity validation (180/180 handlers), live process-identity re-verification before every mutating write, deny-list (not allow-list) target-process authorization, cryptographically-bound consent tokens for the 3 highest-risk operations (weaker proposalId-consumption for 2 others), and inconsistently-applied packaged-build environment gating (see §4).

## 4. Consent model

10 distinct mechanisms inventoried. Observation never authorizes mutation; mutation never authorizes deletion (confirmed by code trace). Strongest mechanisms: SHA-256-bound, single-use, 5-min-TTL tokens. Weakest: hook-install and trainer-host-write use non-cryptographic proposalId maps.

## 5. Destructive policy

All confirmed destructive paths are `confirm()`-gated except one: startup crash-recovery auto-restore (`recoverInterruptedOperations()`), which overwrites the current file from backup automatically with no gate. Classified as SOL-1 gap G5, not P0 — bounded, backup-hash-verified, not externally reachable.

## 6. Machine scope

**Classification: arbitrary process.** Live-memory attach is a deny-list of system/anti-cheat/self processes, not an allow-list of known games. Filesystem and registry are both actively contained.

## 7. Control providers

memoryjs, child_process (path-hardened), fs/atomic-write, fetch (3 bounded surfaces), Electron overlay windows, injector-helper spawn (hash/path/publisher-checked). Full table: matrix §6.

## 8. Emergency stop

No single kill-switch. Freeze-stop is race-safe but doesn't restore mutated memory. Session-cleanup revocation check has a coincidental (not structural) race guarantee. `readOnlyMode` hard kill switch is fully built but unreachable in production. **Verdict: PARTIAL fail-closed.**

## 9. Process lifecycle

Identity re-verified before every mutating write, not just at attach. **Stale-PID mutation of a replacement process: confirmed NOT possible**, test-covered. TrainerHost termination is tool-return-only in production (PID-death confirmed only in the standalone `orphan-check.mjs` script).

## 10. Browser control

**Confirmed absent** — zero runtime hits for navigate/submit/playwright/puppeteer outside test infrastructure.

## 11. Audit / verification coverage

Journal exists but isn't wired to live-memory writes and lacks caller-identity/consent-state/correlation-ID fields. File-based mutations are all VERIFIED POSTCONDITION (hash-compared); memory writes/rollbacks are PARTIAL (no read-back).

## 12. Action authority matrix

Complete — see [`SOL0_ACTION_AUTHORITY_MATRIX.md` §12](SOL0_ACTION_AUTHORITY_MATRIX.md#12-action-class--policy-matrix-sol-0-descriptive-snapshot).

## 13. SOL-1 gap list

G1–G11 documented: unified evaluator, P0 fix, scope decision, consent-strength migration, crash-recovery gate, memory-write postcondition, dead kill-switch, no-restore-on-stop, revoking-flag race, journal schema, termination verification. Full detail: matrix §11.

## 14. Verification

```
npm test                        → 1699/1699 pass, 0 fail + SQL 10/10 pass
node scripts/orphan-check.mjs   → PASS
npm audit --omit=dev            → 0 vulnerabilities
CI on 0398c8a9                  → all required checks green
IPC sender-validation coverage  → 17/17 files, 180/180 handlers, 0 gaps
```

No code changed this session (all 6 domain audits were read-only), so this evidence — captured on this exact HEAD before SOL-0 began — stands without re-running.

## 15. SOL-0 certification decision

**`PARTIAL`**

Every exit-gate item is met with reproducible evidence except one: "no undocumented P0 authority vulnerability remains." SOL0-P0-1 is documented, not fixed — per the governing rule requiring STOP-and-report rather than in-pass implementation.

### SOL0-P0-1 (CRITICAL, not fixed this session)

`electron/privileged-consent-dialog.ts:45-53` (`resolveDialogImpl`) and `:122` (`requestPrivilegedWriteConsent`) read `SOLITH_PRIVILEGED_CONSENT` / `SOLITH_CONSENT_TTL_MS` from `process.env` with **no `app.isPackaged` gate** — unlike the established pattern in `electron/runtime-trust.ts`. Setting `SOLITH_PRIVILEGED_CONSENT=auto-approve` before launching the packaged app silently auto-approves every privileged consent dialog (live-memory write confirmation, freeze start, injector-helper launch), with no user interaction and no separate log of the bypass.

## 16. Files changed

- `Docs/authority/SOL0_ACTION_AUTHORITY_MATRIX.md` (new)
- `MASTER_ROADMAP.md` (SOL-0 status block + TODO register, +18/-2)

## 17. Commit / push

Branch `docs/sol0-baseline-authority-audit`, commit `a92e4d0`. **NOT PUSHED** — no push authorization given this session.

## 18. Next execution package

Not SOL-1 yet — SOL-0 is PARTIAL. Exact remaining closeout task: **fix SOL0-P0-1** (2-line, isolated-file change: gate both env-var reads on `!app.isPackaged`, mirroring `runtime-trust.ts`'s existing pattern), then SOL-0 can move to CERTIFIED.

## 19. Quick look

**Next:** Fix SOL0-P0-1 (packaged-build gate on `electron/privileged-consent-dialog.ts`'s env overrides), as its own tightly-scoped change.
**Why:** It's the sole remaining SOL-0 exit-gate blocker — a real, currently-live, silent consent-bypass on `master`, not a SOL-1 architecture question.
**Blocked by:** Nothing technical. Needs explicit authorization to make a code (not docs-only) change, since this session's SOL-0 scope was audit-only.
**After that:** `SOL-1 — Governed Computer Control 2.0`.
