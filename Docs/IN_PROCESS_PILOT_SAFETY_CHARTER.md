# In-Process Script Pilot — Safety Charter (User-Facing)

**Status:** Quarantined experimental mode · **OFF by default**  
**Pilot executable only:** `CrimsonDesert.exe`  
**Setting key:** `inProcessScriptExecutionEnabled` (must be explicitly set `true`)

## What this mode is

Solith’s in-process pilot can install Auto Assembler–style hooks, allocate a code cave
(`VirtualAllocEx`), and launch external injector helpers for the Crimson Desert pilot only.
This is **not** a general trainer injection framework.

## What this mode is not

- Not enabled for any other game or executable name
- Not an anti-cheat bypass / stealth / kernel driver
- Not authorized for online or multiplayer sessions
- Not a replacement for the RPM/WPM live-memory path used for normal cheats

## Hard gates (all required)

1. Feature flag **OFF** until you turn it on in Settings  
2. Solo / offline confirmation for the session  
3. Explicit per-action approval (hook install / injector launch)  
4. Online-session guard rechecked before write/patch  
5. Executable name must be exactly **`CrimsonDesert.exe`**

Source of truth: `src/core/in-process-script/charter.ts` + `guards.ts`.

## Ban / account / AV risk

Enabling this mode may trigger antivirus heuristics and may violate a game’s terms of service
or platform rules. **You accept account / ban / security software risk** if you opt in.
Leave the flag **OFF** unless you are deliberately testing the Crimson Desert pilot on a
local offline build you own.

## Recommended default

Keep `inProcessScriptExecutionEnabled = false`. Use catalog / save-editor / scan-required
live memory instead.
