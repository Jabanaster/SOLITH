#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const winUnpackedDir = path.join(root, 'dist', 'win-unpacked');
const resourcesDir = path.join(winUnpackedDir, 'resources');
const asarPath = path.join(resourcesDir, 'app.asar');
const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');

let tmpDir = null;
let exitCode = 0;

try {
  // 1. Validate win-unpacked resources directory and app.asar
  if (!fs.existsSync(winUnpackedDir)) {
    console.error(`[asar-verify] REJECTED: Win-unpacked directory not found at ${winUnpackedDir}`);
    exitCode = 1;
  } else if (!fs.existsSync(asarPath)) {
    console.error(`[asar-verify] REJECTED: Packaged ASAR not found at ${asarPath}`);
    exitCode = 1;
  } else {
    // 2. Generate isolated, prefix-validated temp directory using mkdtempSync
    const tmpPrefix = path.join(os.tmpdir(), 'solith-asar-verify-');
    tmpDir = fs.mkdtempSync(tmpPrefix);
    if (!tmpDir.startsWith(os.tmpdir()) || !path.basename(tmpDir).startsWith('solith-asar-verify-')) {
      throw new Error(`Invalid temp directory path generated: ${tmpDir}`);
    }

    // 3. Programmatic extraction via lockfile-pinned @electron/asar (v3.4.1)
    const asarModule = await import('@electron/asar');
    const asar = asarModule.default || asarModule;
    asar.extractAll(asarPath, tmpDir);

    // 4. Verify build manifest inside extracted ASAR
    const manifestPath = path.join(tmpDir, 'dist-electron', 'solith-build-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      console.error('[asar-verify] REJECTED: solith-build-manifest.json missing inside ASAR.');
      exitCode = 1;
    } else {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.buildMode !== 'production' || manifest.consentOverrideEnabled !== false || manifest.wispOverlayEnabled !== false) {
        console.error(`[asar-verify] REJECTED: ASAR contains non-production manifest: mode=${manifest.buildMode}, wispOverlayEnabled=${manifest.wispOverlayEnabled}`);
        exitCode = 1;
      }
    }

    const forbiddenGeneral = [
      '__SOLITH_TEST_BUILD_MARKER__',
      'SOLITH_PRIVILEGED_CONSENT',
      'auto-approve',
      'auto-deny',
    ];

    const forbiddenOverlayChannels = [
      'wisp-overlay-toggle',
      'wisp-overlay-hide',
      'wisp-overlay-set-expanded',
      'wisp-overlay-move-by',
      'wisp-overlay-set-interactive',
      'registerWispOverlayIpc',
      'showWispOverlay',
    ];

    function scanFiles(dir) {
      let results = [];
      if (!fs.existsSync(dir)) return results;
      for (const item of fs.readdirSync(dir)) {
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) results = results.concat(scanFiles(full));
        else if (/\.(js|cjs|mjs|json|html|map)$/i.test(item)) results.push(full);
      }
      return results;
    }

    // 5A. Scan extracted app.asar contents
    const asarFiles = scanFiles(tmpDir);
    if (asarFiles.length < 5) {
      console.error(`[asar-verify] REJECTED: Only ${asarFiles.length} files extracted from app.asar.`);
      exitCode = 1;
    }

    for (const file of asarFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(tmpDir, file);
      for (const pattern of forbiddenGeneral) {
        if (content.includes(pattern)) {
          console.error(`[asar-verify] REJECTED: Forbidden string "${pattern}" found in app.asar: ${relPath}`);
          exitCode = 1;
        }
      }
      if (relPath.includes('main.js') || relPath.includes('preload.cjs')) {
        for (const channel of forbiddenOverlayChannels) {
          if (content.includes(channel)) {
            console.error(`[asar-verify] REJECTED: Forbidden executable overlay channel "${channel}" found in ASAR ${relPath}`);
            exitCode = 1;
          }
        }
      }
    }

    // 5B. Scan app.asar.unpacked contents if present
    let unpackedFileCount = 0;
    if (fs.existsSync(unpackedDir)) {
      const unpackedFiles = scanFiles(unpackedDir);
      unpackedFileCount = unpackedFiles.length;
      for (const file of unpackedFiles) {
        const content = fs.readFileSync(file, 'utf8');
        for (const pattern of forbiddenGeneral) {
          if (content.includes(pattern)) {
            console.error(`[asar-verify] REJECTED: Forbidden string "${pattern}" found in app.asar.unpacked: ${path.relative(unpackedDir, file)}`);
            exitCode = 1;
          }
        }
      }
    }

    // 5C. Scan shipped adjacent resources in win-unpacked resources/ and root
    const adjacentFiles = scanFiles(resourcesDir).filter((f) => !f.startsWith(unpackedDir) && !f.endsWith('app.asar'));
    for (const file of adjacentFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of forbiddenGeneral) {
        if (content.includes(pattern)) {
          console.error(`[asar-verify] REJECTED: Forbidden string "${pattern}" found in adjacent resource: ${path.relative(winUnpackedDir, file)}`);
          exitCode = 1;
        }
      }
    }

    if (exitCode === 0) {
      console.log(`[asar-verify] PASS: Scanned ${asarFiles.length} app.asar files, ${unpackedFileCount} unpacked files, and ${adjacentFiles.length} adjacent resource files. Zero bypass code or markers found.`);
    }
  }
} catch (err) {
  console.error('[asar-verify] UNHANDLED ERROR:', err);
  exitCode = 1;
} finally {
  // Guaranteed cleanup: Validate path before deletion
  if (tmpDir && fs.existsSync(tmpDir)) {
    if (tmpDir.startsWith(os.tmpdir()) && path.basename(tmpDir).startsWith('solith-asar-verify-')) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
