# Xbox Game Bar Widget POC — Wisp Companion Overlay

Status (updated 2026-07-26): **compiles cleanly, produces a real MSIX
package, on the actual Solith development machine.** The original version of
this document (2026-07-25) was written in a sandbox with no Visual Studio,
Windows SDK, or network-backed NuGet access, and its claims about package
name, project shape, and SDK maintenance activity were unverified guesses -
several of them were wrong. This revision replaces those claims with what was
directly verified: NuGet.org queries, a downloaded and metadata-inspected
`.winmd`, Microsoft's current Game Bar SDK docs (fetched during the rebuild),
and an actual `MSBuild.exe` run that produced a working package.

Sideloading, pinning, and live-game/focus/click-through testing are the next
gate and have **not** been run yet - see section 5.

## 1. Is third-party Game Bar widget authoring still viable in 2026?

**Yes, and it is actively maintained, not a stagnant legacy surface** — this
corrects the previous version of this document, which claimed a "nearly
4-year gap (2020-2024)" based on an unverified assumption.

Verified directly against NuGet.org (`azuresearch-usnc.nuget.org` query API)
during this rebuild:

- The real package is **`Microsoft.Gaming.XboxGameBar`** (tags: Gaming,
  GameBar, Overlay, Extension, Widget). The name assumed in the previous
  draft, `Microsoft.Xbox.GameBarWidget`, does not exist — zero hits.
- Published version history: `7.2.240903001` (2024-09), `7.2.241028002`
  (2024-10), `7.3.2506120` (2025-06), `7.3.2511061` (2025-11),
  `7.3.2603250-rc` (2026-03), **`7.3.2607010` (2026-07-01)** — the latest
  stable release, published roughly three weeks before this rebuild.
- The package targets `UAP10.0` (classic UWP), confirmed via its
  `dependencyGroups` metadata and by directly downloading and inspecting
  `lib/uap10.0/Microsoft.Gaming.XboxGameBar.winmd`'s type metadata (namespace
  `Microsoft.Gaming.XboxGameBar`, real classes `XboxGameBarWidget`,
  `XboxGameBarWidgetActivatedEventArgs`, `XboxGameBarAppTargetTracker`,
  `XboxGameBarHotkeyWatcher`, etc.).
- Microsoft's current docs (`learn.microsoft.com/en-us/xbox/game-bar/*`,
  fetched live during this rebuild) still document the full activation flow,
  manifest schema, and API reference for this exact package with no
  deprecation notice.

**Bottom line:** this is a real, current, actively-released SDK. The earlier
"low investment, buildable-but-fragile" framing is retracted — see
`ADR-0001-overlay-approach.md`'s supersession notice for the corrected
decision-record status (feasibility is open pending the sideload/pin/live-game
gate, not rejected).

Sources (fetched live during this rebuild, 2026-07-26):
- https://api.nuget.org/v3/registration5-semver1/microsoft.gaming.xboxgamebar/index.json
  (full version history)
- https://learn.microsoft.com/en-us/xbox/game-bar/api/xgb-widget
- https://learn.microsoft.com/en-us/xbox/game-bar/api/xgb-widgetactivatedeventargs
- https://learn.microsoft.com/en-us/xbox/game-bar/guide/app-activation
- https://learn.microsoft.com/en-us/xbox/game-bar/guide/pkg-manifest
- https://learn.microsoft.com/en-us/xbox/game-bar/guide/click-through

## 2. Project structure

```
gamebar-widget-poc/
  ARCHITECTURE.md                    (this file)
  ADR-0001-overlay-approach.md       (overlay-technology decision record; see supersession notice)
  WispGameBarWidget/                 (the widget project itself)
    WispGameBarWidget.csproj         (classic non-SDK-style UWP csproj, TargetPlatformVersion 10.0.22621.0)
    Package.appxmanifest             (declares the gameBarUIExtension + package-level proxy/stub extension)
    App.xaml / App.xaml.cs           (real Protocol/ms-gamebarwidget activation flow)
    MainPage.xaml / MainPage.xaml.cs (Wisp image, button hidden during click-through, mock HTTP call)
    Properties/
      AssemblyInfo.cs
      Default.rd.xml                (.NET Native runtime directives, Release builds only)
    Assets/
      solith-wisp-base-float.png    (copied read-only from the main Solith worktree's
                                      src/app/assets/wisp/ - original untouched, checksum-verified)
      Square150x150Logo.png         (150x150, generated via ffmpeg for manifest validation)
      Square44x44Logo.png           (44x44, generated via ffmpeg)
      Wide310x150Logo.png           (310x150, generated via ffmpeg)
      StoreLogo50.png               (50x50, generated via ffmpeg)
    AppPackages/                    (build output - gitignored; contains the sideloadable .msix
                                      and VS-generated Install.ps1 / Add-AppDevPackage.ps1)
  mock-solith-service/
    server.py                        (loopback-only mock "Solith" HTTP endpoint)
```

## 3. Required tooling (verified on this machine, not just documented)

- **Visual Studio 2022** (this machine: Community, `D:\Visual Studio`, 17.14)
  with the **Universal Windows Platform development** workload. This was
  missing initially - confirmed via `vswhere -requires
  Microsoft.VisualStudio.Workload.Universal` returning nothing - and was
  installed via the VS Installer GUI (the CLI `modify --quiet` path was
  attempted first and failed with exit 5007, "should be run elevated from the
  beginning"; the GUI path succeeded). Re-verified afterward with the same
  `vswhere` command returning `D:\Visual Studio`.
- **Windows SDK 10.0.22621.0** for the project's `TargetPlatformVersion`
  (already present on this machine, confirmed via
  `C:\Program Files (x86)\Windows Kits\10\Include`). Note: a *different*
  requirement surfaced for the modern-.NET UWP project shape (net9.0-windows +
  `UseUwp`), which requires SDK `10.0.26100.0` or higher - irrelevant here
  since this project uses the classic (non-SDK-style) project shape instead
  (see section 4 for why).
- **`Microsoft.Gaming.XboxGameBar` NuGet package**, version `7.3.2607010` -
  verified to exist and resolve via a live NuGet restore (not assumed).
- **`Microsoft.NETCore.UniversalWindowsPlatform` NuGet package**, version
  `6.2.14` - the standard UWP BCL meta-package, required by any classic UWP
  csproj.
- **Windows 10/11 with a matching Game Bar build installed** - not yet
  verified against this specific SDK version; part of the next gate.
- **Developer Mode** (Settings → Privacy & Security → For developers) - **not
  yet enabled**, per explicit scope constraint for this phase (see section 5).

## 4. Why the project is a classic (non-SDK-style) UWP csproj, not the modern net9.0-windows shape

The first rebuild attempt used the modern ".NET for UWP" project shape (VS
2022's `Windows_UAP_NET_BlankXamlApplication` template: SDK-style csproj,
`TargetFramework net9.0-windows10.0.26100.0`, `UseUwp=true`). It restored
without error and looked plausible, but the C# compiler could not resolve
`Microsoft.Gaming.XboxGameBar` at all (`CS0234`). Direct inspection of
`obj/project.assets.json` showed why: NuGet only resolved the package's
`build/*.props`/`.targets` for that target framework - the `compile` asset
list was **empty**. The package's own `build/Microsoft.Gaming.XboxGameBar.targets`
file was also inspected directly and does no manual reference injection that
would work around this.

The package ships only `lib/uap10.0/Microsoft.Gaming.XboxGameBar.winmd`.
NuGet's standard per-framework asset selection only picks that up as a
compile-time reference for a project whose own TargetFramework is literally
`uap10.0` - i.e. `TargetPlatformIdentifier=UAP`, the classic (pre-.NET5,
non-SDK-style) UWP project system, which is what this project now uses (based
on VS 2022's `Windows UAP\BlankApplication` template). Switching to that
shape and rebuilding immediately resolved the namespace, confirming the
diagnosis rather than assuming it.

## 5. Build steps (executed on this machine, 2026-07-26)

1. `& "D:\Visual Studio\MSBuild\Current\Bin\MSBuild.exe" WispGameBarWidget.csproj /p:Configuration=Debug /p:Platform=x64 /restore /nologo`
2. Iteration log (each fixed a real, observed error - not hypothetical):
   - `NETSDK1083` (`win10-x64` invalid RID for `net8.0`) → led to trying the
     modern net9.0-windows shape, then discovering the compile-asset gap
     above and switching to the classic project shape.
   - `Microsoft.Windows.UI.Xaml.CSharp.ModernNET.targets` error: SDK
     `10.0.22621.0` not supported for the modern-.NET UWP shape, needs
     `10.0.26100.0`+ → moot once the classic shape (which has no such
     restriction, and matches the user's requested `10.0.22621.0` target) was
     adopted.
   - `WMC1013` duplicate Page project path → removed redundant explicit
     `<Page Include>` items left over from an earlier attempt.
   - `CS0234`/`CS0246` (`Microsoft.Gaming.XboxGameBar` / `XboxGameBarWidget`
     unresolved) → root-caused to the compile-asset gap in section 4; fixed
     by switching project shape.
   - `CS0246` (`NavigationFailedEventArgs`) → missing `using
     Windows.UI.Xaml.Navigation;`.
   - `CS1061` (`Uri` has no `SchemeName`) → WinRT `Windows.Foundation.Uri`
     projects to `System.Uri` in .NET, whose property is `Scheme`, not
     `SchemeName`.
   - `CS0103` (`InputNonClientPointerSource`, `NonClientRegionKind` undefined)
     → traced to a fabricated API; Microsoft's actual click-through guide
     (fetched live) has no per-region hit-test mechanism at all. Rewrote
     `MainPage.xaml.cs` to the real documented pattern: hide/disable
     interactive controls when `XboxGameBarWidget.ClickThroughEnabled` is
     true, since click-through is an all-or-nothing toggle for the whole
     widget, not something the widget can carve regions out of.
   - `APPX1619`/`APPX3207` (manifest logo images wrong size/too large) → the
     single reused Wisp PNG (1.9MB, arbitrary aspect ratio) failed Windows
     App Packaging's strict dimension/size validation for
     `Square150x150Logo`, `Square44x44Logo`, `Wide310x150Logo`, and the
     package `Logo`. Generated correctly-sized copies with `ffmpeg` (already
     present on this machine) and repointed the manifest/csproj at them.
3. **Result: clean build**, zero errors:
   ```
   WispGameBarWidget -> ...\bin\x64\Debug\WispGameBarWidget.exe
   WispGameBarWidget -> ...\AppPackages\WispGameBarWidget_0.1.0.0_x64_Debug_Test\WispGameBarWidget_0.1.0.0_x64_Debug.msix
   WispGameBarWidget -> obj\x64\Debug\Symbols\WispGameBarWidget_0.1.0.0_x64_Debug.appxsym
   ```
   Visual Studio's Appx tooling also auto-generated `Install.ps1` and
   `Add-AppDevPackage.ps1` sideload scripts in the `AppPackages` output
   directory - these were generated by the build, not authored by hand, and
   have not been run.

## 6. Sideload / launch / test steps — NEXT GATE, NOT YET RUN

Per the agreed gating process, none of the following have been executed.
Each requires separate explicit authorization:

1. Enable Developer Mode (Settings → Privacy & Security → For developers).
   **Not done - requires explicit approval.**
2. Trust/install a signing certificate for the unsigned test package.
   **Not done - requires explicit approval; exact commands to be reported
   before running.**
3. Sideload via the generated `AppPackages\..\Install.ps1` or
   `Add-AppDevPackage.ps1`. **Not done.**
4. Open Game Bar (`Win+G`) and confirm the widget appears and can be pinned.
   **Not done.**
5. Launch a real game (windowed, borderless, and fullscreen) and verify: the
   Wisp image and control panel stay visible, the game retains input focus,
   `Win+G` open/close lifecycle, pin/unpin, click-through toggling actually
   hides the button as coded, alt-tab, and minimize/restore. **Not done.**
6. Run `python mock-solith-service/server.py` and confirm the widget's "Ping
   Solith" button gets a real response from inside a live Game Bar host (not
   just the standalone mock service, which was already confirmed reachable on
   its own in the original sandbox pass). **Not done.**

## 7. Known limitations

- **Icon set is a placeholder, not a design asset.** The four logo PNGs are
  the single Wisp float image forced to the required pixel dimensions via
  `ffmpeg -vf scale=WxH` (ignoring aspect ratio) purely to satisfy Windows App
  Packaging's manifest validation. They will look distorted in Game Bar's UI.
  Sufficient to prove the pinning/visibility mechanics, not shippable as-is.
- **Unsigned package.** `Package.appxmanifest`'s `Identity/Publisher` is a
  placeholder (`CN=SolithLocalDevPoc`). Sideloading an unsigned/test-signed
  package requires Developer Mode and a trusted local certificate - the next
  gate, not yet done (section 6).
- **Click-through is implemented per Microsoft's documented model but
  never run against a real Game Bar host.** The corrected
  `MainPage.xaml.cs` hides the control panel when `ClickThroughEnabled` is
  true; this compiles and matches the docs, but has not been observed working
  end-to-end over a live game (section 6).
- **No trainer/injection/process code anywhere in this POC**, per the task's
  explicit scope constraint. `mock-solith-service/server.py` is a closed,
  single-route, loopback-only HTTP stub with no command dispatch, file
  access, or shell execution.
