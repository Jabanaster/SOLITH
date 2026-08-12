import { defineConfig } from 'tsup';
import fs from 'node:fs';
import path from 'node:path';

export type SolithBuildConfig =
  | { mode: 'production'; outDir: 'dist-electron' }
  | { mode: 'test'; outDir: 'dist-electron-test' };

export function createTsupConfig(config: SolithBuildConfig): ReturnType<typeof defineConfig> {
  const isTestBuild = config.mode === 'test';
  const outDir = config.outDir;
  const testMarker = isTestBuild
    ? '__SOLITH_TEST_BUILD_MARKER__'
    : '__SOLITH_PRODUCTION_BUILD_MARKER__';

  // Generate explicit Build Manifest artifact inside outDir
  const manifestPath = path.join(process.cwd(), outDir, 'solith-build-manifest.json');
  fs.mkdirSync(path.join(process.cwd(), outDir), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        buildMode: config.mode,
        consentOverrideEnabled: isTestBuild,
        wispOverlayEnabled: isTestBuild,
        outputDirectory: config.outDir,
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return defineConfig([
    {
      entry: { main: 'electron/main.ts' },
      outDir,
      format: ['esm'],
      target: 'node22',
      platform: 'node',
      splitting: false,
      sourcemap: isTestBuild,
      clean: false, // Clean handled by clean-production-build.mjs to protect dist-electron/dist
      dts: false,
      bundle: true,
      external: ['electron'],
      noExternal: [/^\.\.?\//],
      esbuildOptions(options) {
        options.treeShaking = true;
        options.minifySyntax = true;
        options.define = {
          ...options.define,
          '__SOLITH_ENABLE_TEST_CONSENT_OVERRIDE__': isTestBuild ? 'true' : 'false',
          '__SOLITH_ENABLE_WISP_OVERLAY__': isTestBuild ? 'true' : 'false',
          '__SOLITH_BUILD_MARKER__': JSON.stringify(testMarker),
        };
      },
      banner: {
        js: `
import { createRequire } from 'module';
import { fileURLToPath as _fileURLToPath } from 'url';
import { dirname as _pathDirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _pathDirname(__filename);
/* ${testMarker} */
`.trim(),
      },
    },
    {
      entry: { 'host-entry': 'src/core/trainer-host/host-entry.ts' },
      outDir,
      format: ['esm'],
      target: 'node22',
      platform: 'node',
      splitting: false,
      sourcemap: isTestBuild,
      clean: false,
      dts: false,
      bundle: true,
      external: ['electron'],
      banner: {
        js: `
import { createRequire } from 'module';
import { fileURLToPath as _fileURLToPath } from 'url';
import { dirname as _pathDirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _pathDirname(__filename);
`.trim(),
      },
    },
    {
      entry: { 'headless-verification-worker': 'src/core/runtime/headless-verification-worker.ts' },
      outDir,
      format: ['esm'],
      target: 'node22',
      platform: 'node',
      splitting: false,
      sourcemap: isTestBuild,
      clean: false,
      dts: false,
      bundle: true,
      external: ['electron'],
      banner: {
        js: `
import { createRequire } from 'module';
import { fileURLToPath as _fileURLToPath } from 'url';
import { dirname as _pathDirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _pathDirname(__filename);
`.trim(),
      },
    },
    {
      entry: { preload: 'electron/preload.ts' },
      outDir,
      format: ['cjs'],
      target: 'node22',
      platform: 'node',
      splitting: false,
      sourcemap: isTestBuild,
      clean: false,
      dts: false,
      bundle: true,
      external: ['electron'],
      esbuildOptions(options) {
        options.treeShaking = true;
        options.minifySyntax = true;
        options.define = {
          ...options.define,
          '__SOLITH_ENABLE_TEST_CONSENT_OVERRIDE__': isTestBuild ? 'true' : 'false',
          '__SOLITH_ENABLE_WISP_OVERLAY__': isTestBuild ? 'true' : 'false',
          '__SOLITH_BUILD_MARKER__': JSON.stringify(testMarker),
        };
      },
    },
  ]);
}
