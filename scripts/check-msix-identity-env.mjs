#!/usr/bin/env node
// Fails closed, with a clear message, when Store/MSIX packaging is
// requested without the owner-supplied Partner Center identity values.
// These three env vars are the ONLY source for identity/publisher strings
// used by the msix build — nothing here or in
// electron-builder.msix.config.cjs ever hardcodes a placeholder that could
// pass as real Store identity.
const REQUIRED_VARS = [
  ['SOLITH_MSIX_IDENTITY_NAME', 'Partner Center package Identity Name (Identity.Name in the AppX manifest)'],
  ['SOLITH_MSIX_PUBLISHER', 'Partner Center Publisher (CN=... from your Partner Center / code-signing certificate identity)'],
  ['SOLITH_MSIX_PUBLISHER_DISPLAY_NAME', 'Partner Center Publisher Display Name'],
];

const missing = REQUIRED_VARS.filter(([name]) => !process.env[name] || process.env[name].trim() === '');

if (missing.length > 0) {
  console.error('[msix-identity] BLOCKED — STORE IDENTITY REQUIRED');
  console.error('[msix-identity] The following environment variables must be set before building an MSIX/AppX package:');
  for (const [name, description] of missing) {
    console.error(`  - ${name}: ${description}`);
  }
  console.error('[msix-identity] These values come from Microsoft Partner Center for this app\'s Store listing.');
  console.error('[msix-identity] They are never invented or defaulted by this build — set them, or do not run build:msix.');
  process.exit(1);
}

console.log('[msix-identity] All required Store identity environment variables are present.');
