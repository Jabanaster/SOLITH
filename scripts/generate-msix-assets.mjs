#!/usr/bin/env node
// Derives the Microsoft Store / MSIX tile assets electron-builder's "appx"
// target expects (build/appx/*.png) from SOLITH's existing app icon
// (public/solith-icon.png). This does NOT invent new brand direction — it
// resizes/pads the real icon already shipped in NSIS builds onto each
// required Store tile canvas. If SOLITH ever gets dedicated Store artwork,
// drop replacement PNGs directly into build/appx/ and this script becomes a
// no-op fallback (it only writes a file that does not already exist).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ICON = path.join(ROOT, 'public', 'solith-icon.png');
const OUT_DIR = path.join(ROOT, 'build', 'appx');

// Matches AppXOptions.backgroundColor's own default (#464646) so tiles read
// consistently whether electron-builder falls back to its own default or
// picks up ours from the msix config.
const TILE_BACKGROUND = { r: 0x46, g: 0x46, b: 0x46, alpha: 1 };

// name -> [width, height]. These four are exactly what AppxTarget.js's
// vendorAssetsForDefaultAssets maps electron-builder's generic sample tiles
// to when build/appx/<name> is absent; supplying real ones here means the
// packaged Store submission carries actual SOLITH branding instead of
// electron-builder's placeholder sample art.
const REQUIRED_TILES = {
  'StoreLogo.png': [50, 50],
  'Square44x44Logo.png': [44, 44],
  'Square150x150Logo.png': [150, 150],
  'Wide310x150Logo.png': [310, 150],
};

async function main() {
  if (!fs.existsSync(SOURCE_ICON)) {
    console.error(`[msix-assets] Source icon not found: ${SOURCE_ICON}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let wrote = 0;
  let skipped = 0;

  for (const [fileName, [width, height]] of Object.entries(REQUIRED_TILES)) {
    const outPath = path.join(OUT_DIR, fileName);
    if (fs.existsSync(outPath)) {
      // Deliberately non-destructive: real Store artwork dropped in later
      // must never be silently overwritten by this derived fallback.
      skipped++;
      continue;
    }
    await sharp(SOURCE_ICON)
      .resize(width, height, { fit: 'contain', background: TILE_BACKGROUND })
      .flatten({ background: TILE_BACKGROUND })
      .png()
      .toFile(outPath);
    wrote++;
  }

  console.log(`[msix-assets] wrote ${wrote} tile(s), skipped ${skipped} already-present file(s) in ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((error) => {
  console.error('[msix-assets] generation failed:', error);
  process.exit(1);
});
