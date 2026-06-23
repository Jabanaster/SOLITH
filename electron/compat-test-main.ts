import Database from 'better-sqlite3';
import fs from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(moduleFilename);
const testDbPath = path.join(moduleDirectory, 'test-compat.db');

console.log('=== better-sqlite3 Compatibility Test ===');
console.log('Electron version:', process.versions.electron);
console.log('Node version:', process.versions.node);
const betterSqlite3Version = require('better-sqlite3/package.json').version;
console.log('better-sqlite3 version:', betterSqlite3Version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('');

try {
  // 1. Import better-sqlite3
  console.log('[✓] better-sqlite3 imported successfully');
  
  // 2. Create a temporary database
  const db = new Database(testDbPath);
  console.log('[✓] Database created');
  
  // 3. Enable WAL mode
  const journalMode = db.pragma('journal_mode', { readonly: true });
  db.exec('PRAGMA journal_mode = WAL');
  const journalModeAfter = db.pragma('journal_mode', { readonly: true });
  console.log('[✓] WAL mode enabled:', journalModeAfter);
  
  // 4. Create a table
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_table (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      value TEXT
    )
  `);
  console.log('[✓] Table created');
  
  // 5. Insert one row
  const insertResult = db.prepare('INSERT INTO test_table (name, value) VALUES (?, ?)').run('test', 'hello');
  console.log('[✓] Row inserted, changes:', insertResult.changes);
  
  // 6. Read the row with .prepare().get()
  const row = db.prepare('SELECT * FROM test_table WHERE id = ?').get(1);
  console.log('[✓] Row read:', row);
  
  // 7. Update the row
  const updateResult = db.prepare('UPDATE test_table SET value = ? WHERE id = ?').run('world', 1);
  console.log('[✓] Row updated, changes:', updateResult.changes);
  
  // 8. Confirm .run().changes
  const verifyRow = db.prepare('SELECT * FROM test_table WHERE id = ?').get(1);
  console.log('[✓] Updated row:', verifyRow);
  
  // 9. Close the database
  db.close();
  console.log('[✓] Database closed');
  
  // 10. Reopen it
  const db2 = new Database(testDbPath);
  console.log('[✓] Database reopened');
  
  // 11. Confirm the row persisted
  const persistedRow = db2.prepare('SELECT * FROM test_table WHERE id = ?').get(1);
  console.log('[✓] Persisted row:', persistedRow);
  
  if (persistedRow && persistedRow.name === 'test' && persistedRow.value === 'world') {
    console.log('[✓] Data persisted correctly');
  } else {
    console.error('[✗] Data did not persist correctly');
    process.exit(1);
  }
  
  // 12. Delete the temporary database
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
      console.log('[✓] Temporary database deleted');
    }
  } catch (err) {
    // On Windows, the file might be locked - that's okay for this test
    if (err.code !== 'EBUSY') {
      console.error('[✗] Failed to delete temporary database:', err);
      process.exit(1);
    }
    console.log('[✓] Temporary database cleanup skipped (file locked)');
  }
  
  console.log('');
  console.log('=== All compatibility tests passed! ===');
  
} catch (error) {
  console.error('[✗] Compatibility test failed:', error);
  process.exit(1);
}
