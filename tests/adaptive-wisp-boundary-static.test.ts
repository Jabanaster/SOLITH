import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Increment 1 Section 37 / Increment 3 Sections 46-47 — static purity
 * assertion. The Adaptive Wisp domain foundation (schema/validation/registry)
 * AND the Increment 3 runtime-binding layer must stay free of execution,
 * hotkey, and raw IPC imports: no live-memory writes, no shell/child_process,
 * no raw Electron IPC, no process-attach/freeze/hotkey services. Execution is
 * Increment 4's job; hotkeys are Increment 5's.
 */
const FORBIDDEN_IMPORT_FRAGMENTS = [
  'live-memory',
  'child_process',
  'electron',
  'freeze',
  'process-selection',
  'trainer-host',
  'shell',
  'globalShortcut',
  'trainer-hotkey',
  'cheat-hotkey',
  'ipcMain',
  'ipcRenderer',
];

/** Every external (non-local, non-node:) import any adaptive-wisp file is allowed to use, keyed by file. Pre-existing Increment 1/2 dependencies (zod, the shared atomic-rename helper) are carried forward unchanged; only the new Increment 3 adapters (session-monitor-context-provider.ts, cheat-system-entry-lookup.ts) add narrow new external reads. */
const ALLOWED_EXTERNAL_IMPORTS: Record<string, string[]> = {
  'schema.ts': ['zod'],
  'user-state-schema.ts': ['zod'],
  'persistence.ts': ['../safety/exdev-safe-rename.js'],
  'session-monitor-context-provider.ts': ['../v2/session-monitor.js'],
  'cheat-system-entry-lookup.ts': ['../cheat-system/game-registry.js', '../cheat-system/types.js'],
};

describe('adaptive-wisp domain foundation stays pure (no runtime/IPC/memory imports)', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'adaptive-wisp');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  test('adaptive-wisp module directory contains the expected foundation files', () => {
    for (const expected of ['types.ts', 'schema.ts', 'limits.ts', 'validation.ts', 'migrations.ts', 'registry.ts', 'errors.ts', 'index.ts']) {
      assert.ok(files.includes(expected), `expected ${expected} to exist in src/core/adaptive-wisp`);
    }
  });

  test('adaptive-wisp module directory contains the expected Increment 3 runtime-binding files', () => {
    for (const expected of [
      'binding-errors.ts',
      'runtime-types.ts',
      'entry-lookup.ts',
      'profile-binder.ts',
      'binding-validation.ts',
      'binding-registry.ts',
      'session-context.ts',
    ]) {
      assert.ok(files.includes(expected), `expected ${expected} to exist in src/core/adaptive-wisp`);
    }
  });

  for (const file of files) {
    test(`${file} imports nothing from a forbidden runtime/IPC/memory/hotkey module`, () => {
      const contents = readFileSync(path.join(dir, file), 'utf8');
      const importLines = contents.split('\n').filter((line) => /^\s*import\b/.test(line));
      for (const line of importLines) {
        for (const fragment of FORBIDDEN_IMPORT_FRAGMENTS) {
          assert.ok(!line.includes(fragment), `${file} imports from forbidden module fragment "${fragment}": ${line.trim()}`);
        }
      }
    });
  }

  test('no execution/write/freeze APIs are exported (Section 46 — no execution yet)', () => {
    const contents = readFileSync(path.join(dir, 'index.ts'), 'utf8');
    for (const forbiddenExport of ['executeWispAction', 'toggleWispAction', 'setWispValue', 'freezeWispValue']) {
      assert.ok(!contents.includes(forbiddenExport), `index.ts must not export ${forbiddenExport} yet — Increment 4's concern`);
    }
  });

  for (const file of files) {
    test(`${file} only imports from src/core/adaptive-wisp, node builtins, or its explicit allowlist`, () => {
      const allowedExternal = ALLOWED_EXTERNAL_IMPORTS[file] ?? [];
      const contents = readFileSync(path.join(dir, file), 'utf8');
      const importLines = contents.split('\n').filter((line) => /^\s*import\b/.test(line));
      for (const line of importLines) {
        const match = line.match(/from ['"]([^'"]+)['"]/);
        if (!match) continue;
        const specifier = match[1];
        const isLocal = specifier.startsWith('./');
        const isNodeBuiltin = specifier.startsWith('node:');
        const isAllowed = allowedExternal.includes(specifier);
        assert.ok(isLocal || isNodeBuiltin || isAllowed, `${file} has an unexpected external import "${specifier}": ${line.trim()}`);
      }
    });
  }
});
