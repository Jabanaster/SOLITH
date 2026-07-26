# ADR-0001: Overlay technology for the Wisp companion

Date: 2026-07-25
Status: Proposed (proof-of-concept level; not a production decision record for the main Solith app)

## Context

Solith already ships a working Wisp companion overlay built as an Electron
`BrowserWindow` (`electron/wisp-overlay.ts` in the main worktree): frameless,
transparent, `alwaysOnTop`, click-through by default via
`setIgnoreMouseEvents(true, { forward: true })`, toggled interactive on
demand, with position persisted to disk. It already works, ships today, and
is not part of this POC's scope to modify.

This ADR evaluates whether an Xbox Game Bar widget, a native Win32 layered
window, or graphics injection would be a better (or complementary) way to
show the Wisp companion "over a game," and gives a concrete recommendation.

## Options considered

### A. Xbox Game Bar widget (this POC)

- **How it shows over a game:** Not really "over the game" in the general
  case — it renders *inside Game Bar's own overlay surface* (`Win+G`), which
  itself is composited over whatever has focus. The widget only appears when
  Game Bar is invoked/pinned, and only within Game Bar's UI regions (Home
  Bar, widget tiles), not as an independent freely-positioned window.
- **Tech stack:** UWP XAML app, MSIX-packaged, signed. A different runtime,
  language-idiomatic surface (XAML/C#), and packaging pipeline than the rest
  of Solith (Electron/TypeScript).
- **Distribution:** Sideload via Developer Mode, or Store submission for
  wide distribution. Users must have Game Bar enabled and the widget
  installed/pinned separately from installing Solith itself.
- **Maintenance signal:** SDK changelog shows a nearly 4-year gap
  (2020–2024) between meaningful updates, then two small releases in
  2024. Low investment, but not abandoned.
- **Positioning/sizing:** Constrained to what Game Bar's widget host allows
  (`PreferredWidth`/`Height`, min/max) — no free-form always-on-top placement
  independent of Game Bar's own UI.
- **Verdict input:** Interesting as a "also show up inside Game Bar" nice-to-have,
  wrong as a primary mechanism, because it depends on the user invoking
  Game Bar at all and only renders within Game Bar's own chrome.

### B. Native Win32 layered/transparent overlay window

- **How it shows over a game:** A `WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST`
  window (or a DirectComposition-backed transparent window for hardware
  acceleration) sits above the game's window in Z-order, independent of Game
  Bar entirely. This is architecturally identical to what the existing
  Electron overlay already does — Electron's `BrowserWindow` with
  `transparent: true` + `alwaysOnTop: true` + `setIgnoreMouseEvents` is
  implemented on Windows via this exact same layered-window mechanism under
  the hood.
- **Tech stack:** C++/C# + Win32 or WinUI 3, if built as a standalone native
  overlay outside Electron.
- **Distribution:** Ships as part of the existing Solith installer; no
  separate sideload/pinning step, no dependency on Game Bar being enabled.
- **Maintenance signal:** Win32 layered windows are a decades-stable OS
  primitive with no deprecation risk.
- **Positioning/sizing:** Fully free-form — any position, any size, any
  monitor, independent of any host application's UI.
- **Verdict input:** This is what Solith already has, just via Electron
  instead of raw Win32. Rebuilding it in raw Win32/WinUI3 would trade
  "reuse the existing Electron/TS stack and IPC" for "marginally lower
  overhead, native look," with real cost (new codebase, new build/release
  pipeline, duplicated maintenance) and no capability gain over what
  `wisp-overlay.ts` already delivers.

### C. Current Electron overlay (`electron/wisp-overlay.ts`)

- **How it shows over a game:** Same layered/transparent/topmost mechanism as
  option B, via Electron's cross-platform abstraction over it. Already
  proven working in this codebase: collapsed/expanded bounds, clamped to
  the nearest display's work area, position persisted across restarts,
  click-through toggled via IPC (`wisp-overlay-set-interactive`).
- **Tech stack:** Same as the rest of Solith (Electron main process,
  TypeScript, existing IPC patterns in `electron/*.ts`).
- **Distribution:** Already part of the Solith app; zero additional install
  step for the user.
- **Maintenance signal:** Actively maintained by this project, today, by this
  team.
- **Positioning/sizing:** Same free-form flexibility as option B.
- **Cost relative to B:** Slightly higher baseline memory/process overhead
  (Chromium/Node runtime) than a hand-written Win32 window, in exchange for
  no new codebase, no new packaging pipeline, and direct reuse of existing
  IPC, state persistence, and UI code (`SolithWispCompanion.tsx`).

### D. Graphics injection (DLL/hook into the game's render pipeline)

- **How it shows over a game:** Draws directly inside the game's own
  swapchain/present call (the mechanism used by tools like Discord overlay,
  RivaTuner Statistics Server, Steam overlay).
- **Tech stack:** A DirectX/OpenGL/Vulkan hook injected into the target
  process, drawing with the game's own graphics API.
- **Distribution/legality/risk:** Requires injecting code into another
  process's address space. This is exactly the category of technique this
  task explicitly excludes from scope (no process attach, no injection
  logic), and for good reason: it is fragile (breaks on every graphics API
  or anti-cheat update), carries real anti-cheat/EAC/BattlEye ban risk for
  the *user*, and needs per-graphics-API-version maintenance far beyond
  window-compositing overlays.
- **Verdict input:** Out of scope by design and out of scope on the merits —
  categorically higher risk and cost than any window-compositing approach,
  for no capability gain relevant to displaying a static companion image.

## Decision

**Keep the existing Electron layered-window overlay (`electron/wisp-overlay.ts`)
as the one and only overlay mechanism. Do not build a Game Bar widget or a
separate native Win32 overlay as production surfaces.**

Concrete reasoning, no hedging:

1. Options B and C are the *same underlying OS mechanism* (layered/transparent/
   topmost window). C already exists, is shipped, and is maintained. Building
   B would be pure duplication for a marginal resource-usage improvement —
   not worth a second codebase and release pipeline.
2. Option A (Game Bar widget) does not actually solve "always visible over a
   game" — it only renders when the user invokes Game Bar, inside Game Bar's
   own chrome, sized to Game Bar's constraints. It is strictly less capable
   for this use case than what C already provides, at the cost of an entire
   parallel UWP/MSIX toolchain, a separate install/pin step, and a
   demonstrably low-investment host SDK (see ARCHITECTURE.md section 1). If
   there is ever a future want for "Wisp also shows up as a Game-Bar-native
   tile," it could be revisited as an *additive* thin client — but that is a
   "maybe later, low priority" call, not something to build now.
3. Option D is excluded on both scope and merit grounds — real anti-cheat
   ban risk to the end user and per-engine/per-API maintenance burden with
   zero benefit for a static companion overlay.

**If forced to rank for a hypothetical net-new build with no existing
overlay:** C (Electron, if the rest of the app is already Electron) ties with
B (raw Win32/WinUI3, if starting from a native app) as the correct primary
mechanism; A is a distant, optional third for Game-Bar-specific visibility;
D is disqualified.
