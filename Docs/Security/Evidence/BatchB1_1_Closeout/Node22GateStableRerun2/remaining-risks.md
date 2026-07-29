# Remaining Risks — Node22GateStableRerun2

## Resolution of the prior environment blocker

The prior Node22GateStableRerun attempt stopped because the active shell's
system-wide Node (`C:\Program Files\nodejs\node.exe`, v24.15.0) does not
satisfy the repository's `.nvmrc`/`engines` pin (`>=22 <23`). This task
located the exact runtime used by the original passing Gate 1 evidence:
a project-local, unzipped Node distribution at
`G:\ACTIVE_PROJECTS\SOLITH\.tools\node-v22.23.1-win-x64\node.exe`
(gitignored via `.tools/`, not repository source). It was verified by
Windows file-version metadata (ProductName=Node.js, FileVersion=22.23.1)
and by direct invocation (`node --version` -> v22.23.1). Child-process
inheritance was proven using the project's own built-in guard,
`scripts/check-node.mjs` (the `pretest` hook): under a PATH scoped only to
that single command, the guard passes silently; under the unmodified
system PATH, it fails loudly with "Unsupported Node.js v24.15.0" — a clean
positive/negative control pair.

## What this run establishes

- npm test: 1,034/1,034 PASS under the recovered Node 22.23.1 runtime.
- npm run test:live-memory: 221/221 PASS.
- Main TypeScript: PASS, 0 diagnostics.
- Electron TypeScript: FAIL, 31 diagnostics / 13 files — line-for-line
  identical to the previously recorded unrelated baseline (zero diff).
- git diff --check: FAIL, GameLibrary.tsx lines 286/303 trailing whitespace
  — identical to the previously recorded unrelated baseline.
- Pretest and post-verification source state are stable for every B1.1
  production and test path (23 paths checked, 0 changed).
- No non-evidence file was staged, unstaged, or otherwise touched.

## Residual, unresolved from earlier evidence

- The exact test-time source blob for the six previously-identified `MM`
  paths from the original Node22Gate/Reconciliation cycle (App.tsx,
  RegistryExplorerPage.tsx, TrainerLibraryPage.module.css,
  TrainerLibraryPage.tsx, GameLibrary.tsx, index.css) remains
  unreconstructible from that earlier incident. This run's clean pretest/
  final hash match for RegistryExplorerPage.tsx establishes that *this*
  execution did not disturb it, but does not retroactively repair the
  earlier evidence gap.
- The unrelated Electron TypeScript baseline and the unrelated
  GameLibrary.tsx whitespace failure remain present and undocumented for
  repair (out of scope for this task by explicit instruction).
- The project-local `.tools/node-v22.23.1-win-x64` runtime is not on PATH
  by default in a fresh shell. Any future Node22Gate rerun on a new shell
  session will need to repeat this same discovery-and-direct-invocation
  procedure (or the developer should arrange PATH/nvm-equivalent tooling)
  rather than assuming a bare `npm test` will pick the right runtime.

## Verdict

NODE22GATE STABLE RERUN PASS.

Gate 2 remains not authorized to resume by explicit task scope, independent
of this passing result.
