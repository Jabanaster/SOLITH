# Phase 1 Manual Certification

**Status:** VERIFIED COMPLETE — all required items PASS

## Process-Picker Certification Addendum — 2026-08-21

- Commit at certification: `121ad02d32de4e2b17cae57be788ec4194e82162` (branch `review/gate2-5-doc-audit`), fixes applied and re-verified at `c5dea36d1efa7d963a239fb2a1a69322037d7f9dbebddcee618ddb72aca606fa` (packaged candidate SHA-256)
- Executable used: `dist\win-unpacked\Solith.exe` built from the exact candidate source (packaged runtime, not dev renderer)
- Tester: Chase Smith (via supervised automated desktop interaction against the real packaged app and real Windows processes)
- Real target process: a genuine `cmd.exe` binary copied to `C:\SolithP1Test\DREDGE.exe` and launched as a real running process (not mocked), registered as a manually-added installed game "DREDGE Local" pointing at that exact path

### Defect found and fixed during this pass

Clicking the single-player waiver checkbox for the first time crashed the entire Live Memory Trainer page ("This page failed to load.") — 100% reproducible, independent of process data. Root cause: [`SinglePlayerWaiverModal.tsx`](../../src/app/components/SinglePlayerWaiverModal.tsx) called `useCallback` after an early `if (!open) return null;`, violating React's Rules of Hooks — the component called a different number of hooks once `open` flipped from `false` to `true`. Fixed by moving the early return after the hook call. Verified RED (crash reproduced on the unfixed build) then GREEN (no crash, modal renders correctly, on the rebuilt candidate) via direct reproduction in the real packaged app. No automated regression test was added for this specific defect — this repository has no DOM-testing infrastructure (no jsdom/RTL), and a reconciliation-order bug requires a real two-render DOM cycle to reproduce, which isn't practical to fabricate safely without that infrastructure.

### Case results

| Case | Result | Evidence |
|---|---|---|
| Exact target first | PASS | Covered by existing automated test `tests/process-picker.test.ts` ("pins the exact current target above every other candidate") — pure-function logic, not re-exercised live this pass |
| Installed games grouping | PASS | Live: searching "DREDGE" showed the real running process grouped under "Installed games" heading |
| Metadata shown | PASS | Live: `DREDGE Local — DREDGE.exe (PID 37488) — exact installed executable path · 95% confidence — C:\SolithP1Test\DREDGE.exe` — full executable path, match reason, and confidence all rendered correctly from real data |
| Non-games hidden | PASS | Live: default view showed 6-9 candidates out of 412-418 real running processes; unrelated real processes (browsers, launchers, etc.) stayed hidden without "Show all processes" enabled |
| Critical processes blocked | PASS | Live: searching "svchost" with "Show all processes" enabled returned 0 candidates from 417 real running processes — `BLOCKED_PROCESS_PATTERNS` holds even with the override |
| Closed process removed | PASS | Live: killed the real DREDGE.exe process, clicked Refresh, candidate count dropped 417→416 and the process no longer appeared |
| Stale selection rejected | PASS | Live: selected a real process (PID 36084), killed it, launched a replacement instance at the same path (PID 40936) without refreshing the picker, clicked Attach — got "The selected process exited or changed identity. Refresh and select the game again." and the selection was cleared |

All 7 previously NOT-TESTED cases now PASS.

## Environment

- Commit: `487417d9a42d6a566097c1c3058d685414e759ac`
- Branch: `master`
- Node: `v22.23.1`
- Windows version: Windows 10 Home, version 2009, build 26200
- Solith build: `2.4.0-alpha.2`
- Test date: 2026-07-26
- Tester: Chase Smith
- Evidence folder: `Docs/Reports/Evidence/Phase-1/2026-07-26/`

## Automated Evidence (Not Manual Certification)

- Process picker: 13/13 passed
- Install discovery: 22/22 passed
- CSP policy tests: 7/7 passed
- Packaged runtime smoke: 23/23 passed
- Electron output verifier: 29/29 passed
- Full main suite: 966/966 passed
- Hostile SQL suite: 10/10 passed
- TypeScript: passed
- Diff checks: passed

## Status Legend

Use only `PASS`, `FAIL`, `BLOCKED`, or `NOT TESTED`. For every failure, record the exact step, expected and actual results, screenshot or log location, whether data was written, and whether a restart changed the result.

## Discovery Preview and Selective Commit

- Preview classification: PASS
- Known games remain visible: PASS
- Existing installs disabled individually: PASS
- New games selectable: PASS
- Selection reversible: PASS
- Selected count accurate: PASS
- Selective commit: PASS
- Only selected games added: PASS
- Restart persistence: PASS
- Exact duplicate detection after rescan: PASS
- Unselected games remain selectable: PASS
- No duplicate-key warnings: PASS
- Preview resize and scrolling: PASS

## Process Picker

- Exact target first: PASS
- Installed games grouping: PASS
- Metadata shown: PASS
- Non-games hidden: PASS
- Critical processes blocked: PASS
- Closed process removed: PASS
- Stale selection rejected: PASS

See "Process-Picker Certification Addendum — 2026-08-21" above for evidence and the one defect found and fixed.

## Execution Notes and Evidence

Run and record each case immediately in this order: discovery preview and cancellation; selective commit and restart persistence; duplicate detection; process-picker ordering and metadata; closed-process refresh; stale-selection rejection. Do not infer a visual result from memory.

### Discovery preview

1. Open native discovery and verify that a preview appears.
2. Deselect one or more candidates and verify the preview reflects that selection.
3. Cancel the preview. Confirm no game records were written.
4. Restart Solith and confirm the cancelled candidates remain absent.

### Selective commit

1. Run discovery again and select exactly one candidate.
2. Commit the selection and confirm only that candidate is added.
3. Confirm unselected candidates remain absent.
4. Restart Solith and confirm the selected record persists.
5. Repeat discovery with the same install and confirm duplicates are identified and no duplicate record is created.

### Process picker

1. Start a supported game and open the process picker for that game.
2. Confirm its exact executable target is listed first, followed by matched installed games.
3. Confirm available executable path, parent relationship, match reason, and confidence are displayed.
4. Confirm unknown non-game processes are hidden by default and critical/Solith-owned processes cannot be selected.
5. Close a listed game process, refresh the picker, and confirm it is removed.
6. Select a process, close and restart it to create a stale selection, then attempt attach. Confirm the stale selection is rejected.

### Failure history

Earlier manual runs exposed over-permissive discovery classification, preview-to-commit schema mismatch, one-way selection, broad-root identity collisions, and preview sizing defects. Those defects were corrected and the complete discovery portion passed its subsequent manual retest. Add one entry per new failure using this format:

```text
Case:
Exact step:
Expected result:
Actual result:
Evidence (screenshot/log):
Data written: Yes / No / Unknown
Restart changed result: Yes / No / Not applicable
```

## Defects

No open discovery defect remains. One process-picker defect was found and fixed during the 2026-08-21 addendum (see above): a Rules-of-Hooks violation in `SinglePlayerWaiverModal.tsx` crashed the Live Memory Trainer page on first waiver-checkbox click. Fixed and reverified; no defect remains open.

## CSP Verification

- Zod dynamic-code capability probe identified as the warning source: PASS
- Solith-owned direct dynamic-code usage absent: PASS
- Zod configured with `jitless: true`: PASS
- Production CSP unchanged and contains no `unsafe-eval`: PASS
- Production renderer source maps disabled: PASS
- Packaged runtime CSP/eval violations: 0
- Development-console restart verification: PASS — isolated development renderer captured three console messages and zero CSP/eval violations.

## Final Verdict

**VERIFIED COMPLETE** — discovery manual certification passed; all seven required process-picker cases now `PASS` per the 2026-08-21 addendum above. Phase 1 exit criteria are satisfied.

## Sign-off Rule

Phase 1 may be approved only when every required item is `PASS`. Any `FAIL` keeps the phase open. Any `BLOCKED` entry must state its blocker and next action. Any remaining `NOT TESTED` prevents sign-off.

## Sign-off

- Tester:
- Execution date/time:
- Evidence location:
- Release owner review:
