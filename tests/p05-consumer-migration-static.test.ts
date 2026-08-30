import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MP-P0.5 — static proof that specific legacy-path-check consumers were
 * migrated to handle-based authorization (src/core/safety/handle-path-
 * authorization.ts). Companion to tests/handle-path-authorization.test.ts
 * (which tests the module itself) — this proves actual call sites adopted
 * it, the same pattern used for MP-P0.1's/MP-P0.3's static consumer-
 * migration tests.
 *
 * This file grows as more of the 10 files / 31 call sites named in
 * SOLITH_SECURITY_ROADMAP.md's MP-P0.5 row are migrated. Not yet migrated
 * (still on path-safety.ts's lexical check) as of this test's authorship:
 * src/core/ct-library/ct-zip-picker-bridge.ts, src/core/pilot/intake.ts,
 * src/core/saves/locations.ts, electron/ipc-validation.ts, electron/main.ts.
 * file-lock.ts's getCanonicalPath use is a non-security lock-key
 * normalizer, not an authorization boundary — not in scope for migration.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('MP-P0.5 legacy consumer migration (static)', () => {
  test('src/core/backups/index.ts restoreBackup() authorizes the restore target via handle-path-authorization', () => {
    const contents = fs.readFileSync(path.join(ROOT, 'src/core/backups/index.ts'), 'utf8');
    assert.ok(
      /from ['"]\.\.\/safety\/handle-path-authorization\.js['"]/.test(contents),
      'backups/index.ts must import authorizePath/reauthorizeBeforeCommit from handle-path-authorization.js',
    );
    assert.ok(
      /authorizePath\(targetPath,\s*\[game\.path\]\)/.test(contents),
      'restoreBackup() must authorize the restore target with authorizePath([game.path]) rather than only the lexical validateCentralPathSafety check',
    );
    assert.ok(
      /reauthorizeBeforeCommit\(authorizedTargetPath,\s*targetIdentity\)/.test(contents),
      'restoreBackup() must re-authorize immediately before the mutating rename (TOCTOU close), matching the pattern established in atomic-write.ts',
    );
  });
});
