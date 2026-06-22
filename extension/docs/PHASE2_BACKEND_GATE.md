# Phase 2 backend completion gate

The FastAPI/SQLite source is not present in this workspace. The extension now requires the following server behavior before Phase 2 can be considered complete or exercised end to end:

- Authenticated dashboard-only pairing-code creation and device management routes.
- Hashed, expiring, single-use pairing codes consumed atomically.
- Short-lived access JWTs with validated issuer, audience, subject, session ID, token ID, timestamps, and organizer scopes.
- Hashed rotating refresh tokens with reuse detection and server-side device revocation.
- Explicit dashboard and extension CORS origin allowlists, production configuration validation, request-size limits, rate limiting, safe audit events, and cleanup jobs.
- User ownership predicates in every scan/classification query.
- Authentication on `/api/extension/classify-preview` and all other non-health extension data routes.
- Configurable classification-input retention and deletion.
- Backend tests proving unauthenticated rejection, token validation, atomic one-time pairing, refresh rotation/reuse behavior, device ownership, resource ownership, CORS, and HTTPS production settings.

The browser client contract currently used is documented in the root README. Credentials use `access_token` and `refresh_token` response fields. `/api/extension/auth/me` must return the safe `BackendSessionInfo` shape declared in `src/lib/types.ts`.

Do not weaken the extension to accommodate an unauthenticated backend. Add the existing backend repository to this workspace and implement these controls within its current authentication, database, and migration conventions.
