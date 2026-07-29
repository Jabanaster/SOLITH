# Legacy Freeze-Start API — Compatibility Decision

## Decision: REMOVED (not deprecated-in-place, not kept as a wrapper)

The legacy `liveMemoryFreezeStart({address, dataType, value, intervalMs})`
preload signature has been **replaced outright** by
`liveMemoryFreezeStart({proposalId, consentToken})`. No renderer code ever
successfully used the legacy signature in production (it was broken against
the IPC schema from the moment that schema was introduced), so there was no
working call path to preserve compatibility with. All 3 known call sites
(`LiveMemoryTrainerPage.tsx` x2, `useGameCheatSession.ts` x1) were migrated in
this same cycle to the propose -> request-consent -> start sequence.

A typed wrapper that internally performed propose/consent/start under the old
single-call signature was considered and rejected: it would have to silently
auto-approve consent (defeating the entire point of the privileged consent
dialog) or block synchronously on a dialog inside what was previously a
single fire-and-forget call, which does not compose with the existing
single-button "Start Freeze" UX. Instead, the UI's existing single-button
click handler internally performs the 3-step sequence (see
production-freeze-protocol.md and renderer-flow-matrix.csv) — the user-visible
experience is unchanged (one click, one native consent dialog, freeze
starts), only the internal call sequence changed.

## Why removal (not fail-closed migration error)

The task instructions preferred removing the obsolete signature "if all call
sites can be migrated safely." All 3 call sites were internal to this
repository (no external consumers of the preload API — `contextBridge`
exposes it only to this app's own renderer bundle, never to third-party
code), so a fail-closed migration shim was unnecessary complexity for no
compatibility benefit.
