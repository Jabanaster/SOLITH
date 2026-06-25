# KI-013 Resolution Report

## Status

`RESOLVED` for non-user-data engineering scope.

## Root Cause

`get-recipes` returned `TrainerItem` objects built by `recipeToTrainerItem()`, but that mapper collapsed controls to `toggle|number` only. Slider and dropdown UI branches existed in renderer code but were unreachable via the production IPC path.

## Implementation

- Extended `create-recipe` IPC schema in `electron/ipc-validation.ts` with validated control fields:
  - `inputType`, `minimum`, `maximum`, `step`, `unit`, `options`, `resetValue`, `maxLength`, `pattern`
- Added slider/dropdown runtime validation rules:
  - Slider requires finite `minimum < maximum` and positive finite `step`
  - Dropdown requires 1-50 options, non-empty labels, scalar values, unique option values
- Extended recipe persistence shape in `src/core/recipes/index.ts` and DB schema columns in `src/core/database/index.ts`
- Updated recipe mapper (`recipeToTrainerItem`) to preserve persisted `inputType`, slider bounds/step/unit, and dropdown options
- Extended Workshop authoring flow in `src/app/pages/DiscoveryLab.tsx` to configure control type and slider/dropdown fields before save
- Improved Trainer rendering in `src/app/components/TrainerCard.tsx` to consume structured dropdown options and slider step/unit

## Verification

- `npm run build:electron` → PASS (18/18 verifier)
- `npm run test:trainer-states` → PASS (15/15), includes:
  - `controls-03` slider reachable through IPC and persistence
  - `controls-04` dropdown reachable through IPC and persistence
- `npm test` → PASS (108/108)
- `npx tsc --noEmit` → PASS

## Remaining Limits

- Writable real-world compatibility pilot remains blocked pending structured Tier-1 user-provided save evidence.
