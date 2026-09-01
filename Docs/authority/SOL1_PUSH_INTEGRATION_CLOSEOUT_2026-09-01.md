# SOL-1 Authority Core — Push/Integration Closeout

> **Repository:** `Jabanaster/SOLITH` · **Branch:** `master`

## 1. Baseline

- Starting `origin/master`: `555819a` (SOL-0 documentation reconciliation)
- Mid-session pivot: `MASTER_ROADMAP.md` replaced with a gaming-first SOL-0..SOL-22
  roadmap at the user's direction (see `Docs/ROADMAP_ARCHIVE_SECURITY_TRACK_2026-09-01.md`
  for the superseded security/authority-track roadmap, preserved verbatim).

## 2. Authority-core work (branch `feature/sol1-governed-computer-control`)

- `src/core/authority/`: capability vocabulary (30 members), typed
  request/decision contracts, deterministic fail-closed evaluator, policy
  registry, target/path classifiers (wrapping existing
  `protected-target-guard.ts` / `path-safety.ts` unchanged), grants
  (bounded/single-use approval tokens). 77 unit tests.
- `electron/authority-bridge.ts` / `authority-ipc.ts`: IPC bridge,
  sender-validated identically to `handleGuarded`. Real `readOnlyMode` kill
  switch (closes prior-roadmap gap G7).
- `delete-game` / `delete-recipe` / `restore-backup`: evidence-only
  `destructive.delete` evaluation (not blocking — no existing backend
  approval artifact for these handlers; documented exception).
- `host-supervisor.ts` `stop()`: now actually waits for the child's `close`
  event (bounded 2s), escalates to `SIGKILL` and waits once more if it
  doesn't close in time, before clearing PID/lifecycle state (closes prior
  gap G11 — a review round caught that the first-pass fix only did a
  synchronous liveness probe, not a real wait-for-exit).
- `live-memory-session.ts`: re-checks a revoke flag after each async
  await-gap in `confirmWrite`/`rollback`/freeze-tick, before the actual
  memory write (closes prior gap G9).
- `protected-target-guard.ts`: added optional structured `blockedKind`
  discriminator to `assessTargetProcessAuthorization()`'s result
  (additive, backward-compatible) so callers don't need to parse `reason`
  text.
- Full status/architecture doc: `Docs/authority/SOL1_GOVERNED_COMPUTER_CONTROL.md`
  — certification decision **PARTIAL** (core implemented and tested; domain
  integration, emergency-stop wiring, and packaged-runtime evidence remain
  outstanding).

## 3. Review cycle

GitHub Copilot's automated review found 1 real defect and 5 code-quality
nits, all fixed:

1. **Real defect:** `stop()`'s first-pass fix (`verifyExitOrKill()`) was a
   single synchronous probe, not an actual wait — could clear lifecycle
   state while the child was still running. Fixed with a bounded
   wait-for-`close` + SIGKILL escalation.
2. Brittle string-matching (`reason.includes(...)`) for self-vs-system
   classification — replaced with the new `blockedKind` discriminator.
3-5. Three per-call `Set` allocations in hot evaluator paths — hoisted to
   module scope.
6. Capability-specific policy rules shared one `"{capability}:custom"`
   policyId — now indexed per rule for audit-trail clarity.

All 6 inline review threads replied to and resolved.

## 4. CI / merge

- PR: [#25](https://github.com/Jabanaster/SOLITH/pull/25)
- One CI failure en route, fixed: `tsconfig.electron.json` (`strict: false`)
  failed to narrow a discriminated union in `authority-ipc.ts` that the main
  `tsconfig.json` narrowed fine — fixed by giving both branches the same
  shape instead of relying on control-flow narrowing.
- Final CI on the PR head commit (`fbe1bf6`): TypeScript and architecture
  checks, Windows native and Electron gate, `fast`, `scan` (x2),
  `scan-pr / osv-scan`, `verify`, CodeRabbit — all **pass**. `mergeStateStatus: CLEAN`.
- Merged via `gh pr merge --merge` → `cf6ef56`.

## 5. Final master

- `origin/master` = `cf6ef56` (`Merge pull request #25 ...`)
- `git merge-base --is-ancestor fbe1bf6 origin/master` → confirmed ancestor.
- Confirmed on `origin/master`: `MASTER_ROADMAP.md` is the gaming-first
  roadmap, `Docs/authority/SOL1_GOVERNED_COMPUTER_CONTROL.md`,
  `src/core/authority/authority-service.ts`, `electron/authority-ipc.ts`
  all present.

## 6. Verification evidence (reproduced locally before push and after merge)

```
npm test                    -> 1776/1776 pass (was 1699/1699 pre-branch)
npx tsc --noEmit             -> 0 errors
npx tsc --project tsconfig.electron.json --noEmit -> 0 errors
npm run test:trainer-host    -> 81/81 pass
npm run orphan-check         -> PASS (host-supervisor stop() exercised against real spawned PID)
npm run build:electron       -> 29/29 checks pass
git diff --check             -> clean
```

## 7. Status

- **SOL-1 authority core:** PARTIAL, not CERTIFIED — see
  `Docs/authority/SOL1_GOVERNED_COMPUTER_CONTROL.md` §10 for the exact
  remaining work.
- **Product roadmap:** SOLITH is now gaming-first (`MASTER_ROADMAP.md`
  SOL-0..SOL-22). The authority-layer code is merged, untouched, and
  unclassified pending the new roadmap's SOL-0 audit
  (PRESERVE/ADAPT/MOVE-EXTRACT/REMOVE/DEFER) — see the roadmap's "Pending
  reconciliation" section.

**Next:** New-roadmap SOL-0 (Gaming Scope & Architecture Reconciliation) —
not started this session.

**Blocked by:** nothing technical. Awaiting a product decision on whether
to run the SOL-0 audit next, or something else.
