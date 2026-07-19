/**
 * Minimal sandboxed local scripting runtime (OFF by default — call explicitly).
 *
 * Hard constraints:
 * - No network sockets
 * - No child_process / process.kill
 * - No require() of Node builtins
 * - No inject / VirtualAlloc / WriteProcessMemory APIs exposed
 *
 * This is a scaffold for future Lua/Python trainers — today it evaluates a
 * restricted JavaScript expression/script via vm with a frozen allowlist.
 */

import vm from 'node:vm';

export interface SandboxRunOptions {
  /** Wall-clock timeout in ms (default 250). */
  timeoutMs?: number;
  /** Optional pure helper values (numbers/strings/plain objects only). */
  bindings?: Record<string, unknown>;
}

export interface SandboxRunResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

const FORBIDDEN_KEYS = new Set([
  'require',
  'process',
  'global',
  'globalThis',
  'Function',
  'eval',
  'WebAssembly',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedArrayBuffer',
  'Atomics',
  'Promise',
  'queueMicrotask',
  'child_process',
  'net',
  'http',
  'https',
  'dgram',
  'fs',
  'os',
  '__proto__',
  'prototype',
  'constructor',
]);

function assertSafeValue(value: unknown, location: string): void {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeValue(entry, `${location}[${index}]`));
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`Sandbox binding "${location}" must contain JSON-safe data only.`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Sandbox binding "${location}" must be a plain object.`);
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Sandbox binding key "${location}.${key}" is forbidden.`);
    }
    assertSafeValue(nested, `${location}.${key}`);
  }
}

function assertSafeBindings(bindings: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(bindings)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Sandbox binding "${key}" is forbidden.`);
    }
    assertSafeValue(value, key);
  }
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs == null) return 250;
  if (!Number.isFinite(timeoutMs)) return 250;
  return Math.max(1, Math.min(1_000, Math.floor(timeoutMs)));
}

/**
 * Run a local script string in a network-disabled, inject-free sandbox.
 * Does not touch game memory — memory ops stay on the RPM/WPM MemoryManager path.
 */
export function runLocalSandboxScript(source: string, options: SandboxRunOptions = {}): SandboxRunResult {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { ok: false, error: 'Script source is empty.' };
  }
  if (source.length > 64_000) {
    return { ok: false, error: 'Script source exceeds 64KB limit.' };
  }
  if (scriptLooksUnsafe(source)) {
    return { ok: false, error: 'Script references a forbidden network, process, or injection surface.' };
  }

  try {
    const bindings = options.bindings ?? {};
    assertSafeBindings(bindings);
    const timeout = clampTimeout(options.timeoutMs);

    // Do not inject host-realm constructors/functions: they can provide a
    // constructor.constructor escape around vm code-generation policy.
    const context = vm.createContext(Object.create(null), {
      name: 'solith-local-sandbox',
      codeGeneration: { strings: false, wasm: false },
    });

    // Materialize bindings inside the context from JSON and recursively freeze
    // them there, so no host prototypes cross the sandbox boundary.
    const serializedBindings = JSON.stringify(bindings);
    new vm.Script(
      `
      (() => {
        Object.defineProperty(globalThis, 'Promise', {
          value: undefined,
          writable: false,
          configurable: false,
        });
        Object.defineProperty(globalThis, 'queueMicrotask', {
          value: undefined,
          writable: false,
          configurable: false,
        });
        const deepFreeze = (value) => {
          if (value && typeof value === 'object') {
            for (const child of Object.values(value)) deepFreeze(child);
            Object.freeze(value);
          }
          return value;
        };
        const input = JSON.parse(${JSON.stringify(serializedBindings)});
        for (const [key, value] of Object.entries(input)) {
          Object.defineProperty(globalThis, key, {
            value: deepFreeze(value),
            writable: false,
            configurable: false,
            enumerable: true,
          });
        }
      })();
      `,
      { filename: 'local-sandbox-bootstrap.js' },
    ).runInContext(context, { timeout });

    const script = new vm.Script(source, { filename: 'local-sandbox.js' });
    const value = script.runInContext(context, {
      timeout,
      displayErrors: true,
      breakOnSigint: true,
    });

    if (
      value == null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      return { ok: true, value };
    }

    // Clone compound results through the context's JSON implementation.
    Object.defineProperty(context, '__solithResult', {
      value,
      writable: false,
      configurable: true,
    });
    const serializedResult = new vm.Script(
      'JSON.stringify(__solithResult)',
      { filename: 'local-sandbox-result.js' },
    ).runInContext(context, { timeout }) as string | undefined;
    return {
      ok: true,
      value: serializedResult === undefined ? undefined : JSON.parse(serializedResult),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** True when a script text looks like it tries to touch forbidden surfaces. */
export function scriptLooksUnsafe(source: string): boolean {
  return /\b(require|process|fetch|WebSocket|Promise|queueMicrotask|async|await|child_process|net\.|http\.|https\.|WriteProcessMemory|VirtualAlloc|inject)\b/i.test(
    source,
  );
}
