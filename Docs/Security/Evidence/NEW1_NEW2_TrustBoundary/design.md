# NEW-1 / NEW-2 Electron Trust-Boundary Closure

Branch: `security/new-1-new-2-trust-boundary`
Base: `integration/b1-1-closeout` @ `a63e9f57bc608e70212da1b09fb578f40eab889a`
Worktree: `G:\ACTIVE_PROJECTS\solith-new1-new2` (dedicated, created fresh off base; verified clean, HEAD exactly matched base, no Wisp diff, before any edit)

## Findings

**NEW-1** — The destructive live-memory write path and the injector-launch path used liveness-only sender checks (`event.sender.isDestroyed()` via `requireBundle`/`requireSession`) instead of the full trusted-sender registry (`requireTrustedSender`/`validateIpcSender`) already used by the freeze/rollback path. A native OS consent dialog plus process-identity binding (start time, volume serial, file index, SHA-256) is a real compensating control but does not establish sender identity, main-frame status, or window type.

**NEW-2** — None of the three privileged `BrowserWindow`s (main, Wisp overlay, trainer overlay) had `will-navigate` or `setWindowOpenHandler` guards. A navigated-away window could keep issuing privileged IPC for any handler that doesn't independently check frame URL — compounding NEW-1.

## Root cause

`electron/live-memory-ipc.ts` grew its destructive-write and injector-launch handlers using `requireBundle(event)`/`requireSession(event)` — an ownership-by-`webContents.id` map lookup plus `isDestroyed()` — the same pattern used for low-risk read-only channels in the same file. Only the freeze/rollback cluster was hardened to `requireTrustedSender(event)` in a prior batch (B1.1), and that hardening was never extended to the equally-destructive write-confirm and injector-launch handlers, nor to `trainer-host-approve-and-write` in `electron/main.ts` (a structurally identical destructive-write-with-ownership-map pattern for a separate subsystem). Navigation/popup guards were never added to any window because Electron does not require them for basic functionality — they are a defense-in-depth control, not something a broken feature would surface.

## Handler inventory (final trust controls)

| Channel | File | Trust check added | Preserved unchanged |
|---|---|---|---|
| `live-memory-issue-write-consent` | electron/live-memory-ipc.ts | `requireTrustedSender(event)` → `validateIpcSender(event, ['main'])` | native consent dialog, process-identity check, bundle ownership |
| `live-memory-confirm-write` | electron/live-memory-ipc.ts | same | consent-token consumption, process-identity re-check, bundle ownership |
| `in-process-propose-injector-launch` | electron/live-memory-ipc.ts | same | Authenticode/path checks in injector-launcher.ts, process-identity check, session ownership |
| `in-process-issue-injector-consent` | electron/live-memory-ipc.ts | same | native consent dialog, process-identity check, session ownership |
| `in-process-register-injector-helper` | electron/live-memory-ipc.ts | same (previously had **zero** sender check of any kind) | SHA-256/publisher/path checks, native approval dialog |
| `in-process-confirm-injector-launch` | electron/live-memory-ipc.ts | same | consent-token consumption, live-identity re-verify, session ownership |
| `trainer-host-approve-and-write` | electron/main.ts | new local `requireTrustedSender(event)` wrapping `validateIpcSender(event, ['main'])` (mirrors the live-memory-ipc.ts helper — file boundary made sharing the exact same function impractical without a cross-file refactor out of scope for this patch) | TrainerHost ownership-by-webContents.id, supervisor state |
| `in-process-confirm-hook` | electron/live-memory-ipc.ts | `requireTrustedSender(event)` (added in the second corrective pass, closing an independent-review finding) | in-process feature gate, online-guard recheck, session ownership — this handler writes shellcode plus a jump patch directly into a live process via `installHookFromProposal` |
| `in-process-rollback-hook` | electron/live-memory-ipc.ts | same | in-process feature gate, session ownership |
| `trainer-host-rollback` | electron/main.ts | same local `requireTrustedSender(event)` used by `trainer-host-approve-and-write` | TrainerHost ownership-by-webContents.id, supervisor state |

Every check calls the existing `validateIpcSender()` (electron/sender-validation.ts) → `validateTrustedSender()` (src/core/security/trusted-sender-registry.ts) — the same registry and function already used by the freeze/rollback path. No new or parallel trust mechanism was created. All 10 hardened channels now share this exact mechanism.

## Window inventory (final navigation/popup policy)

| Window | File | Guard added | Allowed origins |
|---|---|---|---|
| main | electron/main.ts (`createWindow`) | `applyWindowNavigationPolicy` right after `registerTrustedSolithWindow`, same `allowedUrlPrefixes` array | dev builds: `http://localhost:3000` only. Packaged builds: `file://.../dist/index.html` only — never both (fixed in corrective pass; see remaining-risks.md item 1) |
| Wisp overlay | electron/wisp-overlay.ts (`showWispOverlay`) | same | same, gated the same way |
| trainer overlay | electron/trainer-overlay.ts (`showTrainerOverlay`) | same | same, gated the same way |

`applyWindowNavigationPolicy` (new, electron/sender-validation.ts) denies same-window navigation to any URL not matching `allowedUrlPrefixes` (reusing the exported `isApprovedUrl()` from trusted-sender-registry.ts — the identical origin/path matcher IPC trust already uses, so the two policies cannot drift apart) and denies every `window.open()`/`target="_blank"` popup as an in-app `BrowserWindow`. A strictly `https:` popup is instead handed to the OS's default browser via `shell.openExternal` (dynamically imported, so the module stays unit-testable outside a real Electron process) — added in the corrective pass after the independent reviewer found this was needed to preserve a real, pre-existing external link in the UI (see remaining-risks.md item 2). Every other scheme is denied with no handoff.

## Wisp ownership boundary

Only `electron/wisp-overlay.ts` was touched, and only its window-creation call site (added `applyWindowNavigationPolicy` + hoisted the allowed-URL array to a local const, identical in shape to the main/trainer-overlay changes). `src/core/companion/wisp.ts`, `tests/companion-wisp.test.ts`, and all Wisp reducer/state/visual/lifecycle behavior are untouched — confirmed by `git diff` against base showing zero changes to those paths (see verification-final.txt).

## Mismatches vs. the original audit framing (carried over from Phase 2 inventory, still accurate)

1. The gap was broader than "one write handler + one injector handler": two write-consent handlers and four injector handlers, plus `trainer-host-approve-and-write` (same gap class, different subsystem, not named in the audit brief).
2. `in-process-register-injector-helper` had **no** sender check at all (not even `isDestroyed()`) — worse than the audit's "liveness-only" framing.
3. `SOLITH_SECURITY_ROADMAP.md` already listed "Privileged IPC hardening beyond B1.1" as `PENDING` prior to this patch — this was a known, tracked gap.
