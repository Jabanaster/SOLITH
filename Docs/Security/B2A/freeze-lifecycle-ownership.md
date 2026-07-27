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
to a direct callback retained with the owning record, rather than looking up a
renderer bundle at cleanup time. Session disposal first asks the registry to
stop its records, then detaches the session; a missing or disposed cleanup
owner fails closed to `CLEANUP_FAILED` instead of reporting successful cleanup.
Failures transition the registry record to `CLEANUP_FAILED` and are audited.
Lifecycle audit events use a process-wide fallback `MemoryAuditLog` when the
renderer bundle has already been removed. Terminal records are retained only
for a bounded period/count so duplicate cleanup remains safe without
unbounded memory growth.

If a legacy active session is found without a registry ownership record, the
explicit stop handler stops it directly and audits an unowned legacy stop
instead of leaving an orphaned freeze running.

There is no reattachment protocol: reload and navigation stop the old freeze.
A new renderer receives a new `webContents.id` and cannot inherit an old
renderer's freeze. Unrelated renderers, sessions, and PIDs are not touched.
