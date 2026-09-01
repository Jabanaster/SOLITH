/**
 * ROADMAP §4.2 cross-cutting rights-policy tests: the renderer/IPC boundary
 * cannot self-assert a persistable rights class, and the Settings UI copy
 * does not overclaim what is legally handled.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ArtworkCacheRefreshSchema } from '../electron/ipc-validation.ts';

const ROOT = path.resolve(import.meta.dirname ?? '.', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('renderer/IPC cannot self-assert an approved rights class', () => {
  test('ArtworkCacheRefreshSchema has no field for rights/license/provenance', () => {
    const shape = ArtworkCacheRefreshSchema.shape as Record<string, unknown>;
    assert.deepEqual(Object.keys(shape), ['catalogGameIds']);
  });

  test('a payload with an injected rightsClass/isLicensed field has it silently stripped, never honored', () => {
    const parsed = ArtworkCacheRefreshSchema.parse({
      catalogGameIds: ['stardew-valley'],
      rightsClass: 'solith-owned',
      isLicensed: true,
    }) as Record<string, unknown>;
    assert.equal('rightsClass' in parsed, false);
    assert.equal('isLicensed' in parsed, false);
  });
});

describe('artwork-cache-ipc.ts job builders never read a rights class from renderer input', () => {
  test('every ArtworkFetchJob this module constructs hardcodes its own rightsClass, not derived from payload', () => {
    const source = read('electron/artwork-cache-ipc.ts');
    // Both job-construction call sites must set rightsClass from trusted,
    // locally-computed values — never from `parsed.*` (the validated but
    // still renderer-originated payload).
    const jobPushSites = source.match(/rightsClass:\s*[^,}\n]+/g) ?? [];
    assert.ok(jobPushSites.length >= 2, 'expected at least 2 rightsClass assignment sites');
    for (const site of jobPushSites) {
      assert.ok(!/parsed\./.test(site), `rightsClass must never be sourced from the parsed IPC payload: "${site}"`);
    }
  });
});

describe('Settings UI copy does not overclaim legal handling', () => {
  test('ArtworkCacheSection does not claim blanket legal clearance for third-party artwork', () => {
    const source = read('src/app/pages/settings/sections/ArtworkCacheSection.tsx');
    for (const overclaim of ['copyright safe', 'legally cleared', 'fully licensed']) {
      assert.ok(!source.toLowerCase().includes(overclaim), `must not claim "${overclaim}"`);
    }
  });

  test('ArtworkCacheSection truthfully states third-party artwork is not persistently cached', () => {
    const source = read('src/app/pages/settings/sections/ArtworkCacheSection.tsx');
    assert.match(source, /not persisted/i);
    assert.match(source, /fallback/i);
  });
});
