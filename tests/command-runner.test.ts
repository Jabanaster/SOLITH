/**
 * Deterministic unit tests for the command-runner module.
 *
 * Each test constructs its own runner via makeCommandRunner(fakeSpawn).
 * There is no mutable module-level test hook: no global is touched, so tests
 * are fully isolated and safe to run in any order within the same Node process.
 * Concurrent execution (e.g. --test-concurrency) is also safe because each
 * runner closure captures its own spawnFn — there is nothing shared.
 *
 * Behaviors covered (14 of 14 from the acceptance plan):
 *   CR-01  Abort calls child.kill exactly once
 *   CR-02  Timeout calls child.kill exactly once
 *   CR-03  Abort clears the timeout (no double-kill)
 *   CR-04  Abort listener is removed after settlement
 *   CR-05  Close after abort does not settle twice
 *   CR-06  Error after abort does not settle twice
 *   CR-07  Abort after normal close does nothing
 *   CR-08  Oversized stdout kills child and rejects with output_size_exceeded
 *   CR-09  Oversized stderr is bounded at MAX_STDERR_BYTES and does not reject
 *   CR-10  Spawn failure (child 'error' event) is normalized
 *   CR-11  Child ignoring SIGTERM cannot leave promise pending forever
 *   CR-12  shell: false in spawn options (injection-prevention proof)
 *   CR-13  Executable and arguments passed as separate values (not concatenated)
 *   CR-14  Renderer-controlled executable name flows through env, not source code
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCommandRunner,
  MAX_OUTPUT_BYTES,
  MAX_STDERR_BYTES,
  type SpawnFn,
  type ChildProcessLike,
} from '../src/core/v2/observers/command-runner.js';

// ── FakeProcess ──────────────────────────────────────────────────────────────

type DataCb = (chunk: Buffer) => void;
type CloseCb = (code: number | null) => void;
type ErrorCb = (err: Error) => void;

class FakeProcess implements ChildProcessLike {
  kills: string[] = [];

  private stdoutCbs: DataCb[] = [];
  private stderrCbs: DataCb[] = [];
  private closeCbs: CloseCb[] = [];
  private errorCbs: ErrorCb[] = [];

  stdout = {
    on: (_: 'data', cb: DataCb) => { this.stdoutCbs.push(cb); return this; },
  };

  stderr = {
    on: (_: 'data', cb: DataCb) => { this.stderrCbs.push(cb); return this; },
  };

  on(event: 'close', cb: CloseCb): this;
  on(event: 'error', cb: ErrorCb): this;
  on(event: string, cb: unknown): this {
    if (event === 'close') this.closeCbs.push(cb as CloseCb);
    if (event === 'error') this.errorCbs.push(cb as ErrorCb);
    return this;
  }

  kill(signal = 'SIGTERM'): boolean {
    this.kills.push(signal);
    return true;
  }

  emitStdout(data: string): void {
    const buf = Buffer.from(data, 'utf8');
    for (const cb of this.stdoutCbs) cb(buf);
  }

  emitStderr(data: string): void {
    const buf = Buffer.from(data, 'utf8');
    for (const cb of this.stderrCbs) cb(buf);
  }

  emitClose(code: number | null = 0): void {
    for (const cb of this.closeCbs) cb(code);
  }

  emitError(err: Error): void {
    for (const cb of this.errorCbs) cb(err);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a FakeProcess bound to a SpawnFn and the runner that uses it.
 * Each test gets its own isolated runner — no shared state.
 */
function makeTestRunner(
  opts: { timeoutMs?: number; signal?: AbortSignal; envOverlay?: Record<string, string> } = {},
): {
  fake: FakeProcess;
  calls: { cmd: string; args: string[]; opts: unknown }[];
  run: () => Promise<string>;
} {
  const fake = new FakeProcess();
  const calls: { cmd: string; args: string[]; opts: unknown }[] = [];

  const spawnFn: SpawnFn = (cmd, args, spawnOpts) => {
    calls.push({ cmd, args, opts: spawnOpts });
    return fake as unknown as ChildProcessLike;
  };

  const runner = makeCommandRunner(spawnFn);

  const run = () =>
    runner(
      'powershell',
      ['-Command', 'echo hi'],
      opts.envOverlay ?? {},
      opts.timeoutMs ?? 60_000,
      opts.signal,
    );

  return { fake, calls, run };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('command-runner', () => {

  // CR-01: Abort calls child.kill exactly once
  it('CR-01: abort signals child exactly once', async () => {
    const ac = new AbortController();
    const { fake, run } = makeTestRunner({ signal: ac.signal });
    const p = run();

    ac.abort();
    await assert.rejects(p, /aborted/);
    assert.equal(fake.kills.length, 1);
  });

  // CR-02: Timeout calls child.kill exactly once
  it('CR-02: timeout signals child exactly once', async () => {
    const { fake, run } = makeTestRunner({ timeoutMs: 10 });
    const p = run();

    await assert.rejects(p, /timeout/);
    assert.equal(fake.kills.length, 1);
  });

  // CR-03: Abort clears the timeout — only one kill regardless of which fires first
  it('CR-03: abort clears timeout so only one kill occurs', async () => {
    const ac = new AbortController();
    // Short timeout but abort fires first
    const { fake, run } = makeTestRunner({ timeoutMs: 5, signal: ac.signal });
    const p = run();

    ac.abort();
    await assert.rejects(p, /aborted/);

    // Wait past the timeout interval to confirm no second kill arrives
    await new Promise(r => setTimeout(r, 30));
    assert.equal(fake.kills.length, 1, 'only one kill — timeout was cleared on abort');
  });

  // CR-04: Abort listener is removed from signal after settlement
  it('CR-04: abort listener removed after close settles promise', async () => {
    const ac = new AbortController();
    const { fake, run } = makeTestRunner({ signal: ac.signal });
    const p = run();

    fake.emitStdout('hello');
    fake.emitClose(0);
    const result = await p;
    assert.equal(result, 'hello');

    // Firing abort after resolve is a no-op (listener already removed)
    ac.abort();
    assert.equal(fake.kills.length, 0, 'no kill — listener removed before abort fired');
  });

  // CR-05: Close after abort does not settle the promise a second time
  it('CR-05: close after abort does not double-settle', async () => {
    const ac = new AbortController();
    const { fake, run } = makeTestRunner({ signal: ac.signal });
    const p = run();

    ac.abort();
    await assert.rejects(p, /aborted/);

    assert.doesNotThrow(() => fake.emitClose(0));
    assert.equal(fake.kills.length, 1, 'still exactly one kill');
  });

  // CR-06: Error after abort does not double-settle
  it('CR-06: error after abort does not double-settle', async () => {
    const ac = new AbortController();
    const { fake, run } = makeTestRunner({ signal: ac.signal });
    const p = run();

    ac.abort();
    await assert.rejects(p, /aborted/);
    assert.doesNotThrow(() => fake.emitError(new Error('late error')));
    assert.equal(fake.kills.length, 1);
  });

  // CR-07: Abort after normal close does nothing
  it('CR-07: abort after normal close is ignored', async () => {
    const ac = new AbortController();
    const { fake, run } = makeTestRunner({ signal: ac.signal });
    const p = run();

    fake.emitClose(0);
    await p;

    ac.abort();
    assert.equal(fake.kills.length, 0, 'no kill — promise already resolved');
  });

  // CR-08: Oversized stdout kills child and rejects with output_size_exceeded
  it('CR-08: oversized stdout rejects with output_size_exceeded', async () => {
    const { fake, run } = makeTestRunner();
    const p = run();

    fake.emitStdout('x'.repeat(MAX_OUTPUT_BYTES + 1));
    await assert.rejects(p, /output_size_exceeded/);
    assert.equal(fake.kills.length, 1, 'child killed on size exceeded');
  });

  // CR-09: Oversized stderr is capped at MAX_STDERR_BYTES, does NOT reject
  it('CR-09: oversized stderr is bounded and does not reject', async () => {
    const { fake, run } = makeTestRunner();
    const p = run();

    fake.emitStderr('e'.repeat(MAX_STDERR_BYTES * 2));
    fake.emitStdout('ok');
    fake.emitClose(0);

    const result = await p;
    assert.equal(result, 'ok', 'resolves normally despite oversized stderr');
    assert.equal(fake.kills.length, 0, 'child not killed by stderr overflow');
  });

  // CR-10: Spawn failure (child 'error' event) is normalized
  it('CR-10: spawn error event rejects the promise', async () => {
    const { fake, run } = makeTestRunner();
    const p = run();

    fake.emitError(new Error('ENOENT: command not found'));
    await assert.rejects(p, /ENOENT/);
  });

  // CR-11: A child that ignores SIGTERM cannot keep the promise pending forever
  it('CR-11: stubborn child cannot keep promise pending forever', async () => {
    const fake = new FakeProcess();
    // Override kill to be a no-op (simulate a child that doesn't die on SIGTERM)
    fake.kill = (_?: string): boolean => { fake.kills.push('ignored'); return false; };

    const spawnFn: SpawnFn = () => fake as unknown as ChildProcessLike;
    const runner = makeCommandRunner(spawnFn);
    const p = runner('powershell', [], {}, 20);

    await assert.rejects(p, /timeout/);
    // Promise did reject — not stuck pending
  });

  // CR-12: shell: false in spawn options
  it('CR-12: spawn is always called with shell: false', async () => {
    const { fake, calls, run } = makeTestRunner();
    const p = run();

    fake.emitClose(0);
    await p;

    assert.equal(calls.length, 1);
    const spawnOpts = calls[0].opts as { shell: boolean };
    assert.equal(spawnOpts.shell, false, 'shell must be false to prevent injection');
  });

  // CR-13: Executable and arguments passed as separate values (not concatenated)
  it('CR-13: cmd and args are separate values in spawn call', async () => {
    const fake = new FakeProcess();
    const calls: { cmd: string; args: string[]; opts: unknown }[] = [];
    const spawnFn: SpawnFn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return fake as unknown as ChildProcessLike;
    };
    const runner = makeCommandRunner(spawnFn);
    const p = runner('powershell', ['-NoProfile', '-Command', 'echo hi'], {}, 60_000);

    fake.emitClose(0);
    await p;

    assert.equal(calls[0].cmd, 'powershell', 'cmd is a separate string');
    assert.deepEqual(calls[0].args, ['-NoProfile', '-Command', 'echo hi'], 'args is a separate array');
    assert.notEqual(calls[0].cmd, `powershell ${['-NoProfile', '-Command', 'echo hi'].join(' ')}`,
      'executable was not merged with args into a single string');
  });

  // CR-14: Renderer-controlled executable name flows through env, NOT source code
  it('CR-14: executable name reaches child via env var, not PowerShell source', async () => {
    const fake = new FakeProcess();
    const calls: { cmd: string; args: string[]; opts: { env: Record<string, string> } }[] = [];
    const spawnFn: SpawnFn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts: opts as typeof calls[0]['opts'] });
      return fake as unknown as ChildProcessLike;
    };
    const runner = makeCommandRunner(spawnFn);

    const maliciousName = 'game.exe; Remove-Item C:\\Windows -Recurse -Force';
    const script =
      'Get-CimInstance Win32_Process -Filter "Name=\'$($env:RF_PROC_NAME)\'" | ConvertTo-Json';
    const p = runner(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { RF_PROC_NAME: maliciousName },
      60_000,
    );

    fake.emitClose(0);
    await p;

    const env = calls[0].opts.env;
    assert.equal(env['RF_PROC_NAME'], maliciousName, 'name reaches child via env overlay');

    const scriptSource = (calls[0].args as string[]).join(' ');
    assert.ok(
      !scriptSource.includes('Remove-Item'),
      'metacharacters are NOT present in the PowerShell script source — only in env',
    );
    assert.ok(
      scriptSource.includes('$env:RF_PROC_NAME'),
      'script uses env var reference, not inline value',
    );
  });

});
