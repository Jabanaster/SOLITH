/**
 * Live trainer control shape used by LiveMemorySession.resolveControl.
 * Phase 4: capability authorship lives in schema.v1 memoryFeatures — this is
 * only the runtime view-model projected from definitions.
 */
import type { LivePointerPath } from './pointer-resolver.js';
import type { LiveValueType } from './types.js';

export interface LiveTrainerControl {
  id: string;
  executableName: string;
  label: string;
  description: string;
  dataType: LiveValueType;
  pointerPath: LivePointerPath;
  constraints?: { min?: number; max?: number };
  discoveredAt: string;
  evidence: string;
}
