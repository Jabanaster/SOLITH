# Phase 9 — Address & Data Research Tools

**Status:** Implemented (read-only)  
**Scope:** Productize the live-memory research loop (view / hex / pointer candidates / session snapshot) without enabling new writes.  
**Boundary:** `RPM_ONLY` via existing `MemoryDriver` + attached `LiveProcessHandle`. No pid-only open shortcuts, no injection, no Cheat Engine automation.

Related: [`AVOWED_LIVE_VALIDATION_SOP.md`](./AVOWED_LIVE_VALIDATION_SOP.md) (manual live SOP; Phase 9 does not claim L2/L3).

---

## Modules

| Module | Path | Role |
|--------|------|------|
| Memory viewer | `src/core/live-memory/research/memory-viewer.ts` | Bounded region list + typed reinterpret (int32/float/…/string) |
| Hex inspector | `src/core/live-memory/research/hex-inspector.ts` | Clamped `readBuffer` window (16–4096) with hex/ASCII rows |
| Pointer candidate analysis | `src/core/live-memory/research/pointer-candidate-analysis.ts` | Scores `PointerPathCandidate`s; `moduleRootOk: 0` is valid |
| Session snapshot | `src/core/live-memory/research/session-snapshot.ts` | Watchlist / match-set serialize, diff, persist under `userData/research-sessions/` |

Hard budgets: max typed-read bytes, max region list size, max hex window, pointer report ranked cap (40). Surfaces `truncated: true` where applicable.

---

## IPC (read-only)

| Channel | Purpose | Audit |
|---------|---------|-------|
| `research:view` | Typed reads at one address | `op: read` |
| `research:hex` | Hex window | `op: read` |
| `research:pointer-analyze` | `pointerScan` + score report | `op: scan` |
| `research:snapshot-save` | Persist JSON under `userData/research-sessions/` | `op: read` when attached |
| `research:snapshot-diff` | Diff two snapshots (no memory I/O) | none |

Schemas: `electron/ipc-validation.ts`. Preload: `researchView` / `researchHex` / `researchPointerAnalyze` / `researchSnapshotSave` / `researchSnapshotDiff`.

---

## UI

Thin read-only `AddressDataResearchPanel` on **Trainer Research Lab** and **Live Memory Trainer** when attached: address bar, typed view, hex, pointer analyze, snapshot save/diff. No write controls in Phase 9.

---

## Tests

`tests/live-memory/research-tools.test.ts` — FakeMemoryDriver fixtures for viewer/hex/snapshot; pure scoring tests for pointer analyzer.

```powershell
npx tsx --test tests/live-memory/research-tools.test.ts
```

---

## Non-goals

- Promoting Avowed (or any title) above L0 without restart evidence
- Phase 10 write UX / automatic probe writes
- Full multi-GB memory dumps in snapshots (watch lists + match set ids only)
