# B2A Freeze Lifecycle Ownership

## Ownership

Each freeze record is owned by the `webContents.id` that proposed and started
it. The record also retains the frame routing ID when Electron provides one,
the attached PID, approval token ID, and a six-hour expiry. A renderer cannot
select a PID or ownership ID through payload fields.

## Cleanup events

The main process stops records owned by a renderer on:

- `webContents.destroyed`
- `render-process-gone`
- main-frame, non-same-document `did-start-navigation`
- `will-navigate`
- `BrowserWindow.closed`

Application `before-quit` stops all records. Cleanup is idempotent and routes
to the owning `LiveMemorySession.stopFreeze()` callback. Failures transition
the registry record to `CLEANUP_FAILED` and are audited. Terminal records are
retained only for a bounded period/count so duplicate cleanup remains safe
without unbounded memory growth.

There is no reattachment protocol: reload and navigation stop the old freeze.
A new renderer receives a new `webContents.id` and cannot inherit an old
renderer's freeze. Unrelated renderers, sessions, and PIDs are not touched.
