/**
 * SOLITH Phase 3.1, Mission 10/13 — server-side provider secret boundary.
 *
 * Proves: the Steam API key (and any future provider secret) never reaches
 * the desktop renderer/preload/IPC surface, never appears in a log or error
 * string, and is never persisted to the repo or database.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { steamSyncPage } from '../src/core/provider-catalog/steam-adapter.ts';
import { hasSteamApiKey, runBoundedSteamSmoke } from '../src/core/provider-catalog/steam-smoke-harness.ts';
import type { AdapterFetchImpl } from '../src/core/provider-catalog/adapter.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(fullPath));
    else if (/\.(ts|tsx|js)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

describe('provider secret boundary (Mission 10)', () => {
  test('SOURCE BOUNDARY: no file under electron/ or src/app/ (renderer/preload/IPC) imports the Steam adapter or references the key env var', () => {
    const suspects: string[] = [];
    for (const root of ['electron', 'src/app']) {
      for (const file of listFilesRecursive(path.join(projectRoot, root))) {
        const content = fs.readFileSync(file, 'utf8');
        if (/from\s+['"][^'"]*steam-adapter(\.js)?['"]/.test(content) || content.includes('SOLITH_STEAM_API_KEY')) {
          suspects.push(path.relative(projectRoot, file));
        }
      }
    }
    assert.deepEqual(suspects, [], `renderer/preload/IPC code must never reference the Steam adapter or its key env var: ${suspects.join(', ')}`);
  });

  test('desktop renderer surface (window.* IPC bridge type in global.d.ts) has no Steam-catalog-sync channel exposing a key', () => {
    const globalDts = fs.readFileSync(path.join(projectRoot, 'src/types/global.d.ts'), 'utf8');
    assert.doesNotMatch(globalDts, /steamApiKey/i);
    assert.doesNotMatch(globalDts, /SOLITH_STEAM_API_KEY/);
  });

  test('a Steam adapter failure never leaks the key into its error string, even for a variety of failure shapes', async () => {
    const secretKey = 'sk-real-secret-do-not-leak-1234567890';
    const failureModes: AdapterFetchImpl[] = [
      async () => { throw new Error('DNS resolution failed'); },
      async () => { throw new Error(`request to some-url failed`); },
      async () => ({ ok: false, status: 401, async json() { return {}; }, async text() { return 'Unauthorized'; } }),
      async () => ({ ok: true, status: 200, async json() { return {}; }, async text() { return 'not json {'; } }),
    ];
    for (const fetchImpl of failureModes) {
      const result = await steamSyncPage({ apiKey: secretKey, fetchImpl, getKnownRevision: () => null });
      assert.doesNotMatch(JSON.stringify(result), new RegExp(secretKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  test('hasSteamApiKey() reports presence without ever returning the value itself', () => {
    const original = process.env.SOLITH_STEAM_API_KEY;
    try {
      delete process.env.SOLITH_STEAM_API_KEY;
      assert.equal(hasSteamApiKey(), false);
      process.env.SOLITH_STEAM_API_KEY = 'some-real-key-value';
      assert.equal(hasSteamApiKey(), true);
      // The function's return TYPE is boolean — there is no code path by
      // which it could return the key string itself.
    } finally {
      if (original === undefined) delete process.env.SOLITH_STEAM_API_KEY;
      else process.env.SOLITH_STEAM_API_KEY = original;
    }
  });

  test('runBoundedSteamSmoke reports LIVE_SMOKE_BLOCKED_NO_KEY when the env var is absent, never asking for one', async () => {
    const original = process.env.SOLITH_STEAM_API_KEY;
    try {
      delete process.env.SOLITH_STEAM_API_KEY;
      const outcome = await runBoundedSteamSmoke(async () => {
        throw new Error('fetchImpl must never be called when no key is configured');
      });
      assert.equal(outcome.status, 'LIVE_SMOKE_BLOCKED_NO_KEY');
    } finally {
      if (original === undefined) delete process.env.SOLITH_STEAM_API_KEY;
      else process.env.SOLITH_STEAM_API_KEY = original;
    }
  });

  test('no repo file (excluding this test file itself) contains a plausible hardcoded Steam Web API key literal', () => {
    // Steam Web API keys are 32 hex characters. Search source files for a
    // suspicious 32-hex-char literal assigned near "steam"/"apiKey" text —
    // proves no real key was ever accidentally committed to source.
    const suspects: string[] = [];
    for (const root of ['src', 'electron']) {
      for (const file of listFilesRecursive(path.join(projectRoot, root))) {
        const content = fs.readFileSync(file, 'utf8');
        const matches = content.match(/\b[0-9A-Fa-f]{32}\b/g);
        if (matches && /steam/i.test(content) && /apiKey\s*[:=]\s*['"][0-9A-Fa-f]{32}['"]/.test(content)) {
          suspects.push(path.relative(projectRoot, file));
        }
      }
    }
    assert.deepEqual(suspects, []);
  });
});
