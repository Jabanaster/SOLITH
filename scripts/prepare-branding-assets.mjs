#!/usr/bin/env node
/**
 * Resize/crop branding sources to production masters:
 *   - solith-banner-backdrop.png → 1920×420 (banner)
 *   - solith-shell-background.png → 1920×1080 (page shell)
 *
 * Usage: node scripts/prepare-branding-assets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandingDir = path.join(__dirname, '..', 'src', 'app', 'assets', 'branding');

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    console.error('sharp is required: npm install --save-dev sharp');
    process.exit(1);
  }
}

async function resizeCover(sharp, input, output, width, height) {
  await sharp(input)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 6, quality: 92 })
    .toFile(output);
  const meta = await sharp(output).metadata();
  console.log(`Wrote ${path.basename(output)} ${meta.width}x${meta.height} (${fs.statSync(output).size} bytes)`);
}

async function main() {
  const sharp = await loadSharp();
  const bannerSrc = path.join(brandingDir, 'solith-banner-backdrop.png');
  const shellSrc = path.join(brandingDir, 'solith-shell-background.png');
  const bannerOut = path.join(brandingDir, 'solith-banner-backdrop-1920.png');
  const shellOut = path.join(brandingDir, 'solith-shell-background-1920.png');

  if (!fs.existsSync(bannerSrc) || !fs.existsSync(shellSrc)) {
    console.error('Missing source branding PNGs in src/app/assets/branding/');
    process.exit(1);
  }

  await resizeCover(sharp, bannerSrc, bannerOut, 1920, 420);
  await resizeCover(sharp, shellSrc, shellOut, 1920, 1080);

  // Replace canonical filenames used by the app
  fs.copyFileSync(bannerOut, path.join(brandingDir, 'solith-banner-backdrop.png'));
  fs.copyFileSync(shellOut, path.join(brandingDir, 'solith-shell-background.png'));
  console.log('Updated canonical solith-banner-backdrop.png and solith-shell-background.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
