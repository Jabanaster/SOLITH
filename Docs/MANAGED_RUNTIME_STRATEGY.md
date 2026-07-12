# Managed Runtime Strategy (Solith)

**Status:** Research / decision document — not a shipping commitment  
**Last updated:** 2026-07-12  
**Related:** KI-018 (generic pointer scan fails on .NET/Mono), Milestone Z

---

## Problem

Many single-player titles ship on **.NET / Mono** (e.g. Stardew Valley, some Unity IL2CPP-adjacent stacks). Solith's live memory stack uses **ReadProcessMemory / WriteProcessMemory** against native module bases and pointer chains. Managed heaps relocate objects; static module offsets and generic reverse pointer scans often **do not** resolve stable addresses without runtime metadata.

**Today:** Save-field editing is the accepted path for Stardew (`stardew-money`, `stardew-stamina`, etc.). Live memory for managed games is **not** advertised as verified.

---

## Goals

1. Never claim live memory works on a managed title without L3+ evidence.
2. Prefer **save-first** when save paths are verified and safer.
3. If live memory is pursued, use **documented, bounded** techniques — no injection, no anti-cheat interaction.

---

## Options evaluated

| Approach | Pros | Cons | Solith stance |
|----------|------|------|---------------|
| **Save-field editing** | Stable, offline, already accepted for Stardew | Not real-time | **Default for .NET save-backed games** |
| **Module + AOB + pointer chain** | Works on native x64 games | Unreliable on managed heaps | **Ship for native only** |
| **Mono domain enumeration** | Can find managed roots | Complex, version-sensitive, high maintenance | **Spike only (Milestone Z)** |
| **IL2CPP metadata tools** | Some Unity titles | Per-game, out of scope for generic trainer | **Not planned for v2** |
| **External debugger attach** | Precise | Risk, scope creep, user friction | **Out of scope** |

---

## Decision (current)

```
MANAGED_LIVE_MEMORY_DEFAULT = save_first
MANAGED_LIVE_MEMORY_UI      = Advanced Scan Mode (expert, unsupported badge)
MONO_ROOT_ENUMERATION       = spike_only — no production toggle until L3 proof
```

### User-facing rules

- Catalog entries for managed-heavy games show **save controls** as primary; memory features stay `community` or `scan_unknown` until certified.
- Advanced Scan Mode remains available for power users with explicit offline confirmation — results are **session-local** unless restart-verified.
- Stardew: continue expanding **save-field** controls only within accepted milestone scope; do not add unverified skill XP or inventory live edits.

---

## Spike checklist (Milestone Z — when authorized)

1. Detect `mono-2.0-bdwgc.dll` / `GameAssembly.dll` in target process module list.
2. Read-only enumeration: list domains/assemblies (no writes).
3. Attempt single known field (fixture or test harness) → compare with save-field value.
4. Document failure modes per game patch.
5. Publish go/no-go: ship managed resolver vs permanent save-first.

**Exit criteria for "go":** One managed title with ≥1 restart-verified L3 cheat using the spike technique, plus guard + rollback tests.

---

## Non-goals

- DLL injection into Mono/Unity player
- Hooking `mono_jit` or game update loops
- Bypassing Easy Anti-Cheat / BattlEye / equivalent
- Multiplayer session targeting

---

## References in repo

- `src/core/live-memory/feature-resolver.ts` — resolution order (static → AOB → scan)
- `src/core/definitions/schema.v1.ts` — `certificationLevel`, forbidden inject types
- `scripts/verify-pointer-path.mjs` — restart ritual (native games)
- `Docs/Plans/SOLITH_PINNACLE_MASTER_PLAN.md` — Milestone Z
