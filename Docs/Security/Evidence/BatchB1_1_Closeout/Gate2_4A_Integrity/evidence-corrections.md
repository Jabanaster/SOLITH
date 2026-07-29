# evidence-corrections.md — Gate 2.4A corrections to Gate 2.4 evidence

Raw evidence (test output logs, matrices, diff captures) is NOT rewritten.
Only derived summary statements are corrected below, per SOLITH.MD Gate 2.4A
Phase 8.

## Correction 1 — Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_4/verification-final.txt

- **Original claim** (line ~123, "Scope integrity" section): "Only harness-
  created SOLITH, Gate 2.2 fixture, and overlay-window processes were
  interacted with this cycle; confirmed no leftover Solith.exe/Gate2_2Fixture.exe
  processes after cleanup." followed by lines 129-132 which already disclosed
  the deletion.
- **Corrected claim**: The original file already disclosed the deletion in
  its own "Scope integrity" section (lines 129-132) and in its "Verdict"
  section did not claim a clean scope-integrity result. No factual correction
  to this file's text is required; this Gate 2.4A cycle adds independent
  confirmation (via `status-diff-baseline-vs-current.txt`) that the deletion
  of `test_output.txt` was the **only** unauthorized change, and formally
  reclassifies Gate 2.4's scope-integrity status as **FAIL** (was previously
  narratively disclosed but not given a formal pass/fail scope-integrity
  verdict).
- **Reason**: SOLITH.MD's Gate 2.4A brief states Gate 2.4 is "not cleanly
  complete" and requires the explicit status: `Gate 2.4 scope integrity: FAIL`.
- **Supporting evidence**: `gate2_4-scope-integrity-matrix.csv`,
  `status-diff-baseline-vs-current.txt` (Gate2_4A_Integrity).
- **Correction date**: 2026-07-29.

## Correction 2 — Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_4/changed-files.txt

- **Original claim**: Lists only the 42 pre-existing tracked files modified
  since baseline plus the one new test file; does not mention any deletion.
- **Corrected claim**: Add an explicit note that one pre-existing untracked
  file (`test_output.txt`) was deleted during this cycle and is not part of
  the intentional changed-file set.
- **Reason**: `changed-files.txt` is meant to be the authoritative diff
  manifest for the cycle; an unauthorized deletion is a change that belongs
  in that manifest even though it was not an intended content change.
- **Supporting evidence**: `status-diff-baseline-vs-current.txt`.
- **Correction date**: 2026-07-29.

## Correction 3 — Docs/Security/Evidence/BatchB1_1_Closeout/Gate2_4/remaining-risks.md

- **Original claim**: Already includes R-2.4-007 disclosing the deletion (added
  proactively when the error was discovered, before this Gate 2.4A cycle began).
- **Corrected claim**: No factual correction needed. This Gate 2.4A cycle adds:
  (a) confirmation that recovery was attempted and failed (see
  `recovery-decision.md`), (b) confirmation that no other pre-existing file was
  affected (see `gate2_4-scope-integrity-matrix.csv`), and (c) confirmation
  that the deletion had no effect on test results or security conclusions (see
  `gate2_4-verification-impact.md`). R-2.4-007 itself remains accurate as
  written and is carried forward unchanged, now with these follow-up findings
  layered on top.
- **Reason**: Completeness — R-2.4-007 as originally written already met the
  disclosure bar; this cycle closes out the open questions it left (was
  recovery possible, was anything else affected, did it matter).
- **Supporting evidence**: `recovery-decision.md`, `gate2_4-scope-integrity-
  matrix.csv`, `gate2_4-verification-impact.md`.
- **Correction date**: 2026-07-29.

## Correction 4 — "Files and processes left behind: None"

The statement "Files and processes left behind: None" (as it appeared in this
engagement's pattern of final-status reporting for prior gates, and was
implicitly the expected clean-state claim for Gate 2.4 before the deletion was
discovered) is corrected to:

> No harness-created process remained, but Gate 2.4 caused one unauthorized
> deletion of a pre-existing untracked file (`test_output.txt`).

This corrected language is the authoritative statement going forward and is
reflected in this cycle's `verification-final.txt`.
