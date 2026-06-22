# Google Email Organizer — Chrome companion

Manifest V3 companion UI for the existing FastAPI/Gmail application. It keeps AI classification and every paid secret on the backend. Phase 2 adds one-time backend pairing, isolated organizer credentials, rotating refresh support, HTTPS enforcement, and authenticated classification transport. Gmail remains read-only.

## Setup

1. Create a Google Cloud OAuth client with application type **Chrome Extension**.
2. Replace the placeholder `oauth2.client_id` in `manifest.json`. Chrome will show the extension ID after the first unpacked load; use a fixed manifest `key` or the Chrome Web Store ID when a stable ID is required by Google Cloud.
3. Ensure the Gmail API is enabled for the project.
4. Install and build:

   ```powershell
   cd extension
   npm install
   npm run build
   ```

5. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/dist`.
6. Open the extension options and confirm the FastAPI backend URL (default: `http://localhost:8000`).

For a rebuild-on-change loop, run `npm run dev`, then use the reload button on the extension card after changes.

## Backend contract

The extension expects:

- `GET /health`
- `POST /api/extension/pair`
- `POST /api/extension/auth/refresh`
- `GET /api/extension/auth/me`
- `POST /api/extension/auth/revoke`
- `POST /api/extension/classify-preview` with `{ "messages": GmailMessageSummary[] }`
- classification response shaped like `{ "jobId"?: string, "proposals"?: ClassificationProposal[] }`

All endpoints except health and pairing/refresh require the organizer bearer credential. Only subjects, sender headers, snippets, timestamps, IDs, and label IDs are sent. Full email bodies are not requested or stored. See [Extension data flow](docs/EXTENSION_DATA_FLOW.md) and [OAuth environments](docs/OAUTH_ENVIRONMENTS.md).

## Security boundaries

- Never add Gemini or other paid API keys to extension code or Chrome storage.
- The OAuth scope is `gmail.readonly`; no Gmail mutation method exists in Phase 1.
- Apply controls are intentionally disabled.
- `http://localhost:8000` is development-only. Production should use HTTPS and an authenticated backend session or short-lived backend token.
- `gmail.readonly` is restricted; keep development OAuth in Testing with named users and use separate development/production Google Cloud projects.
- Restrict, monitor, and rotate the Google OAuth/API credentials, and review requested scopes before release.
