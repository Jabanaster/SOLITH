# B2A Freeze Consent Design

## Authorization boundary

Freeze start now requires a main-process proposal, native confirmation, and
single-use approval token. The proposal preview contains the exact operation
details but never token material. The confirmation provider is injected into
the server-side store; the renderer's compatibility-shaped boolean cannot
authorize an operation.

The token is opaque server-stored state, generated with 32 random bytes. No
secret is persisted and no HMAC is needed: the token is useful only while its
record exists in the main process. `consume()` removes the record before
checking its binding, making concurrent double use fail closed.

## Binding and expiry

The binding includes operation (`live-memory-freeze-start`), PID, executable
identity, address, data type, value, interval, maximum duration, and renderer
ID. For start, the main process builds the expected binding from the request's
address/data/value/timing fields plus the currently attached PID and
executable identity and the requesting `event.sender.id`; it never derives
the expected binding from the token record. Address/data type/value mismatches
return `target_mismatch`; PID or process identity mismatches return
`pid_mismatch`. Consent expires after 60 seconds.
Consumed and expired token histories are retained for two TTLs and bounded by
a FIFO maximum, preserving replay detection during the retention window.

The maximum freeze duration is independently clamped to six hours in the main
process and enforced by the session scheduler.

## Audit and redaction

Proposal, approval, rejection, execution, replay, expiry, and cleanup events
are written through `MemoryAuditLog`. Lifecycle events use a process-wide
fallback audit log when the renderer session bundle has already been
disposed. Token IDs in audit data use the first-four-characters plus
`…redacted` representation. Raw token material is returned only to the
approving renderer and is never included in previews, audit records, or error
strings.
