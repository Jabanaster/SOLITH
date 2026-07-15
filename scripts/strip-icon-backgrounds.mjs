#!/usr/bin/env node
/**
 * Remove near-white backgrounds from branding PNGs (add alpha channel).
 * Usage: node scripts/strip-icon-backgrounds.mjs [file.png ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandingDir = path.join(__dirname, '..', 'src', 'app', 'assets', 'branding');

const DEFAULT_FILES = [
  'solith-save-tools.png',
  'solith-trainer-controller.png',
  'solith-emblem.png',
];

function isBackgroundPixel(r, g, b, a, lightThreshold = 248, darkThreshold = 18) {
  if (a < 8) return true;
  if (r >= lightThreshold && g >= lightThreshold && b >= lightThreshold) return true;
  if (r <= darkThreshold && g <= darkThreshold && b <= darkThreshold) return true;
  return false;
}

async function stripBackground(inputPath, outputPath) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (isBackgroundPixel(r, g, b, a)) {
      pixels[i + 3] = 0;
    }
  }

  await sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  const meta = await sharp(outputPath).metadata();
  console.log(`Wrote ${path.basename(outputPath)} ${meta.width}x${meta.height} alpha=${meta.hasAlpha}`);
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : DEFAULT_FILES;

  for (const file of files) {
    const input = path.isAbsolute(file) ? file : path.join(brandingDir, file);
    if (!fs.existsSync(input)) {
      console.warn(`Skip missing: ${input}`);
      continue;
    }
    const tmp = input.replace(/\.png$/i, '.tmp.png');
    await stripBackground(input, tmp);
    fs.renameSync(tmp, input);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
