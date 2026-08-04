# Clean-Machine Acceptance Run — 2026-08-02

Candidate: `SOLITH-B1.1-INTERNAL-UNSIGNED-2.4.0-alpha.2-5944beaa-x64-20260801T102149Z`
Source commit: `5944beaa16607a4a96359676d05436bbf3568d19`
Installer: `dist\Solith Setup 2.4.0-alpha.2.exe`

This report executes the plan in `../clean-machine-acceptance-plan.md`. It replaces that plan's
`NOT PERFORMED` status with a mixed result: the environment setup and candidate-identity gate were
independently captured by the orchestrating session (tooling/command output); the installation and
functional behavior inside the VM were relayed by the human operator working in the VM's own GUI
session, without independently captured commands, screenshots, or logs. **These two categories are
kept separate throughout this report and must not be merged or upgraded.**

## Status

```
CLEAN-MACHINE ACCEPTANCE: PARTIAL — IDENTITY GATE VERIFIED, FUNCTIONAL RESULT USER-REPORTED ONLY
```

This is not a pass/fail determination against the plan's Pass/Fail criteria (`clean-machine-acceptance-plan.md`,
"Pass/fail criteria" section), because that section requires evidence (logs, screenshots, process-list
captures) for the install/launch/security-scenario/upgrade/uninstall/reinstall steps that was not produced
in this run. See "Gap against the original plan" below.

## 1. Identity gate — VERIFIED (directly captured by the orchestrating session)

Captured both pre-transfer on the host and post-transfer inside the guest VM, before installation:

| Check | Expected | Observed (host, pre-transfer) | Observed (VM, post-transfer) |
|---|---|---|---|
| SHA-256 | `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58` | `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58` | `BB880D6F4A0D375FB294626B4FADD2B2AA687BD18A81A54D8A66EDA335A72B58` |
| Size (bytes) | 167639765 | 167639765 | 167639765 |
| Authenticode | NotSigned | NotSigned (`Get-AuthenticodeSignature`: "The file ... is not digitally signed.") | NotSigned (same StatusMessage) |

This is a stronger identity check than the local (non-clean) installation-verification evidence
(`../installation-verification.md`), which only hashed the installer and installed exe on the dev
machine. Here the exact bytes transferred into an isolated clean VM were independently re-hashed
after transfer, closing the "was the right file actually what got installed in the VM" gap.

## 2. Clean-machine environment — VERIFIED (directly configured/verified by the orchestrating session)

- Hypervisor: VirtualBox 7.2.14, VM `SOLITH-B1.1-CLEAN`, host VirtualBox instance at `D:\VitualBox`.
- Guest OS: Windows 11 Home, 25H2, x64. Installer ISO SHA-256
  `768984706B909479417B2368438909440F2967FF05C6A9195ED2667254E465E3`, verified against Microsoft's
  posted hash before use.
- VM spec: 4 vCPU, 8192MB RAM, 80GB dynamic VDI, ICH9 chipset, EFI firmware, TPM 2.0, NAT network,
  clipboard disabled, drag-and-drop disabled, no shared folders, no Guest Additions installed.
- Windows fully updated inside the VM before the baseline snapshot was taken.
- Snapshot `SOLITH-B1.1-CLEAN-BASE` taken (VM state: poweroff) before any candidate transfer —
  confirmed zero SOLITH exposure at that point.
- No source repository, Node, Git, or Visual Studio was ever placed in the VM at any point in this run.
- Transfer mechanism: temporary local HTTP server on the host (`python http.server`, bound to
  `0.0.0.0:18765`), serving only the single verified installer file from an isolated `D:\Transfer`
  directory. Fetched inside the guest via `Invoke-WebRequest http://10.0.2.2:18765/...`. The server was
  stopped immediately after transfer and verification.
- Post-test snapshot `SOLITH-B1.1-ACCEPTANCE-PASS` taken (VM state: poweroff) as a child of
  `SOLITH-B1.1-CLEAN-BASE`, description: "Frozen SOLITH B1.1 candidate installed and tested on clean
  Windows 11 VM. Installer identity verified. Installation, launch, functional smoke testing, process
  cleanup, uninstall, and reinstall reported passing."

This satisfies the plan's environment requirements (OS build, no prior SOLITH exposure, no dev tooling,
pre-install snapshot, trusted offline-style transfer rather than an untrusted network fetch) and the
plan's candidate-identity requirement.

## 3. Installation and functional behavior — USER-REPORTED PASS ONLY (not independently verified)

The following was relayed by the human operator working inside the VM's own GUI session. **The
orchestrating session has no direct evidence for any of this** — no command transcripts, no exit codes,
no screenshots, no process-list captures, no log excerpts, no timestamps, no launch counts. The operator
was asked twice for exact commands, timestamps, launch counts, or logs and replied only "all pass"
without providing them. Nothing below has been upgraded to VERIFIED, and no supporting detail that was
not actually provided (exact timestamps, exact launch counts, screenshot files, log excerpts) has been
invented to fill the gaps. Where a value was not given, it is marked "not recorded."

| Step (per plan procedure) | Operator-reported result | Detail recorded |
|---|---|---|
| Install (procedure step 4) | Succeeded | Installed version reported as `2.4.0-alpha.2`; installed path reported as `C:\Users\chase\AppData\Local\Programs\solith` (exact wording as relayed). Install duration: not recorded. UAC/SmartScreen prompt text: not recorded. Shortcut creation: not recorded. |
| Pre-first-launch process check | No SOLITH process running | Command used: not recorded. |
| First launch (procedure step 5) | Succeeded | Startup timing marks (`SOLITH_STARTUP_TRACE`): not recorded. Window visibility / in-app version display: not recorded beyond "succeeded." |
| Core functionality smoke test | "Worked" | No specifics on what was exercised were given (which scenarios, which security-boundary checks from procedure step 6, online vs. offline per the plan's network requirement). |
| Repeated launches | "Worked" | Launch count: not recorded. Cold vs. warm distinction: not recorded. |
| Process cleanup | "Worked" | Method used (Task Manager, `Get-Process`, etc.): not recorded. |
| Uninstall (procedure step 9) | "Worked" | Orphaned process/scheduled task/firewall rule check: not recorded. |
| Reinstall (procedure step 10) | "Worked" | Re-initialization check: not recorded. |
| Upgrade scenario (procedure step 8) | Not addressed | No prior installed version exists to upgrade from (consistent with the promotion decision's existing "NO VERIFIED PRIOR CANDIDATE AVAILABLE" status) — this scenario was not exercised and is not claimed to have been. |
| Blocking defects | None reported | — |

No screenshots, Event Viewer excerpts, or `Get-CimInstance Win32_Process` captures were provided, though
the plan calls for them. No screenshots were taken or exist for this run.

## 4. Gap against the original plan

The plan's "Logs and evidence to collect" section calls for installer stdout/exit code or install-wizard
screenshots, first-launch and subsequent-launch screenshots, Event Viewer entries, and before/after
process lists. None of that evidence exists for this run. Only the identity gate and the environment
setup meet that evidentiary bar; the functional steps rest entirely on the operator's unelaborated summary.

This gap is treated as a promotion blocker in its own right (see `B1_1_PROMOTION_DECISION.md`, updated),
not as a soft caveat, because the plan's own pass/fail criteria assume evidence-backed steps and this run
did not produce that evidence for the functional portion.

## 5. Conclusion for this report

- Candidate identity inside the clean VM: **VERIFIED**, exact match, both pre- and post-transfer.
- Clean-machine environment integrity (no prior exposure, no dev tooling, correct snapshot discipline):
  **VERIFIED**.
- Install / launch / functional / uninstall / reinstall behavior in the clean VM: **USER-REPORTED PASS**,
  not independently verified, thin (no commands, timestamps, launch counts, or logs provided despite two
  requests).
- This report does not, by itself, satisfy the plan's Pass/Fail criteria in full, and does not constitute
  release readiness. See `B1_1_PROMOTION_DECISION.md` and `Docs/Release/RELEASE_READINESS_DECISION.md`
  for the aggregate disposition.
