# Third-Party Licenses

ResourceForge vendors the following third-party assets directly into the repository (not installed as npm dependencies). This file indexes what's vendored, where, and under what license.

## Fonts

### IBM Plex Sans

- **Location:** `src/app/assets/fonts/ibm-plex-sans/`
- **Version:** 1.1.0
- **License:** SIL Open Font License 1.1 (full text: `src/app/assets/fonts/ibm-plex-sans/LICENSE.txt`)
- **Source:** https://github.com/IBM/plex
- **Copyright:** IBM Corp.

### JetBrains Mono

- **Location:** `src/app/assets/fonts/jetbrains-mono/`
- **Version:** 2.304
- **License:** SIL Open Font License 1.1 (full text: `src/app/assets/fonts/jetbrains-mono/OFL.txt`)
- **Source:** https://github.com/JetBrains/JetBrainsMono
- **Copyright:** JetBrains s.r.o.

## Icons

### Tabler Icons (16-icon subset)

- **Location:** `src/app/components/icons/*.svg`
- **License:** MIT
- **Source:** https://github.com/tabler/tabler-icons
- **Copyright:** Paweł Kuna

Vendored icons: `activity`, `apply` (check), `backups` (archive), `blocked` (lock), `cancel` (x), `caution` (alert-triangle), `database`, `discovery` (flask), `game` (device-gamepad-2), `log` (terminal-2), `refresh`, `safe` (shield-check), `save` (device-floppy), `search`, `settings`, `trainer` (adjustments-horizontal). Each source Tabler icon name is noted in parentheses where it differs from the ResourceForge-internal name used in `<Icon name="...">`.

## Native modules

### memoryjs (patched)

- **Location:** `vendor/memoryjs-3.5.1-patched/`
- **License:** MIT (full text: `vendor/memoryjs-3.5.1-patched/LICENSE.md`)
- **Source:** https://github.com/Rob--/memoryjs
- **Notes:** Vendored with two upstream install/build fixes applied directly to the source — see `vendor/memoryjs-3.5.1-patched/NOTES.md` for details.
