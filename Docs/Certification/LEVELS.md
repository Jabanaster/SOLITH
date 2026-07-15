# Solith Cheat Certification Levels

Offline-first documentation for `schema.v1` feature / pack certification.

Script:
```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge"
npx tsx scripts/certify-cheat.mjs --catalog-game-id stardew-valley --level L1
npx tsx scripts/certify-cheat.mjs --file path\to\definition.json --level L1
```

| Level | Meaning | Offline gate | Live gate |
|-------|---------|--------------|-----------|
| **L0** | Draft / scan-unknown | Schema validates | — |
| **L1** | Resolution documented | Schema + resolution or save-field paths | — |
| **L2** | Attach + read verified | L1 offline | Live attach + stable read |
| **L3** | Restart-stable pointer | L1 offline | Restart-verify pass |
| **L4** | In-game evidence | L1 offline | Recorded write + gameplay evidence |

## What is offline-safe today

- Schema validation (`validateSolithDefinitionV1`)
- Resolution shape checks (`moduleName` + offset / signature / pointer chain, or `scan_unknown`)
- Save-editor backup directory safety (no `..`)
- Bundled catalog lookup via `--catalog-game-id`

## What must wait for a live session

- Connection baselines (Milestone S)
- `verify-pointer-path.mjs` live restarts (L3)
- In-game evidence capture (L4)
- Commercial binary saves without sandbox fixtures

Do not mark L2–L4 as PASS without live evidence artifacts.
