# Extension data flow and retention boundary

```text
Gmail API
  -> MV3 service worker (Gmail OAuth token remains here)
  -> minimized message metadata
  -> authenticated FastAPI classification endpoint
  -> server-side Gemini classification
  -> user-owned proposals
  -> popup / side-panel UI
```

## Data sent for classification

The service worker requests Gmail's metadata representation and sends only Gmail message and thread IDs, Subject and From headers, received timestamp, a short Gmail-provided snippet, and existing label IDs. It does not request or persist full message bodies. It does not put email-derived data in URLs, logs, analytics, or crash reporting. Gemini remains server-side.

## Authentication separation

The Gmail OAuth access token is held by Chrome Identity and requested by the service worker only for Google API calls. It is never sent to FastAPI.

The organizer access token is stored in `chrome.storage.session` and disappears with the browser session. A rotating organizer refresh token is stored in `chrome.storage.local` so the paired device can survive browser restarts. Only service-worker modules read it; React pages receive connection status and safe device/session metadata, never credentials.

Chrome local storage is not a hardware-backed secret store. Malware, a compromised browser profile, a compromised extension update, or a user with local profile access may recover the refresh credential. Server-side rotation, reuse detection, short expiration, device revocation, and least-privilege scopes are therefore required. Changing the backend origin clears both organizer credentials.

## Persistence and deletion

- Extension settings, latest scan status, and the rotating refresh credential persist locally.
- Organizer access tokens are session-only.
- Gmail access tokens remain managed by Chrome Identity.
- The backend must apply its configured classification-input retention period and provide deletion of stored inputs. That backend implementation is not present in this workspace and cannot be verified here.
- Disconnect requests device revocation and clears local credentials even if the backend cannot be reached.

No Gmail mutation is available in Phase 2.
