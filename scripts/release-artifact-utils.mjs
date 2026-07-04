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

export function releaseArtifactPaths(root, pkg = readPackageMetadata(root)) {
  const version = pkg.version;
  return {
    version,
    distDir: path.join(root, 'dist'),
    unpackedDir: path.join(root, 'dist', 'win-unpacked'),
    installer: path.join(root, 'dist', `ResourceForge Setup ${version}.exe`),
    installerBlockMap: path.join(root, 'dist', `ResourceForge Setup ${version}.exe.blockmap`),
    executable: path.join(root, 'dist', 'win-unpacked', 'ResourceForge.exe'),
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

export function findResourceForgeSetupArtifacts(root) {
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir)) return [];

  const entries = fs.readdirSync(distDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^ResourceForge Setup .*\.exe(?:\.blockmap)?$/.test(name));
}
