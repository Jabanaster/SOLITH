#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  findRepoRoot,
  findResourceForgeSetupArtifacts,
  readPackageMetadata,
  releaseArtifactPaths,
} from './release-artifact-utils.mjs';

const root = process.env.RESOURCEFORGE_RELEASE_ROOT
  ? path.resolve(process.env.RESOURCEFORGE_RELEASE_ROOT)
  : findRepoRoot(import.meta.url);

const pkg = readPackageMetadata(root);
const paths = releaseArtifactPaths(root, pkg);
let failures = 0;
let checks = 0;

function check(description, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  PASS [${checks}] ${description}`);
  } else {
    failures++;
    console.error(`  FAIL [${checks}] ${description}${detail ? `: ${detail}` : ''}`);
  }
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

console.log('\nResourceForge release artifact verifier\n');
console.log(`Root: ${root}`);
console.log(`Version: ${pkg.version}`);

check('package version is 1.5.0', pkg.version === '1.5.0', pkg.version);
check('productName is ResourceForge', pkg.build?.productName === 'ResourceForge', pkg.build?.productName);
check('appId is stable', pkg.build?.appId === 'com.resourceforge.app', pkg.build?.appId);
check('publish config is absent', pkg.build?.publish === undefined);
check('Windows executableName is ResourceForge', pkg.build?.win?.executableName === 'ResourceForge', pkg.build?.win?.executableName);
check('NSIS installer artifactName is versioned', pkg.build?.nsis?.artifactName === 'ResourceForge Setup ${version}.${ext}', pkg.build?.nsis?.artifactName);

check('installer exists', exists(paths.installer), paths.installer);
check('installer blockmap exists', exists(paths.installerBlockMap), paths.installerBlockMap);
check('unpacked executable exists', exists(paths.executable), paths.executable);
check('app.asar exists', exists(paths.appAsar), paths.appAsar);
check('packaged TrainerHost exists unpacked', exists(paths.unpackedHost), paths.unpackedHost);
check('built renderer asset directory exists before packaging', exists(paths.rendererAssets), paths.rendererAssets);
check('compiled main bundle exists', exists(paths.mainBundle), paths.mainBundle);
check('compiled preload bundle exists', exists(paths.preloadBundle), paths.preloadBundle);
check('compiled host bundle exists', exists(paths.hostBundle), paths.hostBundle);

const setupArtifacts = findResourceForgeSetupArtifacts(root);
const artifactNames = setupArtifacts.join(', ');
check('no ResourceForge installer artifact name includes 1.4.0', !artifactNames.includes('1.4.0'), artifactNames);

const installerName = path.basename(paths.installer);
check('installer name includes 1.5.0', installerName.includes('1.5.0'), installerName);
check('installer name does not include 1.4.0', !installerName.includes('1.4.0'), installerName);
check('installer name does not include old internal project names', !/trainer|drill|pilot/i.test(installerName), installerName);

console.log(`\nSummary: ${checks - failures}/${checks} checks passed\n`);

if (failures > 0) {
  process.exit(1);
}
