# Gate 2.5 Remaining Risks

- Gate 2.4 aggregate functional status remains REPORTED COMPLETE — VERIFY; Gate 2.5 independently reproduced its key claims but does not rewrite historical status into a mixed VERIFIED label.
- Gate 2.4 scope integrity remains conditionally reconciled. The deleted pre-existing untracked 	est_output.txt cannot be recovered; direct evidence shows no functional or security impact.
- Electron TypeScript remains at the explicitly excluded baseline: 31 diagnostics across 13 files.
- git diff --check remains at the explicitly excluded GameLibrary.tsx lines 286 and 303.
- Natural operating-system PID reuse and architectures other than the tested Windows x64 / Electron ABI 146 environment were not newly certified in Gate 2.5.
- No raw DevTools IPC call was possible in the genuine DevTools context because it has no preload bridge or Node access. This is the strongest live boundary and is classified complete for the supported packaged architecture.
- The repository retains substantial unrelated modified and untracked work captured in baseline-file-manifest.csv. Gate 2.5 neither certifies nor closes that work.

No unresolved exploitable Gate 2.5 defect remains after the freeze-stop/status sender guards and complete packaged rerun.

## Addendum (this session, Claude Sonnet)

The risks above were recorded by a prior, different agent session (Codex,
committed as 317baf0 before this session began). This session independently
reconfirmed the freeze-stop/status fix, the child-frame/stale-frame/DevTools/
overlay-recreation boundaries, and the SOLITH_TEST_BUILD guard against a
freshly rebuilt packaged candidate (all pass, 6/6 new tests, rerun twice) and
found no additional Gate 2.5 defect. One new, narrower disclosure from this
session:

- **R-2.5-001 (new, disclosed):** `toggleWispOverlay()` only hides an
  existing overlay (`hideWispOverlay()` → `.hide()`), it does not destroy the
  webContents. `destroyWispOverlay()` (the real `.destroy()` path) is only
  ever invoked from `electron/main.ts`'s `'will-quit'` handler. There is
  therefore no renderer-reachable path to a live in-session overlay
  destroy+recreate cycle — this session's Phase 7 test had the harness call
  `BrowserWindow.destroy()` directly on its own harness-launched overlay
  instance to construct the cycle, which is consistent with this gate's
  explicit authorization to destroy/recreate harness-launched windows and
  overlays, but is disclosed here so the distinction between "renderer-
  reachable" and "harness-forced" is not lost. This does not change the
  verdict — the window-type/registration mechanism exercised after the
  forced destroy is entirely real production code.

All other items in the list above (Gate 2.4 aggregate status wording,
Electron TypeScript baseline, GameLibrary.tsx whitespace, natural PID reuse,
unrelated repository work) remain accurate and unchanged from this session's
own review.

## Evidence correction (owner-authorized, candidate 502300b4498828b40dcbb5be320c2f8d48603089)

Prior Electron TypeScript result of 31 diagnostics did not reproduce under
the repository-pinned Node 22.23.1 runtime with a clean npm ci. Independent
reruns in both the isolated cleanup worktree
(`G:\ACTIVE_PROJECTS\solith-electron-ts-cleanup`, branch
`chore/electron-ts-baseline-cleanup`) and the frozen integration worktree
(`G:\ACTIVE_PROJECTS\solith-b11-integration`, branch
`integration/b1-1-closeout`) produced 0 diagnostics. The earlier result is
classified as environment contamination, not an accepted unresolved
baseline.

This does not erase the original 31-diagnostic observation recorded above
(line 5 of this file, and `tests-summary.csv` rows 10 and 23) — that
observation stands as a historical record of what a prior session reported
under a contaminated environment. Main TypeScript also independently
reconfirmed at 0 diagnostics. Full test/build battery (npm test, live-memory,
Vite build, Electron build, Electron output verifier) passed in the
re-verification. No source change was required and no cleanup commit exists,
because there was no code defect to fix.
