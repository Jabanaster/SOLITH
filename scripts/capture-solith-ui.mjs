/**
 * Captures Solith UI screenshots for branding verification.
 * Run after: npm run build:vite && npm run build:electron
 */
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'Docs', 'Reports', 'solith-branding-screenshots');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const electronApp = await electron.launch({
    args: [path.join(root, 'dist-electron', 'main.js')],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: path.join(root, '.tmp-solith-screenshot-profile'),
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForTimeout(2500);

  await page.screenshot({
    path: path.join(outDir, 'solith-dashboard-default.png'),
    fullPage: false,
  });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(outDir, 'solith-dashboard-maximized.png'),
    fullPage: false,
  });

  await electronApp.close();
  console.log(`Screenshots saved to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
