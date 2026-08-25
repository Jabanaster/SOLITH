import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Increment 1 Section 37 — static purity assertion. The Adaptive Wisp domain
 * foundation (schema/validation/registry) must stay pure: no live-memory
 * writes, no shell/child_process, no raw Electron IPC, no process-attach or
 * freeze services. Those all belong to a later runtime-binding increment
 * (Section 28) that this increment explicitly does not implement.
 */
const FORBIDDEN_IMPORT_FRAGMENTS = ['live-memory', 'child_process', 'electron', 'freeze', 'process-selection', 'trainer-host'];

describe('adaptive-wisp domain foundation stays pure (no runtime/IPC/memory imports)', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'adaptive-wisp');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  test('adaptive-wisp module directory contains the expected foundation files', () => {
    for (const expected of ['types.ts', 'schema.ts', 'limits.ts', 'validation.ts', 'migrations.ts', 'registry.ts', 'errors.ts', 'index.ts']) {
      assert.ok(files.includes(expected), `expected ${expected} to exist in src/core/adaptive-wisp`);
    }
  });

  for (const file of files) {
    test(`${file} imports nothing from a forbidden runtime/IPC/memory module`, () => {
      const contents = readFileSync(path.join(dir, file), 'utf8');
      const importLines = contents.split('\n').filter((line) => /^\s*import\b/.test(line));
      for (const line of importLines) {
        for (const fragment of FORBIDDEN_IMPORT_FRAGMENTS) {
          assert.ok(!line.includes(fragment), `${file} imports from forbidden module fragment "${fragment}": ${line.trim()}`);
        }
      }
    });
  }
});
