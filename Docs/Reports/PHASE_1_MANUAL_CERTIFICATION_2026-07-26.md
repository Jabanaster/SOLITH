# Phase 1 Manual Certification

**Status:** PENDING FINAL PROCESS-PICKER CERTIFICATION — discovery portion passed

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

- Exact target first: NOT TESTED
- Installed games grouping: NOT TESTED
- Metadata shown: NOT TESTED
- Non-games hidden: NOT TESTED
- Critical processes blocked: NOT TESTED
- Closed process removed: NOT TESTED
- Stale selection rejected: NOT TESTED

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

No open discovery defect remains. Process-picker manual certification is pending.

## CSP Verification

- Zod dynamic-code capability probe identified as the warning source: PASS
- Solith-owned direct dynamic-code usage absent: PASS
- Zod configured with `jitless: true`: PASS
- Production CSP unchanged and contains no `unsafe-eval`: PASS
- Production renderer source maps disabled: PASS
- Packaged runtime CSP/eval violations: 0
- Development-console restart verification: PASS — isolated development renderer captured three console messages and zero CSP/eval violations.

## Final Verdict

**BLOCKED** — discovery manual certification passed. The seven required process-picker cases remain `NOT TESTED`; Phase 1 is not yet approved for closure, and Phase 2 must not begin.

## Sign-off Rule

Phase 1 may be approved only when every required item is `PASS`. Any `FAIL` keeps the phase open. Any `BLOCKED` entry must state its blocker and next action. Any remaining `NOT TESTED` prevents sign-off.

## Sign-off

- Tester:
- Execution date/time:
- Evidence location:
- Release owner review:
