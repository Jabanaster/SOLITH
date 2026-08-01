# Failed Gate 2.5 DevTools Probe — Non-Certifying

## Provenance

- Observed result timestamp: 2026-07-29 22:45:23 America/Los_Angeles
- Branch: `integration/b1-1-closeout`
- HEAD: `a63e9f57bc608e70212da1b09fb578f40eab889a`
- Producing harness: `tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts`, Phase 6
- Exact command: not recoverable from the remaining local artifacts
- Node version: not recoverable for this specific run
- Electron version: repository dependency declares Electron 42.4.1; the exact executable used by this run is not recoverable

## Result

DevTools was requested, but the harness could not obtain `devToolsWebContents`.
Consequently, `window.electronAPI` was not evaluated and the recorded
`hadElectronAPI: null` value is not evidence that the bridge was absent.

This run does not certify the DevTools boundary. It also does not invalidate
the earlier committed passing result by itself. The committed passing result
and its matrices remain unchanged.

Root cause remains unresolved. A matching Phase 6 Playwright failure report
was not recoverable from the remaining `playwright-report/` or `test-results/`
artifacts. The available reports describe other fixture and child-frame
failures and must not be attributed to this probe.

Do not classify this as a security failure unless the result is reproduced
under the preserved passing environment and the privileged boundary is shown
to be exposed.
