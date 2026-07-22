# Inert Cheat Table Registry & Safe Research Framework — Status

**Status:** Active implementation baseline; phases 1-10 are present, but current dirty-tree work still requires verification before release claims.
**Master tip:** `774ff7e`
**Safety stance:** Never execute CE Auto Assembler / Lua; never auto-attach; writes remain gated + Trust Shift waiver.

```
[ Raw .CT File ]
       │
       ▼ (Phase 2 & 3)
[ Schema Validation & Compiler ]
       │
       ▼ (Phase 1)
[ Read-Only Registry & Query Layer ]
       │
       ├─────────────────────────┬─────────────────────────┐
       ▼ (Phase 4)               ▼ (Phase 5 & 6)           ▼ (Phase 7 & 8)
[ Read-Only UI Explorer ]  [ Static Research Engine ]  [ Read-Only Process Runtime ]
                                                           │
                                                           ▼ (Phase 9 & 10)
                                                    [ Gated Write Support ]
```

## Phase map

| Phase | Capability | Primary paths | Tests |
|------:|------------|---------------|-------|
| 1 | Load + inert search | `src/core/registry/load-registry.ts`, `query-registry.ts` | `tests/registry-query.test.ts` |
| 2 | Schema + SHA-256 metadata | `schema.ts`, `validate-registry.ts`, `compile-ct-registry.ts` | `tests/registry-schema.test.ts` |
| 3 | CLI inspect/search/export | `scripts/inspect-registry.mjs`, `search-registry.mjs`, `compile-ct-registry.mjs` | `tests/registry-cli.test.ts` |
| 4 | Registry Explorer UI | `src/app/pages/RegistryExplorerPage.tsx` | `tests/registry-explorer-page.test.tsx` |
| 5 | Inert CE enrichment | `src/core/script-research/ce-enrichment.ts` | `tests/ce-enrichment.test.ts` |
| 6 | Feature candidates | `src/core/research/feature-candidates.ts` | `tests/feature-candidates.test.ts` |
| 7 | Read-only runtime | `src/core/runtime/*` | `tests/runtime-readonly.test.ts`, `windows-readonly-adapter.test.ts` |
| 8 | Signature validation | `signature-validation.ts`, `signature-resolution.ts` | `tests/runtime-signature-validation.test.ts`, `signature-resolution.test.ts` |
| 9 | Research tools | `src/core/live-memory/research/*`, `src/core/runtime/memory-viewer.ts` | `tests/live-memory/research-tools.test.ts` |
| 10 | Gated writes | `live-memory/write-policy.ts`, `runtime/write-policy.ts`, Trust Shift consent | `write-policy*.test.ts`, `write-consent.test.ts` |

## CLI

```powershell
npm run registry:compile -- path\to\table.CT out\registry.json
npm run registry:inspect -- --registry out\registry.json
npm run registry:search -- --registry out\registry.json --type aob --query health
npm run registry:search -- --registry out\registry.json --symbol playerHealth --exclude-rejected
npm run runtime:validate-signatures -- --registry out\registry.json
```

## Explicit non-goals (still enforced)

- No Auto Assembler / Lua execution
- No DLL inject / code caves / kernel drivers
- No multiplayer targeting claims
- No silent privilege elevation
- Write features default **off**; ambiguous AOB matches block activation

## Addendum alignment

- CT XML ingestion: `src/core/definitions/ct-import.ts` (`CtLiveResolutionQuality`)
- Freeze = RPM/WPM loop only (`LiveMemorySession.startFreeze`)
- Trust Shift waiver replaces connection-count write blocks (`evaluateWriteConsent`)
