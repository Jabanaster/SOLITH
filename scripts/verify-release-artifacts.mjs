#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  findRepoRoot,
  findProductSetupArtifacts,
  packagedExecutableFileName,
  packagedProductName,
  readPackageMetadata,
  releaseArtifactPaths,
} from './release-artifact-utils.mjs';
import { evaluateSigningStatus, getAuthenticodeStatuses } from './signing-verification.mjs';

const root = process.env.SOLITH_RELEASE_ROOT
  ? path.resolve(process.env.SOLITH_RELEASE_ROOT)
  : findRepoRoot(import.meta.url);

const pkg = readPackageMetadata(root);
const paths = releaseArtifactPaths(root, pkg);
const productName = packagedProductName(pkg);
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

console.log('\nSolith release artifact verifier\n');
console.log(`Root: ${root}`);
console.log(`Version: ${pkg.version}`);
console.log(`Product: ${productName}`);

check('package version is non-empty', typeof pkg.version === 'string' && pkg.version.length > 0, String(pkg.version));
check('productName is Solith', productName === 'Solith', productName);
check('appId is stable', pkg.build?.appId === 'com.solith.app', pkg.build?.appId);
check('publish config is absent', pkg.build?.publish === undefined);
check('Windows executableName is Solith', pkg.build?.win?.executableName === 'Solith', pkg.build?.win?.executableName);
check('Windows icon points to tracked Solith S icon', pkg.build?.win?.icon === 'public/solith-icon.ico', pkg.build?.win?.icon);
check(
  'NSIS installer artifactName is versioned',
  pkg.build?.nsis?.artifactName === 'Solith Setup ${version}.${ext}',
  pkg.build?.nsis?.artifactName,
);
check('NSIS installerIcon points to Solith S icon', pkg.build?.nsis?.installerIcon === 'public/solith-icon.ico', pkg.build?.nsis?.installerIcon);
check('NSIS uninstallerIcon points to Solith S icon', pkg.build?.nsis?.uninstallerIcon === 'public/solith-icon.ico', pkg.build?.nsis?.uninstallerIcon);
check('NSIS installerHeaderIcon points to Solith S icon', pkg.build?.nsis?.installerHeaderIcon === 'public/solith-icon.ico', pkg.build?.nsis?.installerHeaderIcon);
check('NSIS uninstall removes Solith app data', pkg.build?.nsis?.deleteAppDataOnUninstall === true, String(pkg.build?.nsis?.deleteAppDataOnUninstall));

check('installer exists', exists(paths.installer), paths.installer);
check('installer blockmap exists', exists(paths.installerBlockMap), paths.installerBlockMap);
check('unpacked executable exists', exists(paths.executable), paths.executable);
check(
  'unpacked executable file name matches product',
  path.basename(paths.executable) === packagedExecutableFileName(pkg),
  paths.executable,
);
check('app.asar exists', exists(paths.appAsar), paths.appAsar);
check('packaged TrainerHost exists unpacked', exists(paths.unpackedHost), paths.unpackedHost);
check('built renderer asset directory exists before packaging', exists(paths.rendererAssets), paths.rendererAssets);
check('compiled main bundle exists', exists(paths.mainBundle), paths.mainBundle);
check('compiled preload bundle exists', exists(paths.preloadBundle), paths.preloadBundle);
check('compiled host bundle exists', exists(paths.hostBundle), paths.hostBundle);

const setupArtifacts = findProductSetupArtifacts(root, pkg);
const artifactNames = setupArtifacts.join(', ');
check('no Solith installer artifact name includes 1.4.0', !artifactNames.includes('1.4.0'), artifactNames);

const installerName = path.basename(paths.installer);
check('installer name includes current package version', installerName.includes(pkg.version), installerName);
check('installer name does not include 1.4.0', !installerName.includes('1.4.0'), installerName);
check('installer name does not include old internal project names', !/trainer|drill|pilot/i.test(installerName), installerName);

// ── Artifact-signing verification ───────────────────────────────────────────
// Finding: build logs claiming "signing with signtool.exe" were not proof the
// artifact was actually signed. This checks real Authenticode state on disk.
// In release mode (SOLITH_RELEASE_BUILD=1), NotSigned/missing required
// first-party executables hard-fail the build; in dev mode they only warn.
// elevate.exe is a third-party electron-builder helper and is intentionally
// not required to carry a Solith signature.
console.log('\nArtifact signing');
const releaseMode = process.env.SOLITH_RELEASE_BUILD === '1';
const signingTargets = [
  { name: 'main executable (Solith.exe)', path: paths.executable },
  { name: 'installer', path: paths.installer },
  {
    name: 'solith-readonly-scanner.exe (first-party helper)',
    path: path.join(path.dirname(paths.executable), 'resources', 'app.asar.unpacked', 'dist-electron', 'solith-readonly-scanner.exe'),
  },
];

if (process.platform !== 'win32') {
  console.log('  SKIP — Authenticode verification requires Windows');
} else {
  const statuses = getAuthenticodeStatuses(signingTargets);
  const { results, ok } = evaluateSigningStatus(statuses, { releaseMode });
  for (const r of results) {
    checks++;
    if (r.severity === 'fail') {
      failures++;
      console.error(`  FAIL [${checks}] ${r.name} is ${r.status} (release mode requires a valid signature): ${r.path}`);
    } else if (r.severity === 'warn') {
      console.warn(`  WARN [${checks}] ${r.name} is ${r.status} (expected for dev builds; will hard-fail once SOLITH_RELEASE_BUILD=1): ${r.path}`);
    } else {
      console.log(`  PASS [${checks}] ${r.name} Authenticode status: ${r.status}`);
    }
  }
  void ok;
}

console.log(`\nSummary: ${checks - failures}/${checks} checks passed\n`);

if (failures > 0) {
  process.exit(1);
}
