export interface RuntimeModuleInfo {
  name: string;
  baseAddress: bigint;
  size: number;
  sha256?: string;
}

export function findModule(modules: RuntimeModuleInfo[], moduleName: string): RuntimeModuleInfo | null {
  return modules.find((module) => module.name.toLowerCase() === moduleName.toLowerCase()) ?? null;
}

export function assertModuleBounds(module: RuntimeModuleInfo, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > module.size) {
    throw new Error(`Read exceeds module bounds for ${module.name}.`);
  }
}
