import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Low finding (independent security review, ef254d1): "180/180 IPC guard" was
// a hand-verified snapshot count — nothing in the codebase would fail a build
// if a future privileged ipcMain.handle registration forgot its trusted-sender
// guard. This test enumerates the REAL registration surface in electron/*.ts
// by parsing source directly (not a hand-maintained channel list), so it
// tracks the codebase automatically as channels are added/removed/renamed.
//
// Two registration shapes exist in this codebase:
//   1. Direct:  ipcMain.handle('channel-name', async (event, ...) => { ... })
//      — the guard must be called INSIDE that same callback body.
//   2. Wrapped: guardedHandle('channel-name', ...) / handleGuarded('channel-name', ...)
//      — a local per-file wrapper function that itself calls
//      ipcMain.handle(channel, ...) with a *variable* channel (not a string
//      literal), so it never matches the direct-registration regex below.
//      Guarded by construction, PROVIDED the wrapper's own definition calls
//      the trusted-sender check — this test verifies that precondition once
//      per file that defines one, so a wrapper cannot quietly go unguarded
//      without being caught either.

const ELECTRON_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron');
const TRUSTED_SENDER_CHECK_PATTERN = /\b(requireTrustedSender|validateIpcSender|validateTrustedSender)\s*\(/;
const CHANNEL_REGISTRATION_PATTERN = /\b(ipcMain\.handle|guardedHandle|handleGuarded)\(\s*'([^']+)'/g;
const WRAPPER_DEFINITION_PATTERN = /function\s+(guardedHandle|handleGuarded)\s*\(/g;

/** Given the index of a '(' in `text`, returns the substring up to (and including) its matching ')'. */
function extractBalancedParens(text: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(openParenIndex, i + 1);
    }
  }
  throw new Error(`Unbalanced parentheses starting at index ${openParenIndex}`);
}

/** Given the index of a '{' in `text`, returns the substring up to (and including) its matching '}'. */
function extractBalancedBraces(text: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(openBraceIndex, i + 1);
    }
  }
  throw new Error(`Unbalanced braces starting at index ${openBraceIndex}`);
}

interface FileScanResult {
  file: string;
  channelCount: number;
  unguarded: Array<{ channel: string; kind: string }>;
  wrapperNamesDefined: string[];
  wrapperNamesUnguarded: string[];
}

function scanFile(filePath: string, text: string): FileScanResult {
  const fileName = path.basename(filePath);

  // 1. Find every locally-defined guardedHandle/handleGuarded wrapper and
  // verify ITS definition performs the trusted-sender check.
  const wrapperNamesDefined: string[] = [];
  const wrapperNamesUnguarded: string[] = [];
  let wrapperMatch: RegExpExecArray | null;
  WRAPPER_DEFINITION_PATTERN.lastIndex = 0;
  while ((wrapperMatch = WRAPPER_DEFINITION_PATTERN.exec(text)) !== null) {
    const wrapperName = wrapperMatch[1];
    wrapperNamesDefined.push(wrapperName);
    const braceStart = text.indexOf('{', wrapperMatch.index);
    if (braceStart === -1) continue;
    const wrapperBody = extractBalancedBraces(text, braceStart);
    if (!TRUSTED_SENDER_CHECK_PATTERN.test(wrapperBody)) {
      wrapperNamesUnguarded.push(wrapperName);
    }
  }

  // 2. Enumerate every actual channel registration (string-literal first arg
  // — this excludes each wrapper's own internal `ipcMain.handle(channel, ...)`
  // call, since `channel` there is a variable, not a string literal).
  const unguarded: Array<{ channel: string; kind: string }> = [];
  let channelCount = 0;
  let match: RegExpExecArray | null;
  CHANNEL_REGISTRATION_PATTERN.lastIndex = 0;
  while ((match = CHANNEL_REGISTRATION_PATTERN.exec(text)) !== null) {
    const kind = match[1];
    const channel = match[2];
    channelCount++;

    if (kind === 'guardedHandle' || kind === 'handleGuarded') {
      // Guarded by construction via the wrapper — already checked above.
      // A registration referencing an undefined wrapper name would be a
      // real bug too (calling a function that doesn't exist), so require
      // that this file actually defines the wrapper it's calling.
      if (!wrapperNamesDefined.includes(kind)) {
        unguarded.push({ channel, kind: `${kind} (no matching wrapper definition found in ${fileName})` });
      }
      continue;
    }

    // Direct ipcMain.handle('channel', async (event, ...) => { ... }) —
    // the guard must appear inside this specific callback's body.
    const openParenIndex = text.indexOf('(', match.index + 'ipcMain.handle'.length);
    const fullCall = extractBalancedParens(text, openParenIndex);
    if (!TRUSTED_SENDER_CHECK_PATTERN.test(fullCall)) {
      unguarded.push({ channel, kind: 'direct ipcMain.handle' });
    }
  }

  return { file: fileName, channelCount, unguarded, wrapperNamesDefined, wrapperNamesUnguarded };
}

function scanAllElectronFiles(): FileScanResult[] {
  const files = fs.readdirSync(ELECTRON_DIR).filter((name) => name.endsWith('.ts'));
  return files.map((name) => {
    const filePath = path.join(ELECTRON_DIR, name);
    const text = fs.readFileSync(filePath, 'utf8');
    return scanFile(filePath, text);
  });
}

test('every ipcMain channel registration in electron/*.ts is guarded by a trusted-sender check', () => {
  const results = scanAllElectronFiles();

  const allUnguarded = results.flatMap((r) => r.unguarded.map((u) => `${r.file}: '${u.channel}' (${u.kind})`));
  assert.deepEqual(allUnguarded, [], `Found unguarded IPC channel registration(s):\n${allUnguarded.join('\n')}`);

  const allUnguardedWrappers = results.flatMap((r) =>
    r.wrapperNamesUnguarded.map((name) => `${r.file}: wrapper "${name}" does not call a trusted-sender check`),
  );
  assert.deepEqual(
    allUnguardedWrappers,
    [],
    `Found wrapper function(s) whose own definition never checks the sender:\n${allUnguardedWrappers.join('\n')}`,
  );
});

test('the IPC registration surface is non-trivial (sanity check that the scanner is actually finding channels)', () => {
  const results = scanAllElectronFiles();
  const total = results.reduce((sum, r) => sum + r.channelCount, 0);
  // Not pinned to an exact number (that's precisely the hand-maintained-sample
  // problem this test replaces) — just proves the scanner isn't silently
  // matching zero channels due to a regex/path regression.
  assert.ok(total > 50, `expected a substantial number of registered IPC channels, found ${total}`);
});

test('every file defining a guardedHandle/handleGuarded wrapper has at least one channel registered through it', () => {
  const results = scanAllElectronFiles();
  for (const result of results) {
    if (result.wrapperNamesDefined.length === 0) continue;
    // A wrapper defined but never used would be dead code, not a security
    // gap — but it's still worth flagging since it means this scanner isn't
    // exercising that wrapper's guard-by-construction path for this file.
    const usesWrapper = result.wrapperNamesDefined.some((name) =>
      new RegExp(`\\b${name}\\('`).test(fs.readFileSync(path.join(ELECTRON_DIR, result.file), 'utf8')),
    );
    assert.ok(usesWrapper, `${result.file} defines a wrapper but never registers a channel through it`);
  }
});
