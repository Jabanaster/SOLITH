import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const SAVE_EDITOR_PATH = path.join(ROOT, 'src', 'app', 'pages', 'SaveEditor.tsx');

function readSaveEditor(): string {
  return fs.readFileSync(SAVE_EDITOR_PATH, 'utf-8');
}

describe('SaveEditor safety copy', () => {
  test('does not render Apply Safe Edit', () => {
    const source = readSaveEditor();
    assert.equal(source.includes('Apply Safe Edit'), false);
  });

  test('renders actual risk labels instead of blanket Safe suggestions', () => {
    const source = readSaveEditor();
    assert.equal(source.includes('<span className="badge risk-safe">Safe</span>'), false);
    assert.match(source, /riskDisplayLabel/);
    assert.match(source, /Low risk/);
    assert.match(source, /Caution/);
    assert.match(source, /Risky/);
  });

  test('requires clear local file modification confirmation copy', () => {
    const source = readSaveEditor();
    assert.match(source, /This will modify a local save\/data file\./);
    assert.match(source, /backup or rollback point before continuing/);
  });

  test('distinguishes demo fixture editing from registered game editing', () => {
    const source = readSaveEditor();
    assert.match(source, /DEMO_GAME_ID/);
    assert.match(source, /Demo fixture edit/);
    assert.match(source, /Registered game edit/);
  });

  test('preserves existing proposal and apply workflow calls', () => {
    const source = readSaveEditor();
    assert.match(source, /createProposalForEdit/);
    assert.match(source, /applyProposal/);
    assert.match(source, /handleApplyEdit/);
  });
});
