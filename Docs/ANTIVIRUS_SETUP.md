# Antivirus Configuration Guide

> **ARCHIVED supplement** — Neutral terminology. See `Docs/SOLITH_LIVE_TRAINER_PARITY.md` for current live-trainer architecture.

Solith uses native memory access (via the `memoryjs` module) to discover and modify game memory. This low-level access may trigger antivirus warnings from Windows Defender, Bitdefender, and other security software.

**This is expected behavior** — antivirus software flags low-level memory operations as potentially suspicious because they're used by both legitimate tools and malware. This guide explains how to safely whitelist Solith.

---

## Quick Start

### **Windows Defender (Built-in)**

1. Open **Windows Defender** → Settings → Virus & threat protection
2. Click **Manage settings** under "Virus & threat protection settings"
3. Scroll to **Exclusions** → Click **Add exclusions**
4. Add:
   ```
   C:\Users\[YourUsername]\AppData\Local\Programs\Solith\
   ```

**Or run the automated setup script:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-antivirus-whitelist.ps1
```

### **Bitdefender**

1. Open **Bitdefender Total Security** → Settings → Protection → Exclusions
2. Click **Add exclusion** → Select the **Solith installation directory**
3. Add process names:
   - `ResourceForge.exe`
   - `memoryjs`
4. Click **Apply**

**For manual steps:**
```
Settings → Protection → Exclusions
Add: C:\Users\[YourUsername]\AppData\Local\Programs\Solith\
Add: [Your Project Directory]\Solith\dist-electron\
Process names: ResourceForge.exe, memoryjs
```

---

## Why Does Solith Trigger Antivirus?

### Memory Access Operations

Solith performs these legitimate operations:

| Operation | Why It's Needed | Why Antivirus Flags It |
|-----------|-----------------|----------------------|
| Read process memory | Scan for game values (gold, health, etc.) | Malware also scans memory to find code injection points |
| Write process memory | Modify game values when cheats are applied | Malware uses this to inject code or hijack processes |
| Enumerate processes | Find running game instances (Palworld, etc.) | Rootkits enumerate processes to hide themselves |
| Query memory regions | Map memory layout to find target data | Rootkits do this for privilege escalation |

All of these are **normal for legitimate debugging tools** (Cheat Engine, OllyDbg, IDA Pro, WeMod, PLITCH).

### Heuristic Detection

Bitdefender, Norton, McAfee use **heuristic engines** that flag suspicious behavior patterns:

- ✅ **Legitimate**: "Debug a single game I own"
- ❌ **Suspicious**: "Scan all processes, enumerate memory, inject code repeatedly"

Solith is designed to be minimal and low-risk:
- Requires explicit game selection (user chooses target)
- Only reads/writes memory in user-selected address range
- Validates all inputs before native calls
- Fails safely on permission errors

---

## Platform-Specific Setup

### **Windows Defender + Bitdefender (Dual Protection)**

Both can be active simultaneously. Whitelist in both:

1. **Windows Defender** (built-in): Settings → Virus & threat protection → Exclusions
2. **Bitdefender** (paid): Bitdefender → Settings → Protection → Exclusions

### **Third-Party Antivirus (Norton, McAfee, Kaspersky, etc.)**

Most follow the same pattern:

1. Open antivirus settings
2. Find "Exclusions", "Trusted apps", or "Whitelist"
3. Add the full Solith directory path
4. Restart the antivirus (some require system restart)

**Common paths to exclude:**
```
C:\Users\[YourUsername]\AppData\Local\Programs\Solith\
[Your-Dev-Directory]\Solith\dist-electron\
[Your-Dev-Directory]\Solith\dist\
```

### **Windows Sandbox / Isolated Testing**

If you're testing Solith in a sandbox environment:

1. Disable antivirus entirely (or add broad exclusions)
2. Test the trainer on your target games
3. If it works, add permanent exclusions on your main system

---

## Automated Setup Script

The provided PowerShell script automates Windows Defender and Bitdefender configuration.

### **Requirements:**
- Windows 10 or later
- Administrator privileges
- PowerShell 5.0+ (or PowerShell 7+)

### **Usage:**

```powershell
# Run with prompts (interactive)
powershell -ExecutionPolicy Bypass -File scripts\setup-antivirus-whitelist.ps1

# Run without prompts (automatic)
powershell -ExecutionPolicy Bypass -File scripts\setup-antivirus-whitelist.ps1 -AutoConfirm
```

**What the script does:**
- ✅ Detects Solith installation path
- ✅ Adds file/directory exclusions to Windows Defender
- ✅ Verifies exclusions were applied
- ✅ Provides manual steps for Bitdefender (requires user action)

---

## Testing the Whitelist

### **Verify Windows Defender exclusions:**

```powershell
Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
```

You should see Solith's path listed.

### **Verify Bitdefender exclusions:**

1. Open Bitdefender Settings
2. Go to Protection → Exclusions
3. Check that Solith paths are listed

### **Functional test:**

1. Start a game (Palworld, Atomfall, etc.)
2. Open Solith
3. Try a simple cheat (e.g., "Infinite Health")
4. If the cheat applies without warnings, the whitelist is working

---

## False Positive Reporting

If you believe Solith is being flagged as a false positive:

### **For Windows Defender:**
1. [Submit to Microsoft Defender Research](https://www.microsoft.com/en-us/wdsi/submission)
2. Upload `ResourceForge.exe` and provide context

### **For Bitdefender:**
1. [Submit to Bitdefender Labs](https://www.bitdefender.com/submit/)
2. Upload the file and explain it's a game trainer

### **For other antivirus:**
- Check the vendor's website for false positive submission process
- Provide Solith source code if available (open-source projects get faster review)

---

## Safety & Security

### **Is it safe to whitelist Solith?**

**Yes, if you:**
1. Downloaded Solith from the official repository
2. Verified the executable signature (if code-signed)
3. Trust the developers (open-source, reviewed community)
4. Only use it on games you own
5. Don't use it on shared/public computers

### **What happens after whitelisting?**

- Windows Defender and Bitdefender will **skip** Solith during scans
- Solith can freely access game memory
- You'll no longer see antivirus warning dialogs
- Your system remains protected from other threats

### **Can this be abused?**

Theoretically, yes — any whitelisted application could be malicious. But:
- Solith is **open-source** (code is auditable)
- It's **not distributed as a binary** (you build it yourself or get it from trusted repos)
- It only runs **when you explicitly launch it**
- It only affects **games you select**

---

## Troubleshooting

### **Antivirus still blocking after whitelisting**

1. **Verify the exclusion path is correct:**
   - Check the exact Solith installation directory
   - Copy the full path from File Explorer (Shift + right-click → Copy as path)
   - Paste into the antivirus exclusion settings

2. **Try a broader exclusion:**
   - Instead of: `C:\Users\User\AppData\Local\Programs\Solith\ResourceForge.exe`
   - Try: `C:\Users\User\AppData\Local\Programs\Solith\` (whole directory)

3. **Restart the antivirus or system:**
   - Some changes don't take effect until the antivirus service restarts
   - Restart your computer if exclusion changes don't work immediately

4. **Check for multiple antivirus products:**
   - Remove conflicting security software (or whitelist in all of them)
   - Windows Defender + Bitdefender can conflict if both are active

5. **Disable real-time scanning temporarily:**
   - If you're just testing, temporarily disable real-time scanning
   - Re-enable it after testing is complete

### **Script fails with permission error**

1. Open PowerShell as Administrator
2. Run: `Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope CurrentUser`
3. Run the script again

### **Solith path not found**

The script looks in these locations:
- `C:\Users\[Username]\AppData\Local\Programs\Solith\`
- `C:\Program Files\Solith\`
- Local build directory: `[ProjectDir]\dist-electron\`

If you installed elsewhere, provide the custom path when prompted.

---

## Advanced: Code-Signing

If distributing Solith to others, consider **code-signing** the executable to eliminate false positives.

### **Benefits:**
- ✅ Reduces heuristic warnings
- ✅ Shows "Verified Publisher" in Windows SmartScreen
- ✅ Improves user trust
- ✅ Faster antivirus vendor approval (if submitted as false positive)

### **Requirements:**
- Code signing certificate ($50-300/year from DigiCert, Sectigo, etc.)
- Windows SDK or signtool.exe
- Build pipeline integration

### **Implementation:**
```bash
# Sign the executable
signtool sign /f cert.pfx /p password /t http://timestamp.server ResourceForge.exe

# Verify signature
signtool verify /v ResourceForge.exe
```

---

## References

- [Microsoft Defender Exclusions](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/configure-exclusions-microsoft-defender-antivirus)
- [Bitdefender Exclusions](https://www.bitdefender.com/consumer/support/answer/2427/)
- [memoryjs Documentation](https://github.com/Rob--/memoryjs)
- [Cheat Engine (similar tool)](https://cheatengine.org/)
- [WeMod (commercial equivalent)](https://www.wemod.com/)

---

## Support

If you're still experiencing antivirus issues:

1. **Check the README** for troubleshooting steps
2. **Open an issue** on GitHub with:
   - Your antivirus product and version
   - The exact error message
   - Steps you've taken to whitelist
3. **Join the Discord** (if available) for community support

---

**Remember:** Whitelisting should only be done for applications you trust and own. Solith is designed to be safe and transparent, but security is ultimately your responsibility.
