import { spawn as nodeSpawn } from 'node:child_process';

export const MAX_OUTPUT_BYTES = 32 * 1024; // 32 KB
export const MAX_STDERR_BYTES = 4 * 1024;  // 4 KB — bounds memory for chatty stderr

// ── Minimal process interface ─────────────────────────────────────────────────

/**
 * Minimal interface matched by Node's ChildProcessWithoutNullStreams and by
 * FakeProcess in tests. Kept narrow intentionally — only what runCommand uses.
 */
export interface ChildProcessLike {
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): unknown };
  stderr: { on(event: 'data', cb: (chunk: Buffer) => void): unknown };
  on(event: 'close', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  kill(signal?: string): boolean;
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { shell: boolean; env: Record<string, string | undefined>; windowsHide: boolean },
) => ChildProcessLike;

// ── RunCommand function type ──────────────────────────────────────────────────

export type RunCommandFn = (
  cmd: string,
  args: string[],
  envOverlay: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<string>;

// ── Real spawn implementation ─────────────────────────────────────────────────

const realSpawn: SpawnFn = (cmd, args, opts) =>
  nodeSpawn(cmd, args, { ...opts, env: opts.env as NodeJS.ProcessEnv }) as unknown as ChildProcessLike;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a runCommand function bound to the provided spawn implementation.
 * Production code uses the default export (bound to the real OS spawn).
 * Tests create their own runner via makeCommandRunner(fakeSpawn) — no mutable
 * module state is touched, so tests are fully isolated even when run in the
 * same Node process.
 *
 * Guarantees exactly one settle (resolve/reject) per call regardless of the
 * order that close, error, timeout, and abort events arrive. The settle()
 * helper enforces this.
 *
 * On abort: SIGTERM is sent to the child; resolves as 'aborted'.
 * On timeout: SIGTERM is sent; rejects as 'timeout'.
 * On oversized stdout: SIGTERM is sent; rejects as 'output_size_exceeded'.
 * Stderr is capped at MAX_STDERR_BYTES to bound memory for chatty processes.
 *
 * NOTE: child.kill('SIGTERM') terminates only the direct child process.
 * Get-CimInstance and netstat/ss are single-process commands so this is
 * sufficient. Full process-tree termination would require platform-specific
 * APIs and is not implemented here.
 */
export function makeCommandRunner(spawnFn: SpawnFn = realSpawn): RunCommandFn {
  return function runCommand(
    cmd: string,
    args: string[],
    envOverlay: Record<string, string>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }

      const env: Record<string, string | undefined> = { ...process.env, ...envOverlay };
      // shell: false — executable and arguments are passed as separate values to
      // the OS, never concatenated into a shell command string.
      const child = spawnFn(cmd, args, { shell: false, env, windowsHide: true });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        settle(() => reject(new Error('timeout')));
      }, timeoutMs);

      const onAbort = (): void => {
        child.kill('SIGTERM');
        settle(() => reject(new Error('aborted')));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return;
        stdout += chunk.toString('utf8');
        if (stdout.length > MAX_OUTPUT_BYTES) {
          child.kill('SIGTERM');
          settle(() => reject(new Error('output_size_exceeded')));
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (stderr.length < MAX_STDERR_BYTES) {
          stderr += chunk.toString('utf8');
          if (stderr.length > MAX_STDERR_BYTES) {
            stderr = stderr.slice(0, MAX_STDERR_BYTES);
          }
        }
      });

      child.on('close', (code: number | null) => {
        settle(() => {
          if (code !== 0 && stderr.toLowerCase().includes('access')) {
            reject(new Error('permission_denied: ' + stderr.slice(0, 80)));
            return;
          }
          resolve(stdout);
        });
      });

      child.on('error', (err: Error) => {
        settle(() => reject(err));
      });
    });
  };
}

/**
 * Default runCommand instance bound to the real OS spawn.
 * Imported by process-observer and endpoint-observer.
 */
export const runCommand: RunCommandFn = makeCommandRunner();
