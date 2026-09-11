import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase 2.1 security invariant closure (Item 2) — static/source-level proof
 * that the unverified pure qualification gate
 * (src/core/community-upload/internal/qualify-pure.ts) is NOT reachable
 * from SOLITH's normal production import surface.
 *
 * This does not rely on comments or caller discipline: it actually greps
 * every .ts/.tsx file under src/ and electron/ (excluding the internal
 * module itself) for an import of './internal/qualify-pure' /
 * '../internal/qualify-pure' and asserts the only match is
 * `qualification.ts`, which is the one file allowed to consume it — and
 * only through the safe, DB-backed `qualifyForUploadWithVerifiedClassification`
 * wrapper it exposes publicly.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_ROOTS = ['src', 'electron'];
const INTERNAL_MODULE_BASENAME = 'qualify-pure';
const ALLOWED_IMPORTER = path.join('src', 'core', 'community-upload', 'qualification.ts');

function listFilesRecursive(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('source boundary: internal/qualify-pure is not part of the production import surface', () => {
  test('no file under src/ or electron/ imports internal/qualify-pure except the authorized qualification.ts wrapper', () => {
    const importers: string[] = [];

    for (const root of PRODUCTION_ROOTS) {
      const rootPath = path.join(projectRoot, root);
      if (!fs.existsSync(rootPath)) continue;

      for (const filePath of listFilesRecursive(rootPath)) {
        const relativePath = path.relative(projectRoot, filePath);
        // The internal module itself obviously "contains" its own basename; skip it.
        if (relativePath.includes(path.join('internal', `${INTERNAL_MODULE_BASENAME}.ts`))) continue;

        const content = fs.readFileSync(filePath, 'utf8');
        const importsInternalModule = new RegExp(
          `from\\s+['"][^'"]*internal/${INTERNAL_MODULE_BASENAME}(\\.js)?['"]`,
        ).test(content);

        if (importsInternalModule) {
          importers.push(relativePath);
        }
      }
    }

    const unauthorizedImporters = importers.filter((relativePath) => relativePath !== ALLOWED_IMPORTER);

    assert.deepEqual(
      unauthorizedImporters,
      [],
      `unauthorized production import(s) of the unverified pure qualification gate: ${unauthorizedImporters.join(', ')}`,
    );
    assert.ok(
      importers.includes(ALLOWED_IMPORTER),
      'expected qualification.ts to be the one authorized importer of internal/qualify-pure (test may be stale if the wrapper was restructured)',
    );
  });
});
