import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ctImportUiReducer,
  friendlyCtImportError,
  idleCtImportUiState,
} from '../src/core/ct-library/import-state.js';

test('CT import UI reducer tracks progress, completion, and retry reset', () => {
  const started = ctImportUiReducer(idleCtImportUiState, {
    type: 'start',
    jobId: 'job-1',
    label: 'Hashing Source...',
  });
  assert.equal(started.status, 'running');
  assert.equal(started.jobId, 'job-1');

  const progressed = ctImportUiReducer(started, {
    type: 'progress',
    progress: {
      jobId: 'job-1',
      phase: 'scraping-signatures',
      label: 'Scraping Signatures...',
      processedTables: 2,
      totalTables: 4,
    },
  });
  assert.equal(progressed.status, 'running');
  assert.equal(progressed.progress?.phase, 'scraping-signatures');
  assert.equal(progressed.progress?.processedTables, 2);

  const ignored = ctImportUiReducer(progressed, {
    type: 'progress',
    progress: {
      jobId: 'other-job',
      phase: 'complete',
      label: 'Import Complete.',
    },
  });
  assert.equal(ignored.progress?.phase, 'scraping-signatures');

  const complete = ctImportUiReducer(progressed, { type: 'complete' });
  assert.equal(complete.status, 'complete');
  assert.deepEqual(ctImportUiReducer(complete, { type: 'reset' }), idleCtImportUiState);
});

test('CT import UI reducer gives user-readable zero-trust rejection messages', () => {
  const cancelled = ctImportUiReducer(idleCtImportUiState, {
    type: 'cancelled',
    errorCode: 'ABORT_ERR',
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.errorMessage ?? '', /cleaned up/i);

  const rejected = ctImportUiReducer(idleCtImportUiState, {
    type: 'failed',
    errorCode: 'REJECTED_PATH_TRAVERSAL',
  });
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.errorMessage ?? '', /path traversal/i);
  assert.match(friendlyCtImportError('REJECTED_SIZE_CAP'), /bounded import cap/i);
});
