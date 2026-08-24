# SOLITH — Non-Frozen V1 Cleanup Closeout

Date: 2026-08-24
Branch: `review/gate2-5-doc-audit`
Starting SHA: `b19a093989de647790c7e43675f69975482733f1`

This closes the bounded pre-release cleanup pass authorized against the
starting SHA above: close every remaining non-frozen code/test/packaging
residual while leaving production credential/Store-identity items frozen
for the owner/final-release stage, per the frozen-item list in that
authorization (production Windows/Store signing identity, production
Ed25519 catalog identity, Partner Center Store identity, final RC/Store
submission/manual acceptance).

## Residual 1 — XML structural depth accounting

**Old implementation:** [src/core/adapters/xml.ts](../../src/core/adapters/xml.ts)'s
`validateXmlSafety` counted nesting depth with a single regex sweep
(`/<(\/?[a-zA-Z_][a-zA-Z0-9_\-\.:]*)(?:\s+[^>]*)*>/g`) that could not
distinguish real structural tags from tag-shaped text inside comments,
CDATA sections, or quoted attribute values, and could terminate a tag scan
early on an unquoted `>` inside an attribute.

**New implementation:** a bounded single-pass tokenizer
(`scanXmlStructuralDepth`) that walks the document once, explicitly
skipping comment (`<!-- -->`), CDATA (`<![CDATA[ ]]>`), processing
instruction (`<? ?>`), and other markup-declaration (`<! ... >`) spans, and
tracks quoted attribute values so an in-quote `>` never terminates a tag
early. Depth increments only on genuine open tags, decrements on close
tags, and self-closing tags are neutral. Still O(n), no backtracking, still
exits as soon as the depth cap is exceeded (does not require a full DOM
parse of a hostile document before rejecting it).

- Size cap: unchanged, 5 MB.
- DOCTYPE rejection: unchanged, rejected outright before depth scanning
  runs.
- Max depth: unchanged, 256.
- New tests: [tests/xml-structural-depth.test.ts](../../tests/xml-structural-depth.test.ts)
  (12 tests) — comments/CDATA/quoted-`>`/self-closing/PI acceptance,
  namespaced elements, true-depth rejection, malformed-unbalanced rejection,
  and an explicit "old regex-fooling shape no longer influences the count"
  regression case. Wired into `npm test`.
- Result: 12/12 new, all pre-existing XML/`.CT`/save-XML suites unaffected.

## Residual 2 — Startup visibility / Game Bar environment assumption

**Original failure:** [tests/startup-visibility-behavior.e2e.test.ts](../../tests/startup-visibility-behavior.e2e.test.ts)
hardcoded the assumption that Xbox Game Bar transport startup always fails
in the test environment (`expect(capture.marks).toContain('gamebar-transport-failed')`),
which is a machine-specific outcome, not a product contract — on any
machine where the transport actually succeeds, the suite failed for a
reason unrelated to product correctness.

**Root cause:** the assertion encoded "must fail" instead of "must settle
to exactly one of the two contractually valid outcomes."

**Product change:** none — `electron/main.ts`'s `gamebar-transport-start` /
`-done` / `-failed` try/catch handling was already correct and unchanged.

**Test change:** the assertion now checks
`doneCount + failedCount === 1` (exactly one outcome mark, whichever it is)
and still asserts no unhandled rejection reached the process.

**Navigation/context race:** a separate, real flake — `evaluateWithRetry`'s
single fixed 250 ms retry against
`"Execution context was destroyed, most likely because of a navigation"`
was insufficient under one observed run (two consecutive context
destructions). Replaced with a bounded (5-attempt, 150 ms×attempt backoff)
retry loop against the same specific error signature — this is
test-harness-only; no product code changed. There is no observable
CDP/Electron event for "the new execution context is stable" to poll
instead, so retrying the evaluate call itself remains the correct
mechanism, just bounded and less brittle than one fixed sleep.

- Tests: 10/10 (two consecutive full runs, both clean).
- Result: closed.

## Residual 3 — Gate 2.5 timing hardening

[tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts](../../tests/gate2-5-frame-devtools-overlay-lifecycle.e2e.test.ts)
had four fixed-duration sleeps standing in for observable state:

- `sleep(1500)` after `openDevTools()`, before checking for
  `devToolsWebContents` (Phase 6).
- `sleep(700)` after `wispOverlayToggle()`, before searching
  `ctx.app.windows()` for the new overlay window (Phase 7, twice, and the
  Phase 3 addendum).
- `sleep(500)` after destroying the overlay `BrowserWindow`, before
  recreating it (Phase 7).

All four are replaced with a bounded `waitForCondition` poll (50–100 ms
interval, 5–10 s timeout) against the actual predicate each sleep was
standing in for: `devToolsWebContents` present, a new window present in
`ctx.app.windows()`, or the destroyed webContents id gone from
`getAllWebContents()`. No security assertion was loosened — every existing
`expect(...)` after each wait is unchanged; only the wait mechanism
changed from "assume it's done by N ms" to "confirm it's done, up to a
bound." Harness-only change; no product code touched.

- Isolated run 1: 7/7 pass (2.5 min).
- Isolated run 2: 7/7 pass (1.2 min).
- Full-battery run (all 20 e2e suites, 1 worker, sequential): 7/7 pass within
  the 151/151 full-battery total — see Full Regression below.

## Residual 4 — Install-path validation at storage time

**Verified already closed** by prior work on this SHA, not by this pass —
`electron/main.ts`'s `add-game` and `update-game` IPC handlers already call
`validatePathSafety(parsed.executablePath, [parsed.path])`, binding
`executablePath` containment to the owner-approved `path` root at
persistence time (in addition to the pre-existing launch-time check in
`electron/canonical-games-ipc.ts`). Covered by
[tests/launch-installation-containment.test.ts](../../tests/launch-installation-containment.test.ts)
(10/10: contained/nested-subdirectory acceptance; outside-root, sibling-prefix,
traversal, and symlink-escape rejection; Windows-system-directory and
Solith-own-install-dir rejection regardless of approved root; manual
add-game containment). Re-run this pass to confirm currency: 10/10 pass.
No code change was needed or made.

Install-discovery-sourced paths (Steam/Epic/GOG scan results,
`src/core/install-discovery/*.ts`, `src/core/canonical-games/store.ts`) are
main-process-owned, OS-registry-derived data, not renderer-controlled
input, and establish the install root rather than being checked against a
pre-existing one — consistent with the existing trust boundary documented
in the containment test file's own header comment.

## Microsoft Store / MSIX readiness

- electron-builder version: `^26.15.3` (already a devDependency; native
  `appx` target support confirmed present in
  `node_modules/app-builder-lib/out/targets/AppxTarget.js` /
  `AppXOptions.d.ts`).
- NSIS preserved: package.json's `build.win.target` is unchanged
  (`["nsis"]`); nothing about the default `npm run build` path changed.
- MSIX target added as a **separate, parallel** electron-builder config:
  [electron-builder.msix.config.cjs](../../electron-builder.msix.config.cjs),
  invoked only via the new `npm run build:msix` script
  (`electron-builder --win appx --config electron-builder.msix.config.cjs`).
  It merges the base `package.json` `build` block and overrides only
  `win.target` (→ `["appx"]`) and adds the `appx` block.
- Store identity hard-coded: **NO.** `identityName` / `publisher` /
  `publisherDisplayName` are read exclusively from
  `SOLITH_MSIX_IDENTITY_NAME` / `SOLITH_MSIX_PUBLISHER` /
  `SOLITH_MSIX_PUBLISHER_DISPLAY_NAME` at build time. Two independent
  fail-closed checks exist: [scripts/check-msix-identity-env.mjs](../../scripts/check-msix-identity-env.mjs)
  (runs first in `build:msix`, clear per-variable error message) and a
  throw inside `electron-builder.msix.config.cjs` itself (defense-in-depth
  for anyone invoking `electron-builder` directly against that config file).
  Verified: with no env vars set, both paths report
  `BLOCKED — STORE IDENTITY REQUIRED` and exit non-zero; with all three set
  (verified with throwaway local-only test values, never committed), the
  config resolves correctly and `win.target` becomes `["appx"]` with NSIS
  untouched.
- Required owner values: `SOLITH_MSIX_IDENTITY_NAME`,
  `SOLITH_MSIX_PUBLISHER`, `SOLITH_MSIX_PUBLISHER_DISPLAY_NAME` (from
  Microsoft Partner Center once the Store listing exists). Optional:
  `SOLITH_MSIX_APPLICATION_ID` (defaults to `identityName` if omitted, per
  electron-builder's own AppX default).
- Package assets: [scripts/generate-msix-assets.mjs](../../scripts/generate-msix-assets.mjs)
  derives the four Store tile PNGs electron-builder's `appx` target expects
  (`StoreLogo.png` 50×50, `Square44x44Logo.png`, `Square150x150Logo.png`,
  `Wide310x150Logo.png` 310×150) from the existing `public/solith-icon.png`
  via `sharp` (already a devDependency), padded onto each tile's canvas
  against the same `#464646` background AppXOptions itself defaults to. It
  is additive/non-destructive — it only writes a tile file that does not
  already exist, so dropping in real dedicated Store artwork later is a
  drop-in replacement, not a script change. Verified: generates all four
  files into `build/appx/` (gitignored, same as `build/` and `dist/`
  generally).
- Local MSIX build: not attempted — building an actual `.appx` requires
  real Partner Center identity values, which are explicitly frozen/owner-only;
  attempting one with placeholder values would produce an artifact that
  cannot be Store-submitted and risks being mistaken for something it isn't.
  The config-resolution and asset-generation halves of the pipeline were
  verified independently instead (above).
- WACK: `BLOCKED — STORE IDENTITY REQUIRED` (no `.appx`/`.msix` exists to
  certify without the frozen identity values). [scripts/run-wack.mjs](../../scripts/run-wack.mjs)
  (`npm run wack:msix`) locates the real `appcert.exe` (found on this
  machine at `C:\Program Files (x86)\Windows Kits\10\App Certification
  Kit\appcert.exe`) and the built package in `dist/`, and refuses to claim
  a result when either is missing rather than fabricating a PASS.
- Store compatibility risk audit: SOLITH's core live-memory capabilities
  (external process enumeration/attach, memory read/write via the
  `memoryjs` native module, native helper process launch —
  `solith-readonly-scanner.exe`, `host-entry.js`) all require full-trust
  desktop execution. The `appx` config declares `capabilities: ['runFullTrust']`
  (electron-builder also auto-adds this for any Electron app regardless).
  MSIX/AppX full-trust packaging (the same mechanism Win32 desktop-bridge
  Store apps use) does not sandbox these the way a UWP/restricted-capability
  package would, so no SOLITH security boundary needs to change for Store
  packaging specifically — but this has not been proven against a real
  signed, installed-from-Store package (only against the config/build
  layer), because no Store submission exists yet. Flagged as the one
  compatibility question that can only be closed once a real Store
  installation is testable, which is itself gated on the frozen identity
  items.
- **Result: `MSIX PARTIALLY READY`** — parallel target, asset pipeline, and
  fail-closed identity gating are all in place and verified; the actual
  `.appx` build, WACK run, and full-trust-under-Store-package behavior
  verification are correctly blocked on the frozen Partner Center identity,
  not on anything remaining in this codebase.

## Release-Gate Integrity

- Direct-release unsigned artifact: still blocked (no change to
  `scripts/verify-release-artifacts.mjs` or `scripts/signing-verification.mjs`
  — neither was touched this pass).
- Placeholder catalog trust root: still blocks direct release (unchanged).
- Store path separation: the MSIX/appx pipeline is fully separate
  electron-builder config/tooling from the NSIS/direct-download release
  verifier; the verifier does not inspect `.appx`/`.msix` artifacts at all,
  so it cannot (and does not) demand production Authenticode signing for a
  Store-signed package before Microsoft signs it. This was true by
  architecture before this pass and required no verifier change — adding
  one would have been solving a conflict that does not exist.
- Signing gate weakened: NO.
- Trust-root gate weakened: NO.

## Test Hygiene

- Searched all test files for `.only(` / `describe.only(` / `xtest(` /
  `xdescribe(`: none found.
- `test.skip(...)` occurrences: all are documented, conditional guards
  (missing packaged bundle, `process.platform !== 'win32'`, a prior gate's
  precondition not met) — no orphaned or silently-disabled required
  security/V1 suite.
- No test assertions were removed or weakened to make a suite pass; the
  Game Bar fix widened the accepted-outcome set to match the actual product
  contract (both outcomes were always valid product behavior — the old
  assertion was simply wrong, not weakened).

## Narrow Test Results

| Area                      | Passed | Failed | Status |
| -------------------------- | -----: | -----: | ------ |
| XML structural depth       |     12 |      0 | PASS   |
| Save XML safety gate       |      7 |      0 | PASS   |
| `.CT` import security      | (in full regression) | 0 | PASS |
| Startup visibility (e2e)   |     10 |      0 | PASS   |
| Gate 2.5 (isolated ×2)     |    7+7 |      0 | PASS   |
| Install-path containment   |     10 |      0 | PASS (pre-existing, reconfirmed) |
| MSIX/package config        | manual verification (env-gate + config resolution) | — | PASS |

## Full Regression

| Suite               | Passed | Failed | Skipped | Status |
| -------------------- | -----: | -----: | ------: | ------ |
| TypeScript root       | clean (0 diagnostics) | — | — | PASS |
| TypeScript Electron   | clean (0 diagnostics) | — | — | PASS |
| Unit/integration      | 1699 | 0 | 0 | PASS (baseline 1687 + 12 new XML tests) |
| SQL                   | 10 | 0 | 0 | PASS |
| Live memory            | 278 | 0 | 0 | PASS |
| npm audit (production) | 0 vulnerabilities | — | — | PASS |
| Playwright/E2E (full battery, 20 suites, 1 worker) | 151 | 0 | 0 | PASS |
| Packaged smoke (fresh build) | 23 | 0 | 0 | PASS (matches baseline exactly) |

The consent-boundary suite showed 2 failures on its first run because it
was launched concurrently with the fresh packaged build against the same
`dist-electron/main.js` (a self-inflicted collision, not a regression) — a
clean standalone re-run afterward was 9/9, and the full-battery run above
(run after the build finished) also shows it clean.

Fresh packaged build (NSIS, from this SHA's tree, not committed as a final
RC): `npm run build` completed exit 0, 29/29 output-verification checks
passed. Artifact hashes (evidence only, not release artifacts):

- `dist/Solith Setup 2.4.0-alpha.2.exe`:
  `sha256:6a1825726b5ec47d84734a762dd882a6ee4780a0c71e7e82afd2315fd6ad4749`
- `dist/win-unpacked/Solith.exe`:
  `sha256:bf1825132b76634430b9de5dffa594b70da73b2b4adad2038afce291e93313b4`

## Frozen Items — Confirmed Still Open (intentional)

- Production Windows/Store signing identity: `FROZEN — OWNER/STORE STEP`
- Production Ed25519 catalog identity: `FROZEN — OWNER STEP`
- Partner Center Store identity: `FROZEN — OWNER/STORE STEP`
- Final Store submission/signing: `FROZEN — FINAL RELEASE STEP`
- Final installer/MSIX lifecycle: `FROZEN — FINAL RELEASE STEP`
- Final manual V1 acceptance: `FROZEN — FINAL RELEASE STEP`

None of the above were touched, invented, or worked around this pass.
