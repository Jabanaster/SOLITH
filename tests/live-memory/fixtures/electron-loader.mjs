// Node module-customization-hooks loader (node:module `register()`) that
// redirects the bare specifier 'electron' to the local mock in
// electron-ipc-mock.mjs. Registered per-test-file via `module.register()`
// from `scanner-backend-ipc-real-path.test.ts` — never installed globally.
// Everything else falls through to the default resolver (chained loaders,
// tsx's own TS-loading hook included) unchanged.

const MOCK_URL = new URL('./electron-ipc-mock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: MOCK_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
