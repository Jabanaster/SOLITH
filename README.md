# Solith - Local AI Game Trainer & Save Editor

Solith is a local/offline-only trainer-style desktop application. It helps you manage local game installations, scan for saves and configurations, compare save states, and safely apply file-backed resource modifications.

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
| **Crimson Desert** | 8+ (CT metadata) | Live memory (+ optional in-process pilot) | Memory path: **L0** Discovery. In-process hooks: **OFF by default**, `CrimsonDesert.exe` only — see [IN_PROCESS_PILOT_SAFETY_CHARTER.md](Docs/IN_PROCESS_PILOT_SAFETY_CHARTER.md) |

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
   See [ANTIVIRUS_SETUP.md](Docs/ANTIVIRUS_SETUP.md) for detailed instructions.

2. **Open Solith** → Select a game from the cheat menu
3. **Confirm offline-only mode** (safety checkbox required)
4. **Toggle cheats** or manually discover values
5. **Enable freeze** to maintain infinite values

### **Safety Architecture:**

- **Fail-closed guard**: Writes blocked if game has active network connections
- **User confirmation required**: Explicit checkbox for offline-only mode  
- **Connection baseline**: Per-game (Palworld: 4 connections = Steamworks overhead)
- **Type validation**: All memory operations validated before native calls
- **Graceful errors**: Invalid addresses/handles rejected before reaching native layer

---

## 🔁 Trainer UI Migration (Checkpoint `806ba56`)

The Palworld-specific trainer UI was replaced with a generic, per-game architecture.
This does not add capability beyond what the memory scan/narrow/write pipeline above
already covers — it changes which components implement it.

**Removed as obsolete** (intentional deletion, not a regression):
- `src/app/components/LiveTrainer.tsx`, `LiveTrainer.module.css`, `LiveTrainer.test.tsx`
- `src/app/components/PalworldCheatMenu.tsx`, `PalworldCheatMenu.module.css`, `PalworldCheatMenu.test.tsx`
- `src/app/pages/PalworldTrainerPage.tsx`, `PalworldTrainerPage.module.css`
- `src/app/hooks/useFreezeValue.ts`, `useLiveTrainerWorkflow.ts`

**Active replacements:**
- [`LiveWatchPanel`](src/app/components/LiveWatchPanel.tsx) is now the active live-watch UI —
  it replaces `LiveTrainer.tsx`'s manual address-discovery view with a live-polling candidate
  table (see the component's own scoring/confidence notes for what it does and does not infer).
- `GameSpecificCheatMenu` (generic, driven by `src/core/cheat-system/games.ts`) replaces the
  Palworld-only `PalworldCheatMenu`/`PalworldTrainerPage` pair.

**Cheat toggle persistence** now flows through a dedicated chain instead of ad hoc component
state:

```
UI → useGameCheatSession (src/app/hooks/useGameCheatSession.ts)
   → preload (electron/preload.ts)
   → electron/cheat-toggle-ipc.ts
   → src/core/cheat-system/cheat-toggle-store.ts
   → cheat_toggle_state table (src/core/database/index.ts)
```

Toggle state (enabled/disabled, last confirmed address, data type) survives a Solith
restart. It does **not** assume the target game process itself is still running with the same
address layout — the caller re-verifies before reuse (see `cheat-toggle-store.ts` doc comment).

**Verification for this checkpoint** (commit `806ba568c9ea9c11d1484e879849983074e76afd`):

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Pass |
| `npm run test:trainer-schema` | Pass, 35/35 |
| `npm run test:live-memory` | Pass, 72/72 |
| `npm run test:trainer-host` | Pass, 80/80 |
| `npm test` (standard suite) | Pass, 508/508 |

No remaining source file imports `LiveTrainer`, `PalworldCheatMenu`, `PalworldTrainerPage`,
`useFreezeValue`, or `useLiveTrainerWorkflow`.

**Known testing gap:** there are no dedicated tests yet for `electron/cheat-toggle-ipc.ts`,
`src/core/cheat-system/cheat-toggle-store.ts`, or `LiveWatchPanel.tsx`. Existing coverage
(`test:trainer-schema`, `test:live-memory`, `test:trainer-host`, standard suite) exercises the
surrounding modified files but not these three directly. This is an open gap, not a claim of
coverage that doesn't exist.

**Scope reminder:** this migration changes UI wiring only. It does not enable any control that
was previously blocked, and it does not add new process/memory capability. Unsupported controls
remain blocked unless explicitly verified and allowed by project safety scope. Support claims in
this document describe local, single-player, offline use of games/saves the user owns — not
broad commercial-game live-trainer support, not multiplayer, and not anti-cheat bypass.

---

## 🛡️ Safety Policy & Scope Limits

To prevent accidental data loss, anti-cheat flags, or system instability, Solith enforces strict scope gates:

### **Allowed Actions (Safe & File-Backed — default path)**
- Save file editing (JSON, XML, INI, CSV, TSV, key/value text, Lua tables).
- Config file editing (.cfg, .conf, .ini).
- JSON/XML/CSV data tweaking.
- Save comparison and discovery.
- Offline rule-based or local AI explanations.
- Automatic backups and one-click rollback/restore.

### **⚠️ Gated Actions (Live Memory — off by default, scoped, verified)**
- Live memory read/scan/write, limited to the pre-declared per-game control catalog
  (`src/core/cheat-system/games.ts`), behind the `v2LiveModeEnabled` setting, a per-session
  offline-confirmation checkbox, and a fail-closed online guard. See
  [`Docs/safety-architecture.md`](Docs/safety-architecture.md) → "Live-Memory Subsystem — Gated &
  Scoped" for the full constraint list. This is not a general RAM-editing feature and does not
  extend to unsupported games or controls outside the catalog.

### **🚫 STRICTLY BLOCKED Actions**
- Process injection or DLL injection.
- Kernel drivers.
- Anti-cheat bypass or stealth behaviors.
- DRM bypass.
- Executable patching (.exe, .dll, .sys, .drv modification).
- Online/multiplayer game support.
- Live memory access outside the gated, catalogued subsystem above (no freeform address entry,
  no unsupported-game targeting).

**Not blocked in Solith 2.0 (when live-memory mode is enabled and offline-confirmed):** trainer overlay
sync and F1–F12 hotkey listening for catalogued cheats. These remain gated behind offline confirmation
and the online-session guard — they are not available for arbitrary games or unverified controls.

---

## 🧾 V2 Safe Support Workflow (UI + Report Model)

Solith V2 surfaces support state as **reviewable evidence**, not implicit execution capability:

- **Profile catalog is local/offline** and bundled for deterministic review.
- **Imported profiles are review-required** before any supported claim.
- **Save diff is advisory** and does not grant executable write support.
- **Support matrix reports are evidence-based** (fixture coverage, blocked reasons, rollback readiness).
- **Rollback dashboard is visibility/verification only** and does not perform silent restore.
- **Unsupported writes remain blocked** even when discovery finds candidate paths.

Execution scope remains narrow:

- JSON, XML, and INI save-field writes use the propose → approve → backup → verify → rollback workflow when the game profile declares the format supported.
- Discovery findings remain advisory unless mapped to existing supported write paths.
- Executable writes remain limited to accepted supported XML controls with approval + backup/rollback safeguards.

Generate the support matrix report locally:

```bash
node scripts/generate-support-matrix.mjs --format markdown
node scripts/generate-support-matrix.mjs --format json --output reports/support-matrix.json
```

No remote calls are used for this workflow.

---

## 📂 Supported File Types & Parsers

Solith scans directories and automatically parses the following formats to extract values, categories, and safety ratings:

1. **JSON**: Standard JSON and JSON with Comments (comments are safely stripped before parsing).
2. **INI / CFG / CONF**: Supports standard configurations, sections, comments (`;` or `#`), and root-level keys.
3. **XML**: Element text, attributes, and structured nodes.
4. **CSV / TSV**: Delimiter-based tables.
5. **Plain Text**: Standard `key = value` or `key: value` lines.
6. **Lua Tables**: Safely parses simple key-value Lua tables (e.g. `{ hp = 100 }`) via safe regex mapping without executing code.
7. **Binary Files (.sav, .dat, .bin)**: Unknown binary files are parsed as **read-only**. Solith supports string extraction (printable ASCII >= 4 characters) and byte-diffing candidates between two saves. **Blind binary writing is strictly blocked.**

---

## 💾 Save Discovery & External Scanning Policy

Solith scans directories for saves. To protect user privacy and system folders:
- **Default Scans**: Scans are local to the selected game folder only.
- **External Scans**: Scans can check `Documents`, `Documents/My Games`, `AppData/Local`, `AppData/LocalLow`, `AppData/Roaming`, `Saved Games`, and Steam userdata folders.
- **Approval Requirement**: External save location scanning is **disabled by default**. It must be explicitly approved/enabled by checking the "Enable External Save Scan" checkbox in the UI, which writes `externalSaveScanEnabled = true` to settings.

---

## 🧠 Value Classification & Confidence Scoring

When comparing saves in the **Discovery Lab**, Solith applies a confidence scoring pass to help you identify gameplay variables (like gold or health) while ignoring system metadata:

- **Boosts (+10 to +25)**: Matches safe gameplay keywords (`health`, `gold`, `xp`, `stamina`, `level`), numeric changes, or exact old/new value matches.
- **Penalties (-20 to -30)**: Matches risky keywords (`id`, `uuid`, `quest`), stats paths (`total_gold_earned`), or timestamps/session/autosave metadata.
- **Blocks (Score = 0)**: Matches security words (`checksum`, `hash`, `signature`, `crc`, `key`) - these are blocked from modification.
- **Noise Suppression**: Timestamps, session IDs, and autosave counters are filtered out of candidates automatically to suppress clutter.

---

## ⚡ Recipe Staleness & Broken Safety

Trainer recipes are compiled configurations. To prevent corrupting saves when games update:
- When a recipe is created, the target file hash and game fingerprint are stored.
- **Needs Rescan**: If the target save file changes (hash mismatch), the recipe is marked as `Needs Rescan`.
- **Broken**: If the target file path or the key inside the file no longer exists, the recipe is marked as `Broken`.
- If the old value stored in the recipe no longer matches, a dry run is executed, and user confirmation is required.

---

## 🛠️ Development Setup & Verification

Solith is built on **Electron**, **React**, and **TypeScript** with an offline-first **sql.js** persistent database.

### **Install Dependencies**
```bash
npm install
```

### **Run Tests**
Uses Node.js's built-in test runner via `tsx` (zero-dependency runner):
```bash
npm test
```

### **Run Dev Server**
```bash
npm run dev
```

### **Build Installer**
```bash
npm run build
```
