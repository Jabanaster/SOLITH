/**
 * TrainerHost entry point — standalone Node.js script spawned by Electron main.
 *
 * This file is the thin wrapper that wires host-runtime to the real
 * process.stdin / process.stdout / process.exit. It is the target of
 * child_process.spawn() calls from host-supervisor.
 *
 * Security:
 *   - No command-line argument interpolation.
 *   - Exits on stdin end/close (parent-loss guard in host-runtime).
 *   - shell: false is enforced by the supervisor at spawn time.
 */

import { startHostRuntime } from './host-runtime';

startHostRuntime({
  stdin: process.stdin as any,
  stdout: {
    write(data: string) {
      process.stdout.write(data);
    },
  },
  exit(code: number) {
    process.exit(code);
  },
});
