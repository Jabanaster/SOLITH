# SOLITH Game Bar Transport Certification

Date: 2026-07-29

Status: **GAME BAR SOLITH TRANSPORT — VERIFIED**

This record covers only the authenticated communication boundary between the
installed `WispGameBarWidget` package and the SOLITH Electron process. The
previous Game Bar setup/runtime certification remains unchanged and is
retained at
`evidence/runtime/2026-07-29/GAME_BAR_RUNTIME_CERTIFICATION.md`.

## Boundary

- Electron binds an ephemeral port on IPv4 loopback (`127.0.0.1`) only.
- The only operational route is `POST /v1/wisp/ping`; authenticated
  `GET /health` is diagnostic-only.
- Each SOLITH launch creates a new 256-bit random bearer token and UUID
  session identifier.
- Discovery is written to the widget package's current-user `LocalState`.
- The discovery file ACL permits only the current user, SYSTEM,
  Administrators, and the exact widget AppContainer SID.
- The token is written only after the temporary file receives its restrictive
  ACL, then the file is atomically published.
- Requests require a current session identifier, bounded timestamp, and
  one-use nonce. Replays and stale requests are rejected.
- A short-window rate limit bounds request volume.
- No generic command dispatch, shell, file access, Electron IPC relay, process
  attach, memory operation, or trainer action is exposed.
- The widget rereads discovery for every request and converts transport
  failures into controlled user-facing status messages.
- The UI suppresses duplicate concurrent ping requests and holds a one-second
  cooldown after completion so normal UI use remains below the server rate
  limit.

## Automated verification

| Check | Result |
| --- | --- |
| Focused Game Bar transport/server/widget-source tests | PASS — 10/10 |
| Companion plus transport regression tests | PASS — 18/18 |
| Strict targeted TypeScript validation | PASS |
| Electron bundle | PASS |
| Electron output verification | PASS — 29/29 |
| Renderer production build | PASS |
| Widget x64 Debug build/package | PASS |
| MSIX signature verification | PASS — 0 warnings, 0 errors |
| `git diff --check` | PASS |
| Repository Electron TypeScript gate | INCOMPLETE — 43 existing diagnostics across 15 files; 0 transport diagnostics |

Package SHA-256:

Version: `0.1.0.1`

`090EF02ADE2C2EE92B3C9BEEBF0E83988BC7B125D669FCEB28F49BC2D90A140E`

## Live boundary probes

| Probe | Expected | Actual | Result |
| --- | --- | --- | --- |
| Listener address | `127.0.0.1` only | `127.0.0.1` | PASS |
| Port allocation | Ephemeral | `50105`, `54754`, and `51123` on observed launches | PASS |
| Missing bearer token | Reject | HTTP 401 | PASS |
| Incorrect bearer token | Reject | HTTP 401 | PASS |
| Valid authenticated ping | Accept | HTTP 200 | PASS |
| Replayed nonce | Reject | HTTP 409 | PASS |
| Stale timestamp | Reject | HTTP 400 | PASS |
| Graceful Electron shutdown | Delete discovery | Discovery deleted | PASS |
| Electron restart | Rotate session and token | Both rotated | PASS |
| Prior-launch token after restart | Reject | HTTP 401 | PASS |
| Discovery ACL | Exact approved principals | User, SYSTEM, Administrators, exact AppContainer SID | PASS |

No token or private key material is retained in this evidence.

## Manual integration checks

| Check | Status |
| --- | --- |
| Installed widget reads current discovery file | PASS after AppContainer SID correction |
| Widget authenticates to real SOLITH process | PASS |
| SOLITH unavailable path remains controlled | PASS — no crash |
| Widget reconnects after SOLITH restart | PASS — no reinstall required |
| Duplicate rapid clicks remain below transport rate limit | PASS after one-second cooldown |

## Defects found and retested

1. Initial live authentication failed with `SOLITH is unavailable.` The
   discovery ACL contained an incorrect hard-coded AppContainer SID. Windows'
   current-user AppContainer mapping proved the installed widget SID was
   `S-1-15-2-1450989936-3768333357-2179290931-1547239158-1553198993-1657222907-796510196`.
   The fix derives the SID deterministically from the lowercased package
   family name. The ACL remains restricted to the same four exact principals.
   Retest: PASS.
2. Approximately 20 rapid sequential clicks reached the server's intentional
   20-request/10-second limit and produced `SOLITH transport rejected the
   request.` The client originally suppressed only overlapping requests. The
   fix keeps `_pingInFlight` active through a one-second cooldown; the server
   limit is unchanged. Package identity was advanced from `0.1.0.0` to
   `0.1.0.1`. Retest with approximately 20 rapid clicks: PASS.

Evidence:

- `real-solith-authenticated-ping.png`
- `rapid-click-rate-limit-failure-before-fix.png`
- `rapid-click-success-after-cooldown-fix.png`

## Promotion rule

All promotion conditions passed on the installed package.
