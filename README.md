# Solith - Local AI Game Trainer & Save Editor

Solith is a local-first, single-player trainer-style desktop application. It helps you manage local game installations, scan for saves and configurations, compare save states, and safely apply file-backed resource modifications.

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

### Quick Start:

1. **Setup antivirus whitelist** (prevents false positives):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup-antivirus-whitelist.ps1
   ```
