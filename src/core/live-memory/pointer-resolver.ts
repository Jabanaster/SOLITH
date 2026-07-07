import type { LiveProcessHandle, MemoryDriver } from './types.js';

/**
 * A restart-stable address descriptor: a loaded module's base address plus a
 * fixed offset chain through repeated pointer dereferences. Unlike a raw
 * absolute address (only valid for the current process instance — ASLR
 * randomizes the base load address every launch, and managed-runtime GCs can
 * move heap objects even within one session), this survives both, because
 * the OFFSET from a module's base to a static pointer slot is fixed for a
 * given game binary version.
 */
export interface LivePointerPath {
  moduleName: string;
  moduleOffset: number;
  /** Forward dereference order: applied in sequence, the last one lands on the final value address. */
  offsets: number[];
}

/**
 * Resolves a pointer path to a concrete address in the currently attached
 * process. Must be re-resolved on every attach (and, for anything long-
 * lived like a freeze, ideally re-resolved periodically) — the path is
 * stable across restarts, but the concrete address it resolves to is not.
 */
export function resolvePointerPath(driver: MemoryDriver, handle: LiveProcessHandle, path: LivePointerPath): bigint {
  const modules = driver.getModules(handle);
  const module = modules.find((m) => m.name.toLowerCase() === path.moduleName.toLowerCase());
  if (!module) {
    throw new Error(`Module "${path.moduleName}" is not currently loaded in the attached process.`);
  }

  let address = module.baseAddress + BigInt(path.moduleOffset);
  for (const offset of path.offsets) {
    const pointerValue = driver.readPointer(handle, address);
    address = pointerValue + BigInt(offset);
  }
  return address;
}
