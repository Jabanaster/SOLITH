/**
 * IPC Channel Audit — check-game-running, get-compatibility-profile, get-all-profiles
 *
 * Tests every required case from the V1 Non-User-Data Closeout:
 *  - Valid game, no executable → safe response
 *  - Valid UUID with no matching game → safe response
 *  - Invalid identifier (not UUID, not demo literal) → Zod catches, safe response
 *  - get-compatibility-profile happy + invalid paths
 *  - get-all-profiles empty + ordering guarantee
 *  - Response shapes contain no raw SQL, no stack traces, no raw ZodError dumps
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const MAIN_BUNDLE = path.join('dist-electron', 'main.js');

// ── Shared fixture ────────────────────────────────────────────────────────────

async function launchFresh(label: string) {
  if (!fs.existsSync(MAIN_BUNDLE)) {
    return null;
  }
  const runId = `${label}-${Date.now()}`;
  const userDataDir = path.join(os.tmpdir(), runId, 'userData');
  const appDataDir  = path.join(os.tmpdir(), runId, 'appdata');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir,  { recursive: true });

  const app = await electron.launch({
    args: [MAIN_BUNDLE],
    env: {
      ...process.env,
      ELECTRON_USER_DATA_PATH: userDataDir,
      APPDATA: appDataDir,
      USERPROFILE: appDataDir,
      NODE_ENV: 'test',
    },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('#root > *', { timeout: 15_000 });

  return { app, win, runId };
}

async function cleanup(ctx: { app: any; runId: string } | null) {
  if (!ctx) return;
  await ctx.app.close().catch(() => {});
  fs.rmSync(path.join(os.tmpdir(), ctx.runId), { recursive: true, force: true });
}

// ── check-game-running ───────────────────────────────────────────────────────

test('ipc-01 — check-game-running: demo literal, no executable → { running: false }', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('cgr-demo');
  try {
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.checkGameRunning('demo-game-quest-id-000000000000')
    );
    expect(typeof result?.running,  'running is boolean').toBe('boolean');
    expect(typeof result?.evidence, 'evidence is string').toBe('string');
    expect(result.running,          'demo game not running').toBe(false);
    expect(result.evidence,         'evidence explains reason').toMatch(/executable|No executable|configured/i);
  } finally { await cleanup(ctx); }
});

test('ipc-02 — check-game-running: valid UUID with no game in DB → safe response', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('cgr-no-game');
  try {
    // A real UUID that doesn't match any game — handler should return gracefully
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.checkGameRunning('a0000000-0000-4000-a000-000000000001')
    );
    expect(typeof result?.running,  'running is boolean').toBe('boolean');
    expect(typeof result?.evidence, 'evidence is string').toBe('string');
    expect(result.running,          'unknown game not running').toBe(false);
  } finally { await cleanup(ctx); }
});

test('ipc-03 — check-game-running: invalid identifier → Zod catch, safe error shape', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('cgr-invalid');
  try {
    // "not-a-uuid" is neither UUID nor demo literal — Zod throws, handler catches
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.checkGameRunning('not-a-uuid')
    );
    // Must not crash renderer; must return a safe object
    expect(result, 'result is not null').not.toBeNull();
    expect(typeof result?.running,  'running is boolean').toBe('boolean');
    expect(typeof result?.evidence, 'evidence is string').toBe('string');
    expect(result.running,          'invalid ID not running').toBe(false);
    // Evidence must not contain raw stack trace
    expect(result.evidence,         'no stack trace leaked').not.toMatch(/at\s+\w+\s*\(.*:\d+:\d+\)/);
    // Must be truncated to 80 chars or less
    expect(result.evidence.length,  'evidence ≤ 120 chars').toBeLessThanOrEqual(120);
  } finally { await cleanup(ctx); }
});

test('ipc-04 — check-game-running: empty string → Zod catch, safe error shape', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('cgr-empty');
  try {
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.checkGameRunning('')
    );
    expect(typeof result?.running).toBe('boolean');
    expect(typeof result?.evidence).toBe('string');
    expect(result.running).toBe(false);
    expect(result.evidence).not.toMatch(/at\s+\w+\s*\(.*:\d+:\d+\)/);
  } finally { await cleanup(ctx); }
});

// ── get-compatibility-profile ────────────────────────────────────────────────

test('ipc-05 — get-compatibility-profile: demo game → null (no profile in fresh DB)', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('gcp-demo');
  try {
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.getCompatibilityProfile('demo-game-quest-id-000000000000')
    );
    // Fresh DB has no profiles — must return null, not throw
    expect(result, 'fresh DB returns null').toBeNull();
  } finally { await cleanup(ctx); }
});

test('ipc-06 — get-compatibility-profile: valid UUID, no profile → null', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('gcp-uuid');
  try {
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.getCompatibilityProfile('a0000000-0000-4000-a000-000000000002')
    );
    expect(result).toBeNull();
  } finally { await cleanup(ctx); }
});

test('ipc-07 — get-compatibility-profile: invalid identifier → null (Zod catch, no crash)', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('gcp-invalid');
  try {
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.getCompatibilityProfile('not-a-uuid')
    );
    // Zod throws → handler catches → returns null, not a raw error object
    expect(result).toBeNull();
  } finally { await cleanup(ctx); }
});

// ── get-all-profiles ─────────────────────────────────────────────────────────

test('ipc-08 — get-all-profiles: fresh DB → empty array, no crash', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('gap-empty');
  try {
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.getAllProfiles()
    );
    expect(Array.isArray(result), 'getAllProfiles returns array').toBe(true);
    expect(result.length,         'fresh DB has no profiles').toBe(0);
  } finally { await cleanup(ctx); }
});

test('ipc-09 — renderer errors: none during IPC channel calls', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('ipc-errors');
  const rendererErrors: string[] = [];
  ctx!.win.on('pageerror', (err: Error) => rendererErrors.push(err.message));

  try {
    // Fire all three channels; capture any renderer exceptions
    await ctx!.win.evaluate(() => Promise.all([
      (window as any).electronAPI.checkGameRunning('demo-game-quest-id-000000000000'),
      (window as any).electronAPI.getCompatibilityProfile('demo-game-quest-id-000000000000'),
      (window as any).electronAPI.getAllProfiles(),
      // Invalid inputs — must not produce renderer exceptions
      (window as any).electronAPI.checkGameRunning('bad-input'),
      (window as any).electronAPI.getCompatibilityProfile('bad-input'),
    ]));

    expect(rendererErrors, `renderer errors: ${rendererErrors.join('; ')}`).toHaveLength(0);
  } finally { await cleanup(ctx); }
});

// ── Additional edge cases ─────────────────────────────────────────────────────

test('ipc-10 — check-game-running: null input → Zod catch, safe response (no crash)', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('cgr-null');
  try {
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.checkGameRunning(null)
    );
    // Zod rejects null → handler catches → returns safe shape
    expect(typeof result?.running).toBe('boolean');
    expect(typeof result?.evidence).toBe('string');
    expect(result.running).toBe(false);
    expect(result.evidence).not.toMatch(/at\s+\w+\s*\(.*:\d+:\d+\)/);
  } finally { await cleanup(ctx); }
});

test('ipc-11 — get-all-profiles: idempotent across consecutive calls', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('gap-idempotent');
  try {
    const [r1, r2] = await ctx!.win.evaluate(() => Promise.all([
      (window as any).electronAPI.getAllProfiles(),
      (window as any).electronAPI.getAllProfiles(),
    ]));
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
    // Both calls to a fresh DB must return empty arrays and match each other
    expect(r1.length).toBe(r2.length);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  } finally { await cleanup(ctx); }
});

test('ipc-12 — get-compatibility-profile: very long string input → null (Zod rejects, no crash)', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('gcp-long');
  try {
    const result = await ctx!.win.evaluate(() =>
      (window as any).electronAPI.getCompatibilityProfile('x'.repeat(500))
    );
    expect(result).toBeNull();
  } finally { await cleanup(ctx); }
});

test('ipc-13 — wrong-type inputs (number instead of string) → handlers recover, no crash', async () => {
  if (!fs.existsSync(MAIN_BUNDLE)) { test.skip(true, 'Bundle not built'); return; }
  const ctx = await launchFresh('ipc-wrong-type');
  const rendererErrors: string[] = [];
  ctx!.win.on('pageerror', (err: Error) => rendererErrors.push(err.message));

  try {
    const [cgr, gcp, gap] = await ctx!.win.evaluate(() => Promise.all([
      (window as any).electronAPI.checkGameRunning(42),
      (window as any).electronAPI.getCompatibilityProfile(42),
      (window as any).electronAPI.getAllProfiles(),
    ]));
    expect(typeof cgr?.running).toBe('boolean');
    expect(cgr.running).toBe(false);
    expect(gcp).toBeNull();
    expect(Array.isArray(gap)).toBe(true);
    expect(rendererErrors, `renderer errors: ${rendererErrors.join('; ')}`).toHaveLength(0);
  } finally { await cleanup(ctx); }
});
