import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { initDatabase, persistDatabase } from '../src/core/database/index.ts';

// Reproduces a real crash observed during Phase 7 installer-upgrade lifecycle
// testing on 2026-08-21: a transient filesystem error (EXDEV — cross-device
// rename) inside the debounced background persistence timer became an
// uncaught exception and killed the whole Electron process, discarding an
// otherwise-healthy running session over a single failed autosave tick.
// The debounced (non-forceSync) path has no caller able to catch a synchronous
// throw from its setTimeout callback — persistDatabase() must never let a
// write failure escape that path as an uncaught exception. The synchronous
// forceSync path (used by explicit flush/shutdown callers) is unaffected and
// must keep throwing so those callers can observe and handle failure.
describe('persistDatabase debounced-timer failure isolation', () => {
  before(async () => {
    // dbPath is only set once a real database has been initialized — without
    // it, exportAndPersistToDisk short-circuits before ever calling
    // sqlDb.export(), which would make this test pass for the wrong reason.
    await initDatabase();
  });

  test('a write failure during the debounced (non-forceSync) persist tick does not crash the process', async () => {
    let uncaught: unknown = null;
    const onUncaught = (err: unknown) => { uncaught = err; };
    process.once('uncaughtException', onUncaught);

    const failingSqlDb = {
      export: () => {
        throw new Error('EXDEV: cross-device link not permitted (simulated)');
      },
    };

    // Non-forceSync path — this is what the 10ms debounce timer invokes on
    // every save-triggered write in the running app. Attach the rejection
    // expectation immediately so Node doesn't flag the settle as unhandled
    // while we wait for the debounce timer to fire below.
    const pending = persistDatabase(failingSqlDb);
    const rejectionCheck = assert.rejects(pending);

    // Let the debounce timer (10ms) fire and the rejection settle.
    await new Promise((resolve) => setTimeout(resolve, 100));

    process.removeListener('uncaughtException', onUncaught);

    assert.strictEqual(uncaught, null,
      'a persistence failure inside the debounced timer must never surface as an uncaught exception');

    // The failure must still be observable to anyone actually awaiting the
    // scheduled persist — it should reject, not silently report success.
    await rejectionCheck;
  });
});
