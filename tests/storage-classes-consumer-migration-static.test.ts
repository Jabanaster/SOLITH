import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MP-P0.3 — static proof that the `backups/` consumers construct their
 * backup root from the durable storage class, not raw userData. Complements
 * storage-classes.test.ts (which tests reconcileStorageClasses itself) —
 * this proves the actual call sites were migrated, the same pattern
 * packaged-runtime-boundary-static.test.ts uses for MP-P0.1.
 *
 * solith.db and research-sessions/ are NOT covered here — deliberately
 * still unmigrated (see SOLITH_SECURITY_ROADMAP.md's MP-P0.3 row for why:
 * solith.db requires a file-level, connection-timing-safe migration that
 * has not been built yet; research-sessions/ has not been audited).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('MP-P0.3 backups/ consumer migration (static)', () => {
  test('src/core/saves/editor.ts builds its backup directory from appPaths.durableRoot', () => {
    const contents = fs.readFileSync(path.join(ROOT, 'src/core/saves/editor.ts'), 'utf8');
    assert.ok(
      /path\.join\(appPaths\.durableRoot,\s*['"]backups['"]\)/.test(contents),
      'editor.ts must derive backupDir from appPaths.durableRoot, not appPaths.userDataRoot',
    );
    assert.ok(
      !/path\.join\(appPaths\.userDataRoot,\s*['"]backups['"]\)/.test(contents),
      'editor.ts must not still construct a backups/ path directly under userDataRoot',
    );
  });

  test('electron/avowed-wingdk-backup-watch.ts derives its backup root from reconcileStorageClasses().durableRoot', () => {
    const contents = fs.readFileSync(path.join(ROOT, 'electron/avowed-wingdk-backup-watch.ts'), 'utf8');
    assert.ok(
      /reconcileStorageClasses\(app\.getPath\('userData'\)\)\.durableRoot/.test(contents),
      'avowedWingdkBackupRoot() must resolve via reconcileStorageClasses().durableRoot',
    );
    assert.ok(
      !/app\.getPath\('userData'\)/.test(contents.replace(/reconcileStorageClasses\(app\.getPath\('userData'\)\)/, '')),
      'no other raw app.getPath(\'userData\') use should remain feeding the backup root',
    );
  });
});
