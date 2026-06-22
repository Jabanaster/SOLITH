# Google OAuth environment setup

## Development

1. Build and load `dist` from `chrome://extensions` with Developer mode enabled.
2. Copy the extension ID shown on its extension card.
3. In a dedicated development Google Cloud project, enable Gmail API and configure an OAuth client for that extension ID.
4. Replace the OAuth client placeholder in `manifest.json`, rebuild, and reload the extension.
5. Keep the OAuth consent screen in **Testing** and add each developer account as a named test user.

An unpacked extension's ID can change if its identity is not stabilized. Configure a stable manifest key or the eventual store identity before depending on the ID.

## Production

Use a separate Google Cloud project and OAuth client for production. Production must use its real extension ID and HTTPS backend/dashboard origins. Never reuse development credentials or test-user configuration as production configuration.

`gmail.readonly` is a restricted Gmail scope. A public release may require Google OAuth verification. Sending Gmail-derived subjects, sender headers, snippets, or other restricted data to a backend can increase verification requirements and may require a security assessment. Review the current Google Workspace API User Data Policy before release.

Do not request `gmail.modify` until mutation features are implemented, user-visible, explicitly approved, tested, and ready for verification. Phase 2 remains read-only.
