# Solith - Local AI Game Trainer & Save Editor

Solith is a local-first, single-player trainer-style desktop application. It helps you manage local game installations, scan for saves and configurations, compare save states, and safely apply file-backed resource modifications.

Current development baseline: `solith@2.4.0-alpha.2`. Authoritative version is `package.json` (enforced by `tests/version-consistency.test.ts`). Do not treat historical `v2.4.0-rc.*` tags as the live product version.

## Project direction and status

- [`MASTER_ROADMAP.md`](MASTER_ROADMAP.md) is the authoritative portfolio roadmap. It reconciles product history, security, Adaptive Wisp, and the SOL-0 through SOL-8 governed machine-authority program.
- [`ROADMAP.md`](ROADMAP.md) retains detailed product-phase requirements and evidence links.
- [`SOLITH_SECURITY_ROADMAP.md`](SOLITH_SECURITY_ROADMAP.md) remains the sole authority for security-gate verdicts and release-security status.
- [`PROJECT_SPEC.md`](PROJECT_SPEC.md) controls product requirements and the Safety Firewall.

The governing workflow is **AUDIT → RECONCILE → IMPLEMENT → VERIFY → CERTIFY → DOCUMENT → INTEGRATE**. `CERTIFIED` requires reproducible build, test, and/or runtime evidence for the exact claimed scope. External repositories are references, not wholesale imports. Proven capability is preserved or extended instead of rebuilt. Existing owner-autonomous behavior remains available where already authorized; deletion remains approval- and explanation-protected.

Current portfolio summary: historical product Phases 2–6 remain verified for their documented scopes; Phase 1 still has required manual acceptance gaps; release/security completion is not granted; Adaptive Wisp Phases 1–2 have evidence-backed branch-scope passes but the full Wisp workstream and later W3–W12 capabilities are not certified; SOL-0 through SOL-8 are forward work and are not certified unless the master roadmap explicitly says otherwise.

"**Offline-only**" here means **offline gameplay enforcement** for live-memory targeting (fail-closed online-session guard) — not that the application never uses the network. Opt-in hub sync / community listing metadata may exist; they must not enable online/multiplayer game targeting.

Solith is strictly designed for single-player, offline games or applications that you own or have permission to modify.

---

## Multi-Game Live Trainer & Cheat Hub

Solith includes a **discovery-first live trainer** for curated titles plus a **save-field editor** for Stardew Valley. Memory cheats are **not** shipped as verified pointer packs. Bundled live features are typically **L0 `scan_unknown`**: you must discover (scan → narrow → confirm) addresses each session; addresses are session-local unless separately restart-verified (L3+), which is not claimed here.

| Game | Cheat defs (approx.) | Backend | Certification / honesty |
|------|----------------------|---------|-------------------------|
| **Palworld** | 26 | Live memory | **L0** — requires Discovery (`scan_unknown`); not a verified pointer pack |
| **Undisputed** | 11 | Live memory | **L0** — requires Discovery (`scan_unknown`); not a verified pointer pack |
| **Atomfall** | 10 | Live memory | **L0** — requires Discovery (`scan_unknown`); not a verified pointer pack |
| **Avowed** | 10 | Live memory | **L0** — requires Discovery (`scan_unknown`); not a verified pointer pack |
| **Dredge** | 10 | Live memory | **L0** — requires Discovery (`scan_unknown`); not a verified pointer pack |
| **Stardew Valley** | 9 catalogued · 4 executable save fields | Save editor | Accepted save-field controls (money, stamina, XP, max stamina). Console-command catalog is **not** auto-executed |
| **Crimson Desert** | 8+ (CT metadata) | Live memory (Internal) | Memory path: **L0** Discovery. Internal Engine: Win32 VEH/Hooks authorized. |

### Features (accurate scope)

- Per-cheat **Discovery** workflow (scan → narrow → confirm → write) for memory titles — not pre-wired verified pointers  
- Freeze value (continuous rewrite while armed) after a successful discovery  
- Online-session guard (fail-closed without offline confirmation + connection evidence)  
- Session-local address cache (not restart-stable unless L3-certified elsewhere)  
- F1–F12 hotkeys / overlay when live-memory mode is enabled in settings  
- Stardew Valley **save-field** writes via TrainerHost with approval / backup  

## Safety and support contract

The profile catalog is local/offline. Imported profiles are review-required and do not automatically create executable write support. Save diff is advisory: it helps identify likely editable values, but a diff result is not proof that a write is safe or durable.

Support matrix reports are evidence-based. They describe what was inspected, what evidence exists, and what remains blocked or unverified. Rollback dashboard is visibility/verification only: it reports backup and restore evidence and does not perform silent restore. Unsupported writes remain blocked. No remote calls are used for local profile review, save diff, rollback visibility, or support matrix generation.

## Certification levels

> **Not the same system as security-gate certification.** The L0–L4 levels
> below describe per-target *feature maturity* (how well a specific game
> executable's live-memory support has been verified). They are unrelated to
> the project's security-gate certification (Gate 2.x, Batch B1.1), which is
> tracked in `SOLITH_SECURITY_ROADMAP.md` and describes the *security posture
> of the application itself*, not any one game profile's feature maturity.

- **L0** — discovery or metadata only. Values may be session-local, unverified, or imported from CT/community metadata. User discovery is required.
- **L1/L2** — locally observed evidence exists, but restart stability or executable/build matching is incomplete.
- **L3** — restart-stable pointer/signature evidence exists for a specific executable/build.
- **L4** — release-grade verified support with repeatable tests, version fingerprints, and rollback/safety evidence.

Unless explicitly marked L3+, Solith treats live-memory controls as L0 and requires discovery.

## Launcher and executable target model

Solith’s read-only scanner is launcher-agnostic at the operating-system layer: it selects an explicit process and uses bounded read/query-only Windows process access. The catalog is not launcher-blind, though. One game profile may now describe multiple executable targets, such as Steam, GOG, Epic, Xbox PC / WinGDK, EA, Ubisoft, Rockstar, standalone, or unknown builds.

Certification is per target metadata entry, not per game title. A Steam L3 executable hash does not certify an Epic or Xbox executable, even when the game title is the same. Restricted package targets such as UWP/MSIXVC/AppContainer builds fail closed when normal read/query access is denied; Solith reports read-only validation unavailable instead of requesting administrator elevation, debug privilege, or any bypass.

## Not supported

Solith does not support online/multiplayer targeting, anti-cheat bypass, stealth, debugger bypass, kernel drivers, packet capture, remote trainer-binary execution, or unverified third-party executable cheats.

This is a user-facing summary only. `PROJECT_SPEC.md §3.2 "STRICTLY PROHIBITED
(The Safety Firewall)"` is the authoritative source — if wording ever differs,
`PROJECT_SPEC.md` controls.

## Prerequisites

- Windows 10/11
- **Node.js 22.x** (pinned in `.nvmrc`; `package.json` engines `>=22 <23`; `engine-strict=true`)
- npm 10+ (bundled with Node 22)
- Visual Studio Build Tools with "Desktop development with C++" for native modules
- Python available to node-gyp
- Playwright browsers for E2E/smoke tests when running Playwright suites

Unsupported Node majors (including Node 24) fail at `npm install` / `npm ci` and at `pretest` / `prebuild` via `scripts/check-node.mjs`.

## Clean setup

From a fresh clone on Windows:

```powershell
npm ci
npm run build
npm test
npm run test:electron-smoke
```

The app must launch without hidden local files, old `dist` output, local CT data, or machine-specific paths. Local generated data under `data/` is ignored and must be regenerated when needed.

## Development

```powershell
npm run dev
```

Useful focused commands:

```powershell
npm run build:vite
npm run build:electron
npm run test:live-memory
npm run test:trainer-catalog
npm run test:electron-smoke
```

## Packaging

```powershell
npm run build
```

This builds the renderer, bundles Electron main/preload/TrainerHost, verifies Electron output, and runs `electron-builder` to produce the Windows installer. Until signing is configured and verified, installers should be treated as unsigned development artifacts.

## Bundled assets

The tracked file `SOLITH OPENEING SEQUENCE.mp4` is intentional. It is the Solith first-launch/opening-sequence cinematic imported by `src/app/App.tsx`; its current size is approximately 16.9 MB. Keep it tracked unless the startup cinematic is replaced with an external release-asset strategy.

## CT Library import

Solith treats Cheat Engine `.CT` files as metadata-only research inputs. Raw Auto Assembler/Lua text is preserved inertly; Solith does not execute CT scripts.

```powershell
npm run ct-library:import -- "G:\Downloads\Combined-CheatEngine-Tables.zip" --no-registry-index --library-out data/ct-library/personal-ct-library.summary.json --shards-dir data/ct-library/personal-ct-library-shards
```

The generated `data/ct-library/` files are local artifacts and are ignored by git.

## Native memoryjs troubleshooting

Solith uses a vendored `memoryjs` native addon for Windows process memory work. If live-memory commands fail to load the addon:

```powershell
npm ci
npx electron-rebuild
```

Confirm Visual Studio Build Tools and Python are installed. Read-only runtime validation must use explicit process selection and read/query process permissions only.

## Release readiness

Do not cut a release unless:

- `npm ci` works from a clean clone.
- `npm run build` succeeds.
- `npm test` succeeds with no known failures.
- `npm run test:electron-smoke` succeeds.
- Key E2E flows pass: add/scan game, save detection, save preview/write/backup/rollback, trainer catalog search, CT Library import/search/display, read-only AOB scan against a harmless process, settings persistence, crash recovery, and installer install/launch/uninstall.
- Known limitations are documented in release notes.
