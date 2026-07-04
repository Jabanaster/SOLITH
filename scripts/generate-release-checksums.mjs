#!/usr/bin/env node

import path from 'node:path';
import {
  findRepoRoot,
  getReleaseFiles,
  readPackageMetadata,
  sha256File,
} from './release-artifact-utils.mjs';

const root = process.env.RESOURCEFORGE_RELEASE_ROOT
  ? path.resolve(process.env.RESOURCEFORGE_RELEASE_ROOT)
  : findRepoRoot(import.meta.url);

const pkg = readPackageMetadata(root);
const files = getReleaseFiles(root, pkg);

if (files.length === 0) {
  console.error(`No ResourceForge release artifacts found under ${path.join(root, 'dist')}`);
  process.exit(1);
}

console.log(`ResourceForge ${pkg.version} release checksums`);
for (const filePath of files) {
  const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
  console.log(`${sha256File(filePath)}  ${relativePath}`);
}

