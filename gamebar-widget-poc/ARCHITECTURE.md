# Xbox Game Bar Widget POC — Wisp Companion Overlay

Status: **proof of concept, unbuilt and unverified in this sandbox.** No Visual
Studio, Windows SDK, or Xbox Game Bar developer tooling is installed in this
environment (`msbuild`/`devenv` are not on `PATH` here — checked directly).
Everything below the "What was verified" section is static review, not a
build or runtime result.

## 1. Is third-party Game Bar widget authoring still viable in 2026?

**Yes, technically, but it is a legacy, low-investment surface, not an
actively evolved platform.** Findings from Microsoft Learn (`learn.microsoft.com/en-us/gaming/game-bar/*`):

- The SDK model (UWP XAML app + `microsoft.gameBarUIExtension` AppExtension +
  `Microsoft.Xbox.GameBarWidget` NuGet package) is still the documented,
  current mechanism. It has not been replaced by a newer API family.
- The changelog's most recent entries are Sept 2024 (`7.2.240903001`:
  `CompactModeEnabled` API) and Feb 2024 (`6.1.240122001`: hotkey watcher,
  notifications, foreground-app tracker). Before that, the changelog is
  silent from June 2020 to Feb 2024 — nearly 4 years with no public SDK
  update. This is a maintained-but-not-growing surface: still shipping, cadence
  is roughly one release a year, not the pace of an actively invested platform.
- Microsoft's own docs describe Game Bar as "not extensible" in some public
  messaging even though this opt-in widget system exists — the widget program
  has always been a semi-visible, developer-opt-in feature rather than a
  flagship extensibility story.
- One capability was explicitly removed: Game Bar's built-in broadcast/
  streaming feature was deprecated in Windows 11 22H2 in favor of third-party
  tools (OBS, Streamlabs). That is a removed *first-party feature*, not the
  third-party widget SDK itself — but it is evidence Microsoft trims Game Bar
  surface area over time rather than only adding to it.
- No explicit "third-party widgets are deprecated" statement was found. The
  samples repo (`microsoft/XboxGameBarSamples`) is still the referenced
  source for a working project layout.

**Bottom line:** you can still build one. It requires committing to UWP/XAML
packaging (MSIX), which is a heavier, more legacy-coupled toolchain than a
plain Win32 or Electron overlay, for a feature (in-Game-Bar pinning) that has
seen minimal investment for years. Treat this as buildable-but-fragile, not
as a strategic bet — see the ADR (`ADR-0001-overlay-approach.md`) for the
recommendation against building on it long-term.

Sources:
- https://learn.microsoft.com/en-us/gaming/game-bar/changelog
- https://learn.microsoft.com/en-us/gaming/game-bar/overview
- https://learn.microsoft.com/en-us/gaming/game-bar/quickstart/introduction
- https://learn.microsoft.com/en-us/gaming/game-bar/breaking/widget-name-change
- https://github.com/microsoft/XboxGameBarSamples

## 2. Project structure

```
gamebar-widget-poc/
  ARCHITECTURE.md                    (this file)
  ADR-0001-overlay-approach.md       (overlay-technology decision record)
  WispGameBarWidget/                 (the widget project itself)
    WispGameBarWidget.csproj         (UWP-hybrid csproj, net8.0-windows10.0.19041.0)
    Package.appxmanifest             (declares the gameBarUIExtension)
    App.xaml / App.xaml.cs           (activation entry point)
    MainPage.xaml / MainPage.xaml.cs (Wisp image, button, click-through, mock HTTP call)
    Assets/
      solith-wisp-base-float.png     (copied read-only from the main Solith
                                       worktree's src/app/assets/wisp/ —
                                       original file untouched, checksums
                                       verified identical after copy)
  mock-solith-service/
    server.py                        (loopback-only mock "Solith" HTTP endpoint)
```

## 3. Required tooling (per Microsoft's documented prerequisites)

- **Visual Studio 2022** with the **Universal Windows Platform development**
  workload (this pulls in the UWP project templates, the XAML designer, and
  the deployment/sideload tooling Game Bar widgets need).
- **Windows SDK** matching the manifest's `TargetDeviceFamily` /
  `TargetPlatformMinVersion` — this project targets a `MinVersion` of
  `10.0.17763.0` (Windows 10 1809) with `MaxVersionTested` `10.0.22621.0`
  (Windows 11 22H2). Install the corresponding SDK via the VS Installer or
  standalone from the Windows Dev Center.
- **Xbox Game Bar SDK NuGet package** (`Microsoft.Xbox.GameBarWidget`,
  referenced in `WispGameBarWidget.csproj` at version `7.2.240903001` to match
  the latest documented changelog entry — **verify the exact package id and
  version against nuget.org before building**; this could not be confirmed
  from this sandbox because there is no working NuGet client/network-backed
  restore available here).
- **Windows 10/11 with a matching Game Bar build installed** — either the
  public Game Bar (via Microsoft Store / Xbox app) or the Game Bar Insider
  preview channel, matching the SDK version.
- **Developer Mode enabled** (Settings → Privacy & Security → For developers)
  so an unsigned/locally-built MSIX package can be sideloaded without a Store
  submission or an enterprise signing certificate.

## 4. Build steps (documented, not executed here)

1. Open `WispGameBarWidget.csproj` in Visual Studio 2022 (UWP workload
   installed).
2. Let NuGet restore `Microsoft.Xbox.GameBarWidget`.
3. Set the solution platform to `x64` or `ARM64` (this project intentionally
   has no `x86`/`Any CPU` targets — Game Bar widgets are native-packaged
   UWP apps).
4. Build → Deploy (Debug or Release). Visual Studio's deploy step generates
   and registers the MSIX package for local sideloading automatically when
   Developer Mode is on.

## 5. Sideload / launch / test steps (documented, not executed here)

1. Confirm Developer Mode is enabled.
2. Confirm the installed Game Bar build is compatible with the SDK version
   referenced in the csproj (see Microsoft's per-version compatibility notes
   in the changelog — SDK/Game Bar versions have historically NOT been
   forward/backward compatible across major jumps).
3. Deploy the package from Visual Studio (F5 or Deploy-only). This registers
   the `microsoft.gameBarUIExtension` AppExtension with the OS.
4. Open Game Bar (`Win+G`) over any running application. The widget should
   appear as a tile in the Game Bar "Widget Menu" / Home Bar, using
   `solith-wisp-base-float.png` as its icon (see `Square44x44Logo` /
   `Square150x150Logo` in `Package.appxmanifest` — this POC reuses the single
   copied Wisp PNG for all logo slots rather than producing a full icon set,
   which a shipping widget would need).
5. Click the tile to activate the widget; `App.xaml.cs` receives
   `XboxGameBarWidgetActivatedEventArgs` and navigates to `MainPage`.
6. Pin the widget (Game Bar's pin control) to keep it on top of the game.
7. Launch a real game (or any full-screen/borderless app) and verify the
   Wisp image and control panel stay visible and the game keeps input focus
   except when you deliberately click the "Ping Solith" button.
8. Separately run `python mock-solith-service/server.py` on the same
   machine, then click "Ping Solith" in the widget and confirm the status
   text updates with the mock JSON response.

## 6. Known limitations of this POC

- **Icon set is a stub.** A real widget needs a proper multi-resolution icon
  set (`Square44x44Logo`, `Square150x150Logo`, `Wide310x150Logo`, plus
  scale-tagged variants). This POC points all three manifest logo slots at
  the single copied Wisp PNG, which will look wrong/blurry at some Game Bar
  UI sizes but is sufficient to prove the pinning/visibility mechanics.
- **Unsigned package.** `Package.appxmanifest`'s `Identity/Publisher` is a
  placeholder (`CN=SolithLocalDevPoc`). A real build needs either a
  self-signed test certificate (for sideload) or Store signing (for
  distribution) — this is a normal MSIX requirement, not something specific
  to Game Bar.
- **Click-through implementation is a best-effort static review, not a
  verified-working mechanism.** `MainPage.xaml.cs` uses
  `InputNonClientPointerSource.SetRegionRects(NonClientRegionKind.Passthrough, …)`,
  which is the general UWP/WinUI custom-hit-test-region API that Microsoft's
  Game Bar "click-through" guide points widget authors toward for per-region
  passthrough. This has never been run against a real Game Bar host in this
  sandbox — see the pass/fail table in the top-level report for exactly what
  is and is not claimed to work.
- **Package/NuGet reference is unverified.** The exact current package id and
  version for the Xbox Game Bar SDK NuGet package could not be confirmed
  against a live NuGet feed from this sandbox (no verified network-backed
  NuGet restore was performed). Confirm on nuget.org before building.
- **No trainer/injection/process code anywhere in this POC**, per the task's
  explicit scope constraint. `mock-solith-service/server.py` is a closed,
  single-route, loopback-only HTTP stub with no command dispatch, file
  access, or shell execution.
