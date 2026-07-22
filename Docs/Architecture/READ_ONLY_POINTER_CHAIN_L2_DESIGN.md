# Read-only pointer-chain L2 validation design

Solith can safely perform AOB resolution today through bounded module reads. Pointer-chain
L2 validation is intentionally stricter because real Cheat Engine pointer chains often leave
module image ranges and point into dynamic heap allocations.

## Current implemented behavior

- Validate imported pointer metadata as inert L0/L1 registry data.
- In the headless verification worker, confirm the pointer root module exists.
- Confirm the root offset is valid bounded hexadecimal.
- Classify whether the pointer root is inside the verified module image range.
- Do not dereference pointer chains.
- Do not read heap addresses.
- Do not promote pointer entries to L2/L3.

## Required before full pointer-chain L2

Full read-only pointer-chain L2 requires a native region map from `VirtualQueryEx` or an
equivalent maintained binding so Solith can prove every dereference target is inside a
committed readable region before reading pointer-sized bytes.

The L2 pointer resolver must:

- use the already explicitly selected process session;
- use read/query-only process access;
- reject protected targets before reading;
- validate each computed address for integer overflow;
- verify every address with a committed readable memory-region map;
- cap total dereference steps and bytes read;
- return structured errors for inaccessible, guarded, freed, or ambiguous regions;
- never write memory;
- never treat a single successful dereference as restart-stable L3.

Until that region-map layer exists, pointer-chain validation remains a read-only preflight
classification, not L2 certification.
