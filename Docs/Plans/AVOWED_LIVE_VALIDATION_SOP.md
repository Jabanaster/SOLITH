# Avowed Live Validation SOP

**Purpose:** Strict playbook to elevate Avowed from **L0 `scan_unknown`** to **L2 / L3** certified memory features.  
**Boundary:** `RPM_ONLY` — `ReadProcessMemory` / `WriteProcessMemory` / user-mode attach only.  
**Targets:** Steam `Avowed.exe` and Xbox PC Game Pass `Avowed-WinGDK-Shipping.exe`.  
**Schema contract:** `src/core/definitions/schema.v1.ts` (`MemoryFeatureResolutionV1`).  
**Evidence template:** mirror `Docs/Baselines/ATOMFALL_L3_EVIDENCE.md` when promoting.

Do **not** update `AVOWED_L0_DEFINITION` in `bundled-definition-seed.ts` until every gate in this SOP passes.

---

## Rules of engagement (non-negotiable)

| Rule | Requirement |
|------|-------------|
| **No injection** | No DLL injection, code caves, hooks, debugger attach for bypass, kernel drivers, or in-process pilot expansion. Avowed is mainstream live-memory only. |
| **Read-only initial scanning** | Phase A–C are **read-only**. No `WriteProcessMemory` until a candidate address is isolated and the operator explicitly starts Phase D (safe probe). |
| **Two full restarts minimum** | Do **not** raise `certificationLevel` above L0, and do **not** replace `scan_unknown` with a static path, until the **same** `moduleName` + `baseOffset`/`signature` + `pointerChain` resolves after **at least two** full process exits and relaunches (new PIDs). |
| **Offline / single-player** | Online-session guard remains fail-closed. Measure connection baseline first; abort if above reviewed baseline. |
| **Backup gate** | Prefer WinGDK attach so `wgs` watcher + Alabama config snapshot run (`electron/avowed-wingdk-backup-watch.ts`). Never write into `Packages\*` or `Alabama\*`. |
| **Honest L0 until evidence** | Placeholder AOBs, copied Cheat Engine tables, or single-session absolute addresses are **not** cert evidence. |

---

## Certification ladder (Avowed)

| Level | Meaning for Avowed | Gate |
|-------|--------------------|------|
| **L0** (current) | Scaffold only — `type: scan_unknown`, empty resolution beyond `moduleName` | Schema validates |
| **L1** | Resolution documented offline | Candidate `signature` and/or `baseOffset` + `pointerChain` written in evidence draft (not yet bundled as verified) |
| **L2** | Attach + stable read | Live attach to WinGDK (or Steam) + repeated reads match HUD/state without restart requirement |
| **L3** | Restart-stable | Same chain works across ≥2 full restarts; optional safe write/restore probe |
| **L4** | In-game evidence | Recorded gameplay proof after verified write — out of scope until L3 |

Reference: `Docs/Certification/LEVELS.md`.

---

## Preconditions

1. Solith built and able to attach via existing live-memory path (`memoryjs` / `MemoryDriver`).
2. Avowed running offline, single-player, save loaded in a controllable state (health / stamina / essence visible).
3. Prefer Game Pass container: **`Avowed-WinGDK-Shipping.exe`**.
4. Confirm Zero-Input detect sees the process; confirm WinGDK backup session started if on Game Pass.
5. Capture connection baseline:

```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
node scripts/measure-connection-baseline.mjs
```

Record the measured baseline; do not invent a `connectionBaseline` value.

Harnesses available after candidates exist:

```powershell
node scripts/verify-pointer-path.mjs
node scripts/certify-live-pointer.mjs
npx tsx scripts/certify-cheat.mjs --catalog-game-id avowed --level L1
```

---

## Phase A — Attach and fingerprint (read-only)

1. Launch Avowed (WinGDK preferred). Load a known save.
2. Confirm process name exactly (case-insensitive module match later):
   - Game Pass: `Avowed-WinGDK-Shipping.exe`
   - Steam: `Avowed.exe`
3. Record into the session log:
   - Timestamp (UTC)
   - PID
   - Module base address for the shipping EXE
   - Optional: executable SHA-256 / hash prefix for `executableHashPrefixes`
4. **Do not write memory.**

---

## Phase B — State-delta scan (read-only)

Goal: find **dynamic addresses** that change when a single known in-game value changes.

### B1. Choose one feature at a time

Pinned L0 ids (must stay in sync with `AVOWED_L0_FEATURE_IDS`):

- `infinite-health`
- `infinite-stamina`
- `infinite-essence`

Work **one** feature per scan campaign.

### B2. Capture procedure

1. Note the on-screen value (e.g. current health).
2. Take **Scan 1** (exact value / known type — prefer `int32` or `float` to match schema `dataType`).
3. Change the value **in-game only** (take damage, sprint, cast, etc.). Do not poke memory.
4. Take **Scan 2** filtered to the new value (decreased / increased / changed).
5. Repeat until the candidate set is small (ideally &lt; 20 addresses).
6. For each remaining candidate, record:
   - Absolute address (session-local)
   - Value before / after each state change
   - Whether the address died after a map transition or menu open (discard unstable HUD copies early)

### B3. Required capture fields (per candidate)

```text
featureId:
dataType:                 # int32 | float | ...
sessionId:                # A, B, ...
pid:
moduleName:               # Avowed-WinGDK-Shipping.exe or Avowed.exe
moduleBase:               # e.g. 0x140000000
dynamicAddress:           # absolute VA where value lives THIS session
observedValues:           # list of HUD-correlated reads
notes:
```

Absolute `dynamicAddress` alone is **not** shippable. It is only the seed for Phase C.

---

## Phase C — Reverse pointer trace + AOB isolation (read-only)

### C1. Pointer reverse

From the surviving `dynamicAddress`:

1. Walk upward for pointers that land on (or near) the value address (standard pointer-scan: levels 1–N, max depth consistent with schema `pointerChain` max 32).
2. Prefer chains that root in the **main module** (`Avowed-WinGDK-Shipping.exe` / `Avowed.exe`) or a stable game module — not ephemeral heap-only roots.
3. Normalize offsets to **decimal nonnegative integers** for schema `pointerChain` (example: `+0x18` → `24`).
4. Record draft resolution:

```text
moduleName + baseOffset  →  deref chain via pointerChain[]  →  value
```

### C2. AOB (signature) isolation

When static `baseOffset` drifts across patches, capture an **exact AOB** near the static pointer load:

1. Dump bytes around the static slot / RIP-relative load that feeds the chain.
2. Mask volatile bytes with `?` (schema example form: `"48 8B 05 ? ? ? ?"`).
3. Confirm a **single** (or bounded unique) match in the module for this build.
4. Store as `resolution.signature`. Solith tries signature **before** static pointer path; fuzzy AOB is for drift recovery only after exact match fails — do not rely on fuzzy alone for first cert.

### C3. Capture checklist before any write

- [ ] Initial dynamic address (Session A)
- [ ] Reverse pointer chain with module-relative root
- [ ] Optional AOB `signature` with uniqueness note
- [ ] Draft JSON matching `MemoryFeatureResolutionV1` (blank template below, filled with real hex — never placeholders in evidence)

---

## Phase D — Safe probe (write allowed only here)

Only after Phase C yields one primary candidate:

1. Read current value → confirm HUD match.
2. Single approved probe write (small, reversible).
3. Read-back must match probe.
4. Restore original → read-back must match original.
5. Log the full resolve trace (same style as Atomfall evidence).

If restore fails: **STOP**, do not promote, document failure.

---

## Phase E — Restart verification (≥2 sessions)

1. **Fully exit** Avowed (process gone).
2. Relaunch, load save, re-attach (new PID required).
3. Resolve using **only** the draft `signature` / `baseOffset` / `pointerChain` — no re-scan shortcuts counted as L3.
4. Repeat read (and optional restore probe) — must PASS.
5. Perform a **second** full restart (Session C recommended; **minimum two** distinct PIDs after Session A).

| Session | PID changed? | Resolved VA may change? | Chain must resolve? |
|---------|--------------|-------------------------|---------------------|
| A (discovery) | — | — | Yes |
| B (restart 1) | Yes | Yes | Yes |
| C (restart 2) | Yes | Yes | Yes |

**L2** may be claimed after stable multi-read in one session.  
**L3** requires Sessions B + C (or A+B with A already using the static chain — still two successful post-discovery restarts is preferred).

---

## Phase F — Schema promotion (only after evidence file)

1. Write `Docs/Baselines/AVOWED_<FEATURE>_L3_EVIDENCE.md` (or L2) with real numbers — no TODOs.
2. Update the feature in `AVOWED_L0_DEFINITION` / seed:
   - `type`: leave `scan_unknown` until L2+; then `freeze` / `write_once` / `toggle` as appropriate
   - `certificationLevel`: `L2` or `L3`
   - `resolution`: real `moduleName`, optional `signature`, `baseOffset`, `pointerChain`
3. Prefer WinGDK module name in resolution when certifying Game Pass; keep Steam executable in `target.executables`.
4. Re-run offline cert:

```powershell
npx tsx scripts/certify-cheat.mjs --catalog-game-id avowed --level L1
```

5. Do not mark pack-level `certificationLevel` above the **minimum** feature still at L0.

---

## Blank schema.v1 resolution / feature templates

Fill with **discovered** values only. Until then, keep bundled Avowed at L0 with empty paths.

### Resolution only (`MemoryFeatureResolutionV1`)

```json
{
  "signature": "48 8B 05 ? ? ? ?",
  "moduleName": "Avowed-WinGDK-Shipping.exe",
  "baseOffset": "0x00000000",
  "pointerChain": [0, 0]
}
```

Field rules (`schema.v1.ts`):

- `signature` — optional AOB string; tried before static path
- `moduleName` — required; WinGDK shipping EXE or `Avowed.exe`
- `baseOffset` — optional `0x`-prefixed hex from module base or AOB match
- `pointerChain` — optional array of nonnegative integer offsets (decimal), max 32 entries

### Full memory feature (post-cert example shape)

```json
{
  "id": "infinite-health",
  "name": "Infinite Health",
  "category": "player",
  "type": "freeze",
  "dataType": "int32",
  "defaultValue": 9999,
  "certificationLevel": "L3",
  "resolution": {
    "signature": "48 8B 05 ? ? ? ?",
    "moduleName": "Avowed-WinGDK-Shipping.exe",
    "baseOffset": "0x00000000",
    "pointerChain": [0, 0]
  }
}
```

### Current bundled L0 shape (do not “fake-fill”)

```json
{
  "id": "infinite-health",
  "name": "Infinite Health",
  "category": "player",
  "type": "scan_unknown",
  "dataType": "int32",
  "defaultValue": 9999,
  "certificationLevel": "L0",
  "resolution": {
    "moduleName": "Avowed.exe"
  }
}
```

---

## Immediate next targets (product order)

1. **This SOP** — Avowed WinGDK live session: connection baseline + state-delta → pointer/AOB → ≥2 restarts → evidence → schema bump.
2. **Milestone X** — Terraria `.plr` commercial binary write path (wave 1), separate from Avowed memory cert.

---

## Explicit non-goals

- Promoting Avowed using `.tmp` research dumps without restart evidence
- Injecting into `Avowed-WinGDK-Shipping.exe`
- Writing into Game Pass `wgs` or Alabama config trees
- Claiming L2–L4 in `ROADMAP.md` without a baseline evidence file
- Expanding Milestone M in-process pilot to Avowed
