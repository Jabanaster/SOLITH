import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_ROOT = path.join(ROOT, 'src', 'app');

const FORBIDDEN_DIRECT_IMPORTS = new Set([
  'fs',
  'node:fs',
  'path',
  'node:path',
  'child_process',
  'node:child_process',
  'worker_threads',
  'node:worker_threads',
  'better-sqlite3',
  'sqlite3',
  'xml2js',
  'memoryjs',
]);

const FORBIDDEN_BACKEND_IMPORTS = [
  /\/core\/registry\/load-registry$/i,
  /\/core\/definitions\/ct-import$/i,
  /\/core\/live-memory\/single-player-waiver$/i,
];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractImportSpecifiers(source: string): string[] {
  const imports: string[] = [];
  const staticImportRe = /\bimport(?:\s+type)?(?:\s+[^'"]+\s+from)?\s*['"]([^'"]+)['"]/g;
  const dynamicImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const re of [staticImportRe, dynamicImportRe]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      imports.push(match[1]!);
    }
  }
  return imports;
}

describe('Electron renderer boundary', () => {
  test('renderer code does not directly import Node/native modules or Node-backed core files', () => {
    const violations: string[] = [];

    for (const file of listSourceFiles(APP_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of extractImportSpecifiers(source)) {
        const normalized = specifier.replace(/\\/g, '/').replace(/\.js$/i, '');
        if (FORBIDDEN_DIRECT_IMPORTS.has(specifier)) {
          violations.push(`${path.relative(ROOT, file)} imports ${specifier}`);
        }
        if (FORBIDDEN_BACKEND_IMPORTS.some((pattern) => pattern.test(normalized))) {
          violations.push(`${path.relative(ROOT, file)} imports backend module ${specifier}`);
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});
