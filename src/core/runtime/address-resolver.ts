import type { RegistryAobSignature } from '../registry/compile-ct-registry.js';
import { findModule, type RuntimeModuleInfo } from './module-inspection.js';

export function resolveSignatureModule(signature: RegistryAobSignature, modules: RuntimeModuleInfo[]): RuntimeModuleInfo | null {
  if (!signature.module) return null;
  return findModule(modules, signature.module);
}
