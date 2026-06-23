// fix-esm-imports.mjs
// Adds correct .js extensions to bare relative imports in compiled ESM output files.
// This is needed because Node.js ESM requires explicit extensions.
// Handles both file imports (foo -> foo.js) and directory imports (foo -> foo/index.js).

import { readdir, readFile, writeFile, access } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { existsSync } from 'fs';

async function getAllJsFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getAllJsFiles(fullPath));
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Given an import specifier and the file that contains it, resolve what .js path to use
function resolveRelativeImport(specifier, fromFile) {
  const hasExtension = /\.(js|json|css|ts|mjs|cjs|wasm)$/;
  if (hasExtension.test(specifier)) return specifier; // already has extension

  const fromDir = dirname(fromFile);
  const candidate = resolve(fromDir, specifier);

  // Check if it's a file directly: candidate.js
  if (existsSync(candidate + '.js')) {
    return specifier + '.js';
  }
  // Check if it's a directory with index.js
  if (existsSync(join(candidate, 'index.js'))) {
    return specifier + '/index.js';
  }
  // Fallback: add .js and hope for the best
  return specifier + '.js';
}

async function fixImports(filePath) {
  let content = await readFile(filePath, 'utf8');
  const original = content;

  // Fix static imports: from './path' or from '../path'
  content = content.replace(/from\s+'(\.\.?\/[^']+?)'/g, (match, p) => {
    const resolved = resolveRelativeImport(p, filePath);
    return `from '${resolved}'`;
  });

  content = content.replace(/from\s+"(\.\.?\/[^"]+?)"/g, (match, p) => {
    const resolved = resolveRelativeImport(p, filePath);
    return `from "${resolved}"`;
  });

  // Fix dynamic imports: import('./path')
  content = content.replace(/import\('(\.\.?\/[^']+?)'\)/g, (match, p) => {
    const resolved = resolveRelativeImport(p, filePath);
    return `import('${resolved}')`;
  });

  content = content.replace(/import\("(\.\.?\/[^"]+?)"\)/g, (match, p) => {
    const resolved = resolveRelativeImport(p, filePath);
    return `import("${resolved}")`;
  });

  if (content !== original) {
    await writeFile(filePath, content, 'utf8');
    console.log(`Fixed: ${filePath}`);
  }
}

const distDir = './dist-electron';

try {
  const files = await getAllJsFiles(distDir);
  await Promise.all(files.map(fixImports));
  console.log(`✅ ESM import fix complete. Processed ${files.length} files.`);
} catch (e) {
  console.error('❌ ESM import fix failed:', e);
  process.exit(1);
}
