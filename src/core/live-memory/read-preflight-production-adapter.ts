/**
 * Production ReadPreflightSessionProbe adapter — wires runReadPreflight()
 * (read-preflight.ts) to the REAL, existing memory engine. Does not
 * introduce any new memory-access primitive: every operation below
 * delegates to LiveMemorySession / resolvePointerPath, exactly the same
 * production code paths the freeze/write flow already uses.
 *
 * detach() is intentionally a no-op here: LiveMemorySession is a long-lived,
 * shared object (the app's single attach/detach lifecycle, driving freeze,
 * research tools, etc). A one-shot read must never tear down that session —
 * lifecycle ownership stays with whatever attached it (the UI's explicit
 * attach/detach actions), not with this probe. (Contrast with the test
 * fixture probe in tests/live-memory/read-preflight.test.ts, which owns a
 * throwaway fake session and DOES need to signal "done with this session".)
 */
import type { LiveMemorySession } from './live-memory-session.js';
import { resolvePointerPath } from './pointer-resolver.js';
import type { LiveValueType } from './types.js';
import type {
  ReadPreflightExpectedTarget,
  ReadPreflightProcessIdentity,
  ReadPreflightSessionProbe,
} from './read-preflight.js';

/**
 * Build a probe bound to one already-attached LiveMemorySession. Create a
 * fresh probe per read attempt (it holds no long-lived state beyond the
 * single module name resolved mid-preflight).
 */
export function createLiveMemorySessionProbe(session: LiveMemorySession): ReadPreflightSessionProbe {
  let resolvedModuleName: string | null = null;

  return {
    getProcessIdentity(): ReadPreflightProcessIdentity | null {
      if (!session.isAttached()) return null;
      const pid = session.getAttachedPid();
      const executableName = session.getAttachedExecutableName();
      if (pid === null || executableName === null) return null;
      return { pid, executableName };
    },

    verifyIdentityStillMatches(_expected: ReadPreflightExpectedTarget): boolean {
      // verifyAttachedProcessIdentity() returns null when identity is fine,
      // or a human-readable problem string (PID reuse, missing metadata,
      // drift) when it is not — see live-memory-session.ts.
      return session.verifyAttachedProcessIdentity() === null;
    },

    isModuleLoaded(moduleName: string): boolean {
      const access = session.getMemoryAccess();
      if (!access) return false;
      return access.driver.getModules(access.handle).some((m) => m.name.toLowerCase() === moduleName.toLowerCase());
    },

    resolveModuleBase(moduleName: string): bigint | null {
      const access = session.getMemoryAccess();
      if (!access) return null;
      const module = access.driver.getModules(access.handle).find((m) => m.name.toLowerCase() === moduleName.toLowerCase());
      if (!module) return null;
      resolvedModuleName = moduleName; // remembered for traversePointerChain, below
      return module.baseAddress;
    },

    traversePointerChain(moduleBase: bigint, baseOffset: bigint, pointerChain: number[]): bigint | null {
      const access = session.getMemoryAccess();
      if (!access || !resolvedModuleName) return null;
      try {
        // Delegates to the exact same resolvePointerPath used by
        // research:resolve-path today — no reimplemented traversal math.
        return resolvePointerPath(access.driver, access.handle, {
          moduleName: resolvedModuleName,
          moduleOffset: Number(baseOffset),
          offsets: pointerChain,
        });
      } catch {
        return null;
      }
    },

    readValue(address: bigint, dataType: string): { ok: true; value: number } | { ok: false; reason: string } {
      try {
        const value = session.readValue({ address, dataType: dataType as LiveValueType });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    detach(): void {
      // Deliberately inert — see module doc comment above.
    },
  };
}
