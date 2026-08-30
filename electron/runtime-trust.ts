import { app } from 'electron';

/**
 * MP-P0.1 (packaged-runtime boundary): the required invariant is that a
 * production installation can never be switched into a weaker development
 * trust model by environment variable or command-line argument.
 * `app.isPackaged` is Electron's own signal for "running from a real
 * packaged/installed app" (false when launched via the bare `electron`
 * binary with an explicit script path, which is how both `npm run dev` and
 * every Playwright `_electron.launch()` E2E test run today) — gating every
 * dev-only override on it means `--dev`/`SOLITH_DEV=1` have zero effect once
 * shipped, while leaving local dev and the existing E2E suites unaffected.
 */
export function isDevRuntime(): boolean {
  return !app.isPackaged && (process.argv.includes('--dev') || process.env.SOLITH_DEV === '1');
}

/** Same packaged-boundary rule as {@link isDevRuntime} — a packaged production install must never honor `--compat-test`. */
export function isCompatTestRuntime(): boolean {
  return !app.isPackaged && process.argv.includes('--compat-test');
}
