/**
 * Zero-Input prepare orchestration — plan → attach → SignatureEngine resolve.
 * Pure of Electron; IPC and tests call this with injected deps.
 */

import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import type { LiveMemorySession } from './live-memory-session.js';
import type { MemoryAuditLog } from './audit-log.js';
import {
  buildZeroInputAttachPlan,
  resolveDefinitionFeatures,
  type ProcessWatchDetection,
  type ResolvedFeatureAddress,
  type ZeroInputAttachPlan,
} from './process-watcher.js';
import type { OnlineGuardInput } from './types.js';
import type { FuzzyScanOptions } from './signature-engine.js';

export interface ZeroInputPrepareInput {
  detection: ProcessWatchDetection;
  definition: SolithDefinitionV1 | null;
  userConfirmedOffline: boolean;
  remoteConnections: OnlineGuardInput['remoteConnections'];
  executableHashSHA256?: string | null;
  driftAcknowledged?: boolean;
  fuzzyOptions?: FuzzyScanOptions;
}

export interface SerializedResolvedFeature {
  featureId: string;
  address: string;
  resolution: ResolvedFeatureAddress['resolution'];
  signatureDistance?: number;
  error?: string;
}

export interface ZeroInputPrepareResult {
  success: boolean;
  plan: ZeroInputAttachPlan;
  features?: SerializedResolvedFeature[];
  counts?: {
    resolved: number;
    failed: number;
    scanRequired: number;
  };
  error?: string;
  attachError?: string;
  fingerprintWarning?: string;
}

function serializeFeature(f: ResolvedFeatureAddress): SerializedResolvedFeature {
  return {
    featureId: f.featureId,
    address: `0x${f.address.toString(16)}`,
    resolution: f.resolution,
    signatureDistance: f.signatureDistance,
    error: f.error,
  };
}

function countFeatures(features: ResolvedFeatureAddress[]) {
  let resolved = 0;
  let failed = 0;
  let scanRequired = 0;
  for (const f of features) {
    if (f.resolution === 'failed') {
      if (f.error?.includes('Discovery Lab')) scanRequired += 1;
      else failed += 1;
    } else {
      resolved += 1;
    }
  }
  return { resolved, failed, scanRequired };
}

/**
 * Build attach plan only (used by catalog watch with offlineConfirm=false).
 */
export function planZeroInputDetection(input: Omit<ZeroInputPrepareInput, 'fuzzyOptions'>): ZeroInputAttachPlan {
  return buildZeroInputAttachPlan({
    detection: input.detection,
    definition: input.definition,
    executableHashSHA256: input.executableHashSHA256,
    userConfirmedOffline: input.userConfirmedOffline,
    remoteConnections: input.remoteConnections,
    driftAcknowledged: input.driftAcknowledged,
  });
}

/**
 * Plan → attach → resolve all definition memory features into the session cache.
 * Does not write cheat values.
 */
export async function prepareZeroInputSession(
  session: LiveMemorySession,
  input: ZeroInputPrepareInput,
  audit?: MemoryAuditLog,
): Promise<ZeroInputPrepareResult> {
  const plan = planZeroInputDetection(input);

  if (!plan.allowed || !plan.definition) {
    audit?.append({
      op: 'abort',
      reason: plan.blockReason ?? 'plan_blocked',
      pid: input.detection.pid,
      executableName: input.detection.executable,
    });
    return {
      success: false,
      plan,
      error: plan.blockReason ?? 'Zero-Input plan blocked.',
    };
  }

  if (session.isAttached()) {
    return {
      success: false,
      plan,
      error: 'Session already attached. Detach before prepare.',
    };
  }

  const attach = await session.attach(
    {
      pid: input.detection.pid,
      executableName: input.detection.executable,
    },
    input.userConfirmedOffline,
    {
      executableHashSHA256: input.executableHashSHA256 ?? undefined,
      executableHashPrefixes: plan.definition.executableHashPrefixes,
      targetSHA256: plan.definition.targetSHA256,
      driftAcknowledged: input.driftAcknowledged,
      connectionBaseline: plan.definition.connectionBaseline,
      catalogGameId: input.detection.catalogGameId,
    },
  );

  if (!attach.success) {
    audit?.append({
      op: 'abort',
      reason: attach.error ?? 'attach_failed',
      pid: input.detection.pid,
      executableName: input.detection.executable,
    });
    return {
      success: false,
      plan,
      error: attach.error ?? 'Attach failed.',
      attachError: attach.error,
      fingerprintWarning: attach.fingerprintWarning,
    };
  }

  audit?.append({
    op: 'attach',
    reason: 'zero_input_prepare',
    pid: input.detection.pid,
    executableName: input.detection.executable,
  });

  const access = session.getMemoryAccessOrThrow();
  const features = plan.definition.memoryFeatures ?? [];
  const resolved = resolveDefinitionFeatures(
    access.driver,
    access.handle,
    features,
    session.getAddressCache(),
    input.fuzzyOptions,
  );

  for (const f of resolved) {
    audit?.append({
      op: 'resolve',
      featureId: f.featureId,
      address: f.resolution === 'failed' ? undefined : `0x${f.address.toString(16)}`,
      reason: f.resolution,
    });
  }

  const counts = countFeatures(resolved);
  return {
    success: true,
    plan,
    features: resolved.map(serializeFeature),
    counts,
    fingerprintWarning: attach.fingerprintWarning,
  };
}
