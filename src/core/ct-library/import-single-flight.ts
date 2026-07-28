export interface CtImportSingleFlight {
  run<T>(action: () => Promise<T>): Promise<{ started: true; value: T } | { started: false }>;
}

export function createCtImportSingleFlight(): CtImportSingleFlight {
  let active = false;

  return {
    async run<T>(action: () => Promise<T>) {
      if (active) return { started: false };
      active = true;
      try {
        return { started: true, value: await action() };
      } finally {
        active = false;
      }
    },
  };
}
