# Node22Gate Dirty-Tree Reconciliation Findings

## Recorded transition

All 23 scoped paths changed index state during Node22Gate capture:

- 13 tracked paths changed from unstaged modified (` M`) to staged modified (`M `).
- 6 tracked paths changed from unstaged modified (` M`) to staged and unstaged modified (`MM`).
- 4 untracked paths changed from untracked (`??`) to staged added (`A `).

This is direct evidence of a Git staging operation. It is not a line-ending-only,
file-mode-only, generated-artifact, or Node22Gate evidence-only transition.

The exact actor is not proven. Relevant Codex, Git, Node, Electron, and shell
processes were present, but process presence does not establish causation.
The configured `pretest`, `test`, and `test:live-memory` scripts contain no
staging command, and a bounded search found no `git add`, `update-index`, or
equivalent index-writing command in project scripts, tests, Electron, or source.

## Current state

The index is now empty again for all 23 paths. Seventeen paths are currently
clean or absent, while six remain unstaged modified. This is additional
repository activity after the recorded Node22Gate after-snapshot. No file was
reverted or restored by this reconciliation.

Line-ending warnings exist on the six currently modified paths, but line endings
cannot explain transitions into `M `, `MM`, and `A `. `git diff --summary` shows
no scoped file-mode transition.

## B1.1 impact

`src/app/pages/RegistryExplorerPage.tsx` is B1.1-impacting. Its current diff
contains the main-owned `registrySelectProcess` / `selectionId` flow that
replaces direct renderer PID authority. It transitioned from ` M` to `MM`
during the passing verification. Because no before/after blob hash or cached
diff was captured and the index has since changed, the exact test-time content
cannot be reconstructed from the retained evidence.

The remaining 22 paths do not directly implement or test the scoped B1.1
lifecycle, consent, trusted-sender, process-selection, PID-identity, rollback,
or cleanup controls.

## Reproducibility

The functional test results remain valid results from the source present at
execution time, and no regression is proven. However, the exact source snapshot
used by those tests is not reproducible from retained evidence. A stable-tree
Node22Gate evidence rerun is required before Gate 2.

## Classification

- Staging-state change: 23
- B1.1-impacting path: 1
- Unrelated paths: 22
- Exact actor: uncertain for all 23
- Exact test-time blob for the six `MM` paths: uncertain

## Reconciliation integrity

The final status comparison found four additional non-evidence changes during this reconciliation: `tests/companion-wisp.test.ts`, `src/core/ct-library/preview-receipt.ts`, `tests/ct-preview-receipt.test.ts`, and `tests/wisp-preferences.test.ts`. They are outside the scoped 23 paths and were not inspected or classified. This independently satisfies the FAIL rule for additional unexplained changes during reconciliation.
