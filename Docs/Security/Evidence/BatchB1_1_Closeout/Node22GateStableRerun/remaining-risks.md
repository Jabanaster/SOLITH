# Remaining Risks — Node22GateStableRerun

## Primary finding

The task could not complete the Node 22 verification rerun because the
active Node toolchain on this machine is v24.15.0, not the v22.x pinned
by `.nvmrc` and `package.json` engines (`>=22 <23`), and not the v22.23.1
recorded in the prior Node22Gate evidence. No alternate Node 22 install
(nvm, volta, fnm, or a second binary) exists on this system. This is an
environment change outside repository scope, not a repository or
B1.1 defect.

## What this run does establish

- The repository source state was fully stable for a monitored,
  120-second observation window immediately preceding this report:
  zero hash changes, zero status changes, across all 1,051 tracked +
  untracked files. This directly refutes nothing about the prior
  Node22Gate reconciliation findings (that instability was observed at
  a different point in time, under different concurrent conditions),
  but it does establish that the repository is *currently* capable of
  holding a stable state for the required window.
- Heavy concurrent process activity exists on this machine (33 node.exe
  processes, 5 electron.exe processes including a running "Solith" app
  window, multiple shells). See `concurrent-process-observation.txt`.
  None of this activity produced a monitored-file change during the
  120-second window that was actually observed, but it corroborates the
  earlier reconciliation's concern that this machine runs substantial
  background process load capable of touching the repository.

## What remains unresolved from the prior Node22Gate / Reconciliation evidence

- The exact test-time source blob for the six previously-identified `MM`
  paths (including `src/app/pages/RegistryExplorerPage.tsx`) is still not
  reconstructible from any retained evidence; this rerun does not and
  cannot retroactively repair that gap.
- The unrelated Electron TypeScript baseline (31 diagnostics / 13 files)
  and the unrelated `GameLibrary.tsx` whitespace `git diff --check`
  failure remain undocumented by a fresh Node 22 run this cycle, because
  no verification commands were executed under this task.

## Required next step

Before any further Node22Gate rerun can produce trustworthy functional
evidence, a Node 22.x runtime must be made available on this machine
(the repository's own `.nvmrc`/`engines` already specify this
requirement — it is not a new constraint introduced by this task).
Once Node 22.x is confirmed active, this same stabilize-and-rerun
procedure can be repeated from Phase 6 forward without needing to
repeat Phases 1-5, provided a fresh stability window is captured
immediately beforehand (the one captured in this run will have aged).

Gate 2 remains not authorized to resume.
