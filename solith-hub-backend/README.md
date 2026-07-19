# Solith Definition Hub Backend

Cloudflare Workers + D1 API for opt-in distribution of community-authored
Solith `schema.v1` definitions.

Phase 1 implements the remote trust boundary only. The Electron client is not
wired to this service yet.

## Safety model

- New submissions are always stored as `L0_Community`.
- Client-supplied certification fields are stripped recursively.
- Submitted definitions are forced to require approval and offline confirmation.
- Only the authenticated admin endpoint can promote a row to `L3_Certified`.
- No executables, DLLs, save files, or arbitrary binary payloads are accepted.

## Local development

```powershell
cd "G:\ACTIVE_PROJECTS\ResourceForge\solith-hub-backend"
npm install
Copy-Item ".dev.vars.example" ".dev.vars"
```

Set a long random `ADMIN_TOKEN` in `.dev.vars`, then initialize local D1:

```powershell
npm run db:migrate:local
npm run dev
```

The local Worker is normally available at `http://localhost:8787`.

```powershell
Invoke-RestMethod "http://localhost:8787/health"
Invoke-RestMethod "http://localhost:8787/catalog/sync?since=1970-01-01T00%3A00%3A00.000Z"
```

## Test and type-check

```powershell
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

## Create and deploy the Cloudflare resources

Authenticate Wrangler if needed:

```powershell
npx wrangler login
```

Create the production D1 database:

```powershell
npm run db:create
```

Wrangler prints the real D1 UUID. Replace the local-only
`database_id` value in `wrangler.jsonc` with that UUID. Do not invent or guess
the production UUID.

Store the admin token as an encrypted Worker secret:

```powershell
npx wrangler secret put ADMIN_TOKEN
```

Apply the migration remotely, then deploy:

```powershell
npm run db:migrate:remote
npm run deploy
```

Verify the URL printed by Wrangler:

```powershell
$hubUrl = "https://your-worker-hostname"
Invoke-RestMethod "$hubUrl/health"
Invoke-RestMethod "$hubUrl/catalog/sync?since=1970-01-01T00%3A00%3A00.000Z"
```

Stop after this verification and provide the deployed Worker URL before any
Phase 2 Electron sync work begins.

## API

### `GET /catalog/sync?since=<ISO-8601>`

Returns at most 100 definitions with `updated_at` newer than `since`, ordered
oldest first. Use `next_since` for the next delta request. `has_more: true`
means another request is required.

### `POST /submit`

Request:

```json
{
  "game_id": "atomfall",
  "executable_hash": "64-character-lowercase-or-uppercase-sha256",
  "definition_payload": {
    "schemaVersion": 1,
    "id": "atomfall",
    "title": "Atomfall",
    "target": {
      "executables": ["Atomfall_dx12.exe"],
      "arch": "x64"
    },
    "safety": {
      "requiresApproval": true,
      "requiresOfflineConfirm": true
    }
  }
}
```

The server always inserts `cert_level = 'L0_Community'`.

### `POST /admin/promote`

Requires:

```text
Authorization: Bearer <ADMIN_TOKEN>
```

Request:

```json
{
  "id": "definition-uuid-or-ulid"
}
```

The endpoint promotes only an existing row and updates its `updated_at`
timestamp.
