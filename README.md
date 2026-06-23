# ResourceForge - Local AI Game Trainer & Save Editor

ResourceForge is a local/offline-only trainer-style desktop application. It helps you manage local game installations, scan for saves and configurations, compare save states, and safely apply file-backed resource modifications.

ResourceForge is strictly designed for single-player, offline games or applications that you own or have permission to modify.

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
