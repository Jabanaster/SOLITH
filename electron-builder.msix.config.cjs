// electron-builder config for the Microsoft Store / MSIX (AppX) packaging
// target. Parallel to, and independent of, package.json's "build" block
// (which stays NSIS-only for normal dev/direct-download builds) — this file
// is only consulted when explicitly invoked via
// `electron-builder --config electron-builder.msix.config.cjs` (see the
// "build:msix" npm script). Loading this file never mutates or replaces the
// NSIS target.
//
// Store identity (identityName/publisher/publisherDisplayName) comes
// exclusively from SOLITH_MSIX_IDENTITY_NAME / SOLITH_MSIX_PUBLISHER /
// SOLITH_MSIX_PUBLISHER_DISPLAY_NAME at build time — never hardcoded here.
// scripts/check-msix-identity-env.mjs already fails the npm script before
// electron-builder even runs; the throw below is defense-in-depth for
// anyone invoking electron-builder directly against this config file
// without going through that script first.
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const baseBuildConfig = pkg.build ?? {};

const REQUIRED_ENV = [
  'SOLITH_MSIX_IDENTITY_NAME',
  'SOLITH_MSIX_PUBLISHER',
  'SOLITH_MSIX_PUBLISHER_DISPLAY_NAME',
];

module.exports = function buildMsixConfig() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name] || process.env[name].trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `BLOCKED — STORE IDENTITY REQUIRED. Missing env var(s): ${missing.join(', ')}. ` +
      'Set them from Microsoft Partner Center before building the MSIX/AppX target. ' +
      'Run "npm run build:msix" (not electron-builder directly) to get the full check.',
    );
  }

  return {
    ...baseBuildConfig,
    // NSIS-specific block from the base config is irrelevant to this
    // target; leaving it present is harmless (electron-builder ignores
    // target-specific blocks for targets that are not selected).
    win: {
      ...baseBuildConfig.win,
      target: ['appx'],
    },
    appx: {
      identityName: process.env.SOLITH_MSIX_IDENTITY_NAME,
      publisher: process.env.SOLITH_MSIX_PUBLISHER,
      publisherDisplayName: process.env.SOLITH_MSIX_PUBLISHER_DISPLAY_NAME,
      applicationId: process.env.SOLITH_MSIX_APPLICATION_ID || undefined,
      displayName: pkg.build?.productName ?? 'Solith',
      backgroundColor: '#464646',
      languages: ['en-US'],
      // runFullTrust is required for any Electron app and is auto-added by
      // electron-builder even if omitted; listed explicitly for clarity
      // about what this package declares to Windows.
      capabilities: ['runFullTrust'],
    },
  };
};
