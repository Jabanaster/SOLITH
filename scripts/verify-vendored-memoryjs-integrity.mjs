#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor', 'memoryjs-3.5.1-patched');
const expected = new Map([
  ['package.json', '7a592eb66c633037dce8716b2fb014c4436dd4528a0f13dea5f4b40f82357ce4'],
  ['NOTES.md', 'a02b11c876b0c19176389a5fd6e0ce1cc096926696be2f6815b9d8d9c25a5873'],
]);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(vendor)) {
  fail(`vendored memoryjs directory missing: ${vendor}`);
  process.exit(1);
}

for (const [relative, expectedHash] of expected) {
  const file = path.join(vendor, relative);
  if (!fs.existsSync(file)) {
    fail(`required vendored file missing: ${relative}`);
    continue;
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expectedHash) {
    fail(`${relative} hash drifted: expected ${expectedHash}, got ${actual}`);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(vendor, 'package.json'), 'utf8'));
if (pkg.name !== 'memoryjs' || pkg.version !== '3.5.1' || pkg.license !== 'MIT') {
  fail(`unexpected package identity: ${pkg.name}@${pkg.version} license=${pkg.license}`);
}
if (pkg.repository?.url !== 'git+https://github.com/Rob--/memoryjs.git') {
  fail(`unexpected upstream repository: ${pkg.repository?.url}`);
}
if (pkg.dependencies?.['node-addon-api'] !== '^3.2.1') {
  fail('unexpected node-addon-api dependency in vendored memoryjs');
}

const forbiddenDirs = new Set(['node_modules', 'build', 'dist']);
const forbiddenExts = new Set(['.node', '.dll', '.exe', '.pdb', '.lib']);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(vendor, full).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (forbiddenDirs.has(entry.name)) {
        fail(`forbidden generated directory committed under vendor tree: ${rel}`);
        continue;
      }
      walk(full);
    } else if (forbiddenExts.has(path.extname(entry.name).toLowerCase())) {
      fail(`forbidden generated/native artifact committed under vendor tree: ${rel}`);
    }
  }
}

walk(vendor);

if (process.exitCode) process.exit(process.exitCode);
console.log('PASS: vendored memoryjs integrity policy');
