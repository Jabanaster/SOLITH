# ResourceForge - Local AI Game Trainer & Save Editor

ResourceForge is a local/offline-only trainer-style desktop application. It helps you manage local game installations, scan for saves and configurations, compare save states, and safely apply file-backed resource modifications.

ResourceForge is strictly designed for single-player, offline games or applications that you own or have permission to modify.

---

## 🎮 Multi-Game Live Trainer & Cheat Hub

ResourceForge includes a **WeMod-style live trainer** with pre-curated cheats for 7 popular games. Toggling a cheat drives a real scan → narrow → confirm → write workflow against live process memory (no stubs) for the six memory-scan titles; Stardew Valley's console-command cheats are catalogued but not yet executed automatically.

| Game | Cheats defined | Discovery | Wired to real memory I/O |
|------|-----------------|-----------|---------------------------|
| **Palworld** | 26 | Memory scan | ✅ |
| **Undisputed** | 11 | Memory scan | ✅ |
| **Atomfall** | 10 | Memory scan | ✅ |
| **Avowed** | 10 | Memory scan | ✅ |
| **Dredge** | 10 | Memory scan | ✅ |
| **Stardew Valley** | 9 | Console command | ⏳ Cataloged only — command executor not yet built |
| **Crimson Desert** | 8 | Memory scan | ✅ |

### **Features:**
✅ **One-click cheat toggles** organized by category, with per-game Steam artwork  
✅ **Real, per-cheat memory discovery** — no shared/global scan state; each cheat scans and narrows independently  
✅ **Freeze value** (infinite health/stamina toggle — continuous re-write at 200ms)  
✅ **Online-session guard** (fails-closed if game has active network connections)  
✅ **Session-local caching** (discovered addresses cached for the session)  
✅ **Defensive wrapping** (validates all memory operations to reduce antivirus flags)  

### **Quick Start:**

1. **Setup antivirus whitelist** (prevents false positives):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup-antivirus-whitelist.ps1
   ```
   See [ANTIVIRUS_SETUP.md](Docs/ANTIVIRUS_SETUP.md) for detailed instructions.

2. **Open ResourceForge** → Select a game from the cheat menu
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

## 🛡️ Safety Policy & Scope Limits

To prevent accidental data loss, anti-cheat flags, or system instability, ResourceForge enforces strict scope gates:

### **Allowed Actions (Safe & File-Backed)**
- Save file editing (JSON, XML, INI, CSV, TSV, key/value text, Lua tables).
- Config file editing (.cfg, .conf, .ini).
- JSON/XML/CSV data tweaking.
- Save comparison and discovery.
- Offline rule-based or local AI explanations.
- Automatic backups and one-click rollback/restore.

### **🚫 STRICTLY BLOCKED Actions**
- Live memory editing (ram scanning/freezing).
- Process injection or DLL injection.
- Kernel drivers.
- Anti-cheat bypass or stealth behaviors.
- DRM bypass.
- Executable patching (.exe, .dll, .sys, .drv modification).
- Online/multiplayer game support.
- Trainer overlays or live hotkey listening.

---

## 🧾 V2 Safe Support Workflow (UI + Report Model)

ResourceForge V2 surfaces support state as **reviewable evidence**, not implicit execution capability:

- **Profile catalog is local/offline** and bundled for deterministic review.
- **Imported profiles are review-required** before any supported claim.
- **Save diff is advisory** and does not grant executable write support.
- **Support matrix reports are evidence-based** (fixture coverage, blocked reasons, rollback readiness).
- **Rollback dashboard is visibility/verification only** and does not perform silent restore.
- **Unsupported writes remain blocked** even when discovery finds candidate paths.

Execution scope remains narrow:

- JSON/INI remain read-only or preview-only unless already proven in accepted behavior.
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

ResourceForge scans directories and automatically parses the following formats to extract values, categories, and safety ratings:

1. **JSON**: Standard JSON and JSON with Comments (comments are safely stripped before parsing).
2. **INI / CFG / CONF**: Supports standard configurations, sections, comments (`;` or `#`), and root-level keys.
3. **XML**: Element text, attributes, and structured nodes.
4. **CSV / TSV**: Delimiter-based tables.
5. **Plain Text**: Standard `key = value` or `key: value` lines.
6. **Lua Tables**: Safely parses simple key-value Lua tables (e.g. `{ hp = 100 }`) via safe regex mapping without executing code.
7. **Binary Files (.sav, .dat, .bin)**: Unknown binary files are parsed as **read-only**. ResourceForge supports string extraction (printable ASCII >= 4 characters) and byte-diffing candidates between two saves. **Blind binary writing is strictly blocked.**

---

## 💾 Save Discovery & External Scanning Policy

ResourceForge scans directories for saves. To protect user privacy and system folders:
- **Default Scans**: Scans are local to the selected game folder only.
- **External Scans**: Scans can check `Documents`, `Documents/My Games`, `AppData/Local`, `AppData/LocalLow`, `AppData/Roaming`, `Saved Games`, and Steam userdata folders.
- **Approval Requirement**: External save location scanning is **disabled by default**. It must be explicitly approved/enabled by checking the "Enable External Save Scan" checkbox in the UI, which writes `externalSaveScanEnabled = true` to settings.

---

## 🧠 Value Classification & Confidence Scoring

When comparing saves in the **Discovery Lab**, ResourceForge applies a confidence scoring pass to help you identify gameplay variables (like gold or health) while ignoring system metadata:

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

ResourceForge is built on **Electron**, **React**, and **TypeScript** with an offline-first **sql.js** persistent database.

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
