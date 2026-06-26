# Trainer List Performance

## Measurement Source

- Existing automated benchmark suite: `tests/performance.e2e.test.ts`
- Command: `npm run test:performance`

## Current Measured Baseline

- `getRecipes` data load with 3 items: median 4ms
- Trainer hash-navigation + settle: median 314ms
- No renderer freezes in measured flow

## Decision

No pagination or virtualization was added in this pass.

Reason: the measured baseline remains responsive for current fixture sizes, and there is no audited production evidence yet that list rendering with 1000+ real trainer cards regresses hard enough to justify the extra complexity.

## Remaining Work

- Add synthetic high-cardinality fixture generation and benchmark runs for 100 / 500 / 1000 / 5000 items in CI-friendly mode.
- Re-evaluate pagination vs virtualization after those measurements.
