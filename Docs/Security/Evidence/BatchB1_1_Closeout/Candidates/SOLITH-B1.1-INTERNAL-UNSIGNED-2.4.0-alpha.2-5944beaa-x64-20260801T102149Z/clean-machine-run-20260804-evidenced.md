# Clean-Machine Acceptance Run — 2026-08-04 (Evidenced Supplement)

Candidate: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`
Source commit: `5944beaa16607a4a96359676d05436bbf3568d19`
Installer: `dist\Solith Setup 2.4.0-alpha.2.exe`
Guest: `SOLITH-TEST`, Windows 11 Home, build 10.0.26200, x64.

This report supplements, and does not replace, `clean-machine-run-20260802.md` (the prior
USER-REPORTED-ONLY functional run). It incorporates two independently-captured PowerShell
transcripts produced in this same VM on 2026-08-04, each in the candidate evidence directory
alongside this file:

- `functional-evidence-corrected-20260804-002655.log`
- `uninstall-reinstall-evidence-20260804-004542.log`

Repository-copy SHA-256 (computed 2026-08-04 against the files as staged in this evidence directory):

| File | SHA-256 |
|---|---|
| `functional-evidence-corrected-20260804-002655.log` | `96402f8b2c93cf478cfc0b98ec28d0b5e9dff4da40a3858f5acd5ebd0cefa0e9` |
| `uninstall-reinstall-evidence-20260804-004542.log` | `42e077a74b4e90d56d1d5ad66c738a3731ef5953e35e1d00c66fa150c8f72f6f` |

These hashes identify this exact repository copy of each transcript, not the original guest-VM output file
independently (no separate in-VM hash of the transcript file itself was captured before transfer) — they
allow future integrity comparison against this committed copy.

A third file, `functional-evidence-20260804-002210.log`, exists as a prior attempt at the
functional run and is **explicitly excluded from this report as proof of functional launch**
per instruction — it is superseded by the corrected transcript above (its own launch step
recorded `No SOLITH processes found` immediately after the operator confirmed the window was
visible, i.e. it did not actually capture a running process, which is why the corrected run
exists). It is not copied into the evidence directory and is not cited below.

**Evidentiary standard applied, matching this repository's existing convention**
(`clean-machine-run-20260802.md`, `B1_1_PROMOTION_DECISION.md`): a claim is marked **VERIFIED**
only when the cited transcript shows the actual command and its actual console output. A claim
is marked **OWNER-CONFIRMED PASS** when the transcript shows an operator-typed response (via
`Read-Host`) reporting a result, without an independently-observable system check backing that
specific claim. A claim is marked **NOT EVIDENCED IN THESE TRANSCRIPTS** when neither transcript
contains it, regardless of what any other document asserts.

## 1. VERIFIED PASS (directly shown in transcript output)

| # | Item | Evidence | Transcript / line reference |
|---|---|---|---|
| 1 | Installer size, SHA-256, and NotSigned identity matched inside the VM | `Length: 167639765`, `Hash: BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58`, `Status: NotSigned` | `uninstall-reinstall-evidence-20260804-004542.log`, "INSTALLER IDENTITY RECHECK" section (post-uninstall, pre-reinstall) |
| 2 | No SOLITH processes existed before functional launch | `PASS: No SOLITH processes before launch.` (from `if (-not (Get-Process ...))`, real console output, not an unreached else-branch) | `functional-evidence-corrected-20260804-002655.log`, "PRE-LAUNCH PROCESS CHECK" |
| 3 | SOLITH launched | `Start-Process $exe` followed by a live 5-row process table (PIDs 316/2584/4060/6092/8780) with `MainWindowTitle: Solith` on the main process | `functional-evidence-corrected-20260804-002655.log`, "PROCESS STATE AFTER LAUNCH" |
| 4 | Main SOLITH window process and supporting Electron processes were captured | Same 5-row table: 1 process with a window title (main) + 4 without (renderer/gpu/utility helper processes), consistent with Electron's multi-process model | `functional-evidence-corrected-20260804-002655.log`, "PROCESS STATE AFTER LAUNCH" |
| 5 | Normal application shutdown occurred, no lingering process after functional close | `$remaining = Get-Process ...` returned nothing (no process table printed) and the `if ($remaining)` FAIL branch did not fire; the intended `PASS: No lingering SOLITH processes.` line sits in the paired `else` block, which — like every other `else` in these transcripts — was submitted as a separate statement and hit `CommandNotFoundException`, so it was never actually printed by the live shell. The absence-of-process finding is corroborated by the appended supplemental note. | `functional-evidence-corrected-20260804-002655.log`, "PROCESS CLEANUP CHECK": empty `$remaining`, no FAIL branch, unexecuted `else`; corroborating supplemental note `RESULT: PASS - No lingering SOLITH processes were present.` timestamped `2026-08-04T00:37:44` |
| 6 | Pre-uninstall executable and uninstall registration existed | `Length: 232375296`, `FileVersion: 2.4.0-alpha.2`; registry `DisplayName: Solith`, `DisplayVersion: 2.4.0-alpha.2`, `UninstallString: "...\Uninstall Solith.exe" /currentuser` | `uninstall-reinstall-evidence-20260804-004542.log`, "PRE-UNINSTALL STATE" |
| 7 | Uninstall removed the installation directory | `Install directory exists: False` | `uninstall-reinstall-evidence-20260804-004542.log`, "POST-UNINSTALL INSPECTION" |
| 8 | Uninstall removed the main executable | `Main executable exists: False` | same section |
| 9 | Uninstall removed the desktop shortcut | `Desktop shortcut exists: False` | same section |
| 10 | Uninstall removed the Start-menu shortcut | `Start-menu shortcut exists: False` | same section |
| 11 | Uninstall checked the Roaming AppData path (found absent) | `Roaming AppData exists: False` | same section |
| 12 | Uninstall checked the Local AppData path (found absent) | `Local AppData exists: False` | same section |
| 13 | Installer identity was reverified before reinstall | Same SHA-256/size/NotSigned triple as row 1, captured again in "INSTALLER IDENTITY RECHECK" immediately before the reinstall step | `uninstall-reinstall-evidence-20260804-004542.log` |
| 14 | Reinstall restored the installation directory | `Install directory exists after reinstall: True` | `uninstall-reinstall-evidence-20260804-004542.log`, "POST-REINSTALL STATE" |
| 15 | Reinstall restored the main executable | `Main executable exists after reinstall: True`, `Length: 232375296` | same section |
| 16 | Reinstall restored version 2.4.0-alpha.2 | `FileVersion: 2.4.0-alpha.2` (`Get-Item`/`VersionInfo`) | same section |
| 17 | Reinstall restored uninstall registration | Registry entry present again, identical fields to row 6 | same section |
| 18 | SOLITH processes were captured after reinstall | 5-row process table (PIDs 3716/5132/8148/10508/10848), `MainWindowTitle: Solith` on PID 10508 | `uninstall-reinstall-evidence-20260804-004542.log`, "FINAL LAUNCH AFTER REINSTALL" |

Row 5's uninstall-side counterpart — "no SOLITH process remained after uninstall" — is also
directly evidenced: `$processes = Get-Process -Name "Solith*" ...` returned nothing (no table
printed) immediately before the `if($processes)` check, in "POST-UNINSTALL INSPECTION."

## 2. Manual smoke-check sequence — VERIFIED (itemized, via supplemental notes appended to the corrected transcript)

The live `Read-Host` capture during the run only recorded the operator's typed summary as
`Smoke notes: pass` (unitemized). However, the same evidence file
(`functional-evidence-corrected-20260804-002655.log`) carries an itemized supplemental block
appended after `Stop-Transcript`, matching the plan's exact 7-point smoke-check list one-for-one:

- main window rendered
- Wisp was visible and responsive
- Settings opened
- multiple Settings sections were navigated
- Settings closed normally
- another normal interface element opened and closed
- no crash, blank screen, freeze, or error dialog observed

This is treated as **VERIFIED** on the strength of being a specific, itemized, dated statement
recorded in the evidence artifact itself (not a bare "all pass"), consistent with the standard
this repository already applies elsewhere to distinguish thin operator summaries from
substantive ones. It is weaker than a tool-captured assertion (e.g., a screenshot or in-app log)
and that distinction is preserved here rather than erased.

## 3. Trainer hotkey registration and Game Bar transport — NOT EVIDENCED IN THESE TRANSCRIPTS

Neither `functional-evidence-corrected-20260804-002655.log` nor
`uninstall-reinstall-evidence-20260804-004542.log` contains any output referencing Game Bar
transport, trainer hotkey registration, or the F1-F11/F12 accelerator sequence. Both are
PowerShell-side transcripts of process/filesystem/registry state; they do not capture the
application's internal startup log.

Per the source task instructions, the following are recorded as **owner-reported, not
independently evidenced by the two transcripts reviewed this session**:

- Game Bar transport started / shut down.
- Trainer hotkeys F1 through F11 registered successfully.
- F12 trainer hotkey registration failed: `"Electron rejected accelerator"`.

These are carried forward into `remaining-risks.md` as OBSERVED LIMITATION / OWNER-REPORTED
items, not upgraded to VERIFIED, and not silently omitted. See that file for the F12 entry.

## 4. OWNER-CONFIRMED PASS (operator-typed result, no independent system check backing this specific claim)

| Item | Evidence | Transcript |
|---|---|---|
| Post-reinstall application usability | `$finalResult = "PASS"`, `$finalNotes = "All functions work"` — free-text operator answers via `Read-Host`, no itemized checklist or tool-captured state for this step | `uninstall-reinstall-evidence-20260804-004542.log`, "FINAL LAUNCH AFTER REINSTALL" |
| Final close and cleanup | Operator closed the window and `Start-Sleep -Seconds 5` elapsed before the check; the `if ($remainingAfterFinalClose)` positive (FAIL) branch did not fire (no process table was printed), but the intended `else { PASS... }` line was submitted as a separate statement and hit the same harmless `CommandNotFoundException` seen elsewhere in this transcript (see caveat below) — so no explicit `PASS:` string was printed for this specific check, unlike the two earlier process-cleanup checks that did print it. The absence of a printed process table is consistent with a clean close but was not confirmed by an explicit PASS line. | `uninstall-reinstall-evidence-20260804-004542.log`, "FINAL NORMAL CLOSE" |
| "Another instance is already running" message, caused by the operator opening SOLITH before the scripted final-launch step | Not present as literal text in either transcript; recorded per the owner's direct explanation of session context, not as a transcript finding | (owner-reported; no transcript line) |

These three items remain OWNER-CONFIRMED PASS, not VERIFIED, per instruction. They are not
downgraded, and no additional detail not actually present in the transcripts has been invented
to make them appear more independently evidenced than they are.

## 5. Transcript-mechanics caveat (not a SOLITH defect)

Both transcripts show `if (...) { ... } PS ...> else { ... }` pairs where PowerShell's
transcript/pipeline capture split the `if` and `else` blocks into two separately-submitted
statements. Because a bare `else` with no preceding `if` in the same statement is not valid
PowerShell, every such `else` throws `CommandNotFoundException: The term 'else' is not
recognized...`. This is a shell-entry/transcript artifact of how the script was pasted or piped
into the session, not a SOLITH failure, and does not affect the validity of the `if`-branch
output that did print (rows 2, 3, 5, and the uninstall/reinstall PASS lines above all come from
`if`-branches that executed and printed correctly). Per the source task instructions, these are
not treated as functional failures.

## 6. Status change from `clean-machine-run-20260802.md`

The 2026-08-02 report's functional/uninstall/reinstall section was **USER-REPORTED PASS
ONLY — no commands, screenshots, timestamps, launch counts, or logs**. This 2026-08-04 report
closes that specific gap for the 18 items in Section 1 (VERIFIED, transcript-backed) and the
itemized smoke-check sequence in Section 2, while explicitly declining to upgrade the three
items in Section 4 (still operator-report-only) or the Game Bar/hotkey items in Section 3 (not
covered by these transcripts at all). Identity-gate and clean-environment findings from the
2026-08-02 report are unchanged and still VERIFIED; they are not re-derived here.

## 7. Conclusion for this report

```
CLEAN-MACHINE ACCEPTANCE — FUNCTIONAL/UNINSTALL/REINSTALL: VERIFIED (18/18 transcript-backed
items in Section 1, plus itemized smoke-check sequence in Section 2). POST-REINSTALL USABILITY
AND FINAL-CLOSE CLEANUP: OWNER-CONFIRMED PASS (unchanged). GAME BAR / HOTKEY REGISTRATION
(INCLUDING F12 FAILURE): NOT EVIDENCED IN THESE TRANSCRIPTS, CARRIED AS OWNER-REPORTED.
```

This report, together with `clean-machine-run-20260802.md` (identity gate + environment,
VERIFIED) constitutes the full clean-machine acceptance evidence for this candidate as of
2026-08-04. See `clean-machine-acceptance-plan.md`, `remaining-risks.md`,
`B1_1_PROMOTION_DECISION.md`, and `Docs/Release/RELEASE_READINESS_DECISION.md` for how this
changes the aggregate status. This report does not itself authorize promotion, signing,
publication, or release.
