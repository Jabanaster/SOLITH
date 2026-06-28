# Milestone K Gate Commands

These are the full release evidence gates to run only after user approval.

```powershell
cd "G:\GAME TRAINER"

npx tsc --noEmit
npm run test:game-profile
npm run test:trainer-schema
npm run test:trainer-host
npm run test:milestone-e
npm run test:milestone-j
npm test
npm run build:electron
npm run build
node scripts/validate-packaged-host.mjs
node scripts/orphan-check.mjs
```

## Stop Rule

If any command fails, stop immediately and report the failing command and output. Do not continue to later gates unless explicitly authorized.

## Known Lightweight Gate Results

Already run during Milestone K planning:

- npm run test:milestone-j: PASS, 5/5
- npm run test:game-profile: PASS, 28/28
- npm run test:trainer-schema: PASS, 34/34

Full gates were not run during documentation creation.

