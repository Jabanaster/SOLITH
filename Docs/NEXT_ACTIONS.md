# Next Actions

**Updated:** 2026-06-23

## Immediate (requires terminal access)

- [ ] Run `npm test` twice consecutively — confirm both complete with all passing
- [ ] Run `npx tsc --noEmit` — confirm 0 TypeScript errors
- [ ] Run `npm run build:electron` — confirm tsup + verifier output
- [ ] Run `npm run dev` — confirm Vite + tsup watch + Electron start in one command
- [ ] Run `npm install && npx playwright install && npm run test:electron-smoke`
- [ ] Run `npm run build` — confirm full installer build
- [ ] `git init && git status --short` — review for secrets, then commit
- [ ] Delete `fix-esm-imports.mjs` and `fix-esm-imports.ps1` once confirmed not needed

## Short-term

- [ ] Implement TrainerPage UI — item cards with apply/preview
- [ ] Implement SaveEditor UI — value tree display and edit flow
- [ ] Implement DiscoveryLab UI — visual compare UI
- [ ] Implement Recipes UI — recipe cards with enable/disable
- [ ] Implement Backups UI — backup list with restore buttons
- [ ] Implement Journal UI — event timeline
- [ ] Add onboarding wizard / first-run experience
- [ ] Add safety acknowledgment dialog

---

This document tracks next actions for ResourceForge development.

## Hardening Milestone Actions
- [x] Audit the Electron Security model and delete generic file access IPC handlers (`read-file`, `write-file`, `scan-directory`).
- [x] Refactor existing save editing helper functions in `editor.ts` into a clean **Trainer Adapter Contract**.
- [x] Implement recipe runtime schema verification with version checks.
- [x] Upgrade the crash recovery routine in `operations.ts` to be evidence-driven:
  - Check current target hash, expected original hash, expected final hash, backup hash.
  - Determine whether to mark failed, mark completed, run atomic restore, or escalate to review.
- [x] Build a complete automated end-to-end integration workflow test.
- [x] Implement failure-injection tests simulating write, rename, lock, and validation failures.

## Next Milestone: ResourceForge V1 Save Detection + Parser Adapter Expansion
- [ ] Implement auto-detection pathways for common PC save folders (Saved Games, My Games, AppData, Steam Userdata).
- [ ] Expand trainer parser adapters to support packed archive formats (read-only) and structured offsets.
- [ ] Implement user interface configuration overlays.
- [ ] Add visual feedback for recovery-required states in `Backups.tsx`.
