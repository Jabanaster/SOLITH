import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function findRepoRoot(startUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(startUrl)), '..');
}

export function readPackageMetadata(root) {
  const packagePath = path.join(root, 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

export function packagedProductName(pkg) {
  return pkg.build?.productName ?? 'ResourceForge';
}

export function packagedExecutableBaseName(pkg) {
  return pkg.build?.win?.executableName ?? pkg.build?.executableName ?? packagedProductName(pkg);
}

export function packagedExecutableFileName(pkg) {
  const base = packagedExecutableBaseName(pkg);
  return base.toLowerCase().endsWith('.exe') ? base : `${base}.exe`;
}

/** Prefer current product exe, fall back to legacy ResourceForge.exe. */
export function resolvePackagedExecutable(root, pkg = readPackageMetadata(root)) {
  const unpackedDir = path.join(root, 'dist', 'win-unpacked');
  const preferred = path.join(unpackedDir, packagedExecutableFileName(pkg));
  const legacy = path.join(unpackedDir, 'ResourceForge.exe');
  if (fs.existsSync(preferred)) return preferred;
  if (fs.existsSync(legacy)) return legacy;
  return preferred;
}

export function releaseArtifactPaths(root, pkg = readPackageMetadata(root)) {
  const version = pkg.version;
  const productName = packagedProductName(pkg);
  return {
    version,
    productName,
    distDir: path.join(root, 'dist'),
    unpackedDir: path.join(root, 'dist', 'win-unpacked'),
    installer: path.join(root, 'dist', `${productName} Setup ${version}.exe`),
    installerBlockMap: path.join(root, 'dist', `${productName} Setup ${version}.exe.blockmap`),
    executable: resolvePackagedExecutable(root, pkg),
    appAsar: path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar'),
    unpackedHost: path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked', 'dist-electron', 'host-entry.js'),
    rendererAssets: path.join(root, 'dist-electron', 'dist'),
    mainBundle: path.join(root, 'dist-electron', 'main.js'),
    preloadBundle: path.join(root, 'dist-electron', 'preload.cjs'),
    hostBundle: path.join(root, 'dist-electron', 'host-entry.js'),
  };
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function getReleaseFiles(root, pkg = readPackageMetadata(root)) {
  const paths = releaseArtifactPaths(root, pkg);
  return [paths.installer, paths.installerBlockMap].filter((filePath) => fs.existsSync(filePath));
}

export function findProductSetupArtifacts(root, pkg = readPackageMetadata(root)) {
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir)) return [];

  const productName = packagedProductName(pkg).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${productName} Setup .*\\.exe(?:\\.blockmap)?$`);
  const entries = fs.readdirSync(distDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => pattern.test(name));
}

/** @deprecated Use findProductSetupArtifacts */
export function findResourceForgeSetupArtifacts(root) {
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir)) return [];

  const entries = fs.readdirSync(distDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^(ResourceForge|Solith) Setup .*\.exe(?:\.blockmap)?$/.test(name));
}
