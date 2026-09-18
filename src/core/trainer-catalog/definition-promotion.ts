import type { CertificationLevel } from '../definitions/schema.v1.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { getDefinitionFeedbackSummary } from './definition-feedback-store.js';
import { getCatalogEntry, upsertCatalogEntry } from './store.js';
import type { ModPackSourceProvider } from './types.js';
import { getCanonicalTrainerDefinition, persistTrainerDefinition } from '../trainer-storage/index.js';

const MIN_COMMUNITY_POSITIVE_FOR_PROMOTION = 3;

export interface PromotionEligibility {
  eligible: boolean;
  reasons: string[];
}

/** Evaluate whether a community definition may be promoted to verified (offline rules). */
export function evaluatePromotionEligibility(
  definition: SolithDefinitionV1,
  options: { minCertificationLevel?: CertificationLevel } = {},
): PromotionEligibility {
  const reasons: string[] = [];
  const minLevel = options.minCertificationLevel ?? 'L3';

  if (definition.safety.verificationStatus === 'verified') {
    return { eligible: false, reasons: ['already_verified'] };
  }

  const memoryFeatures = definition.memoryFeatures ?? [];
  if (memoryFeatures.length === 0 && !definition.saveEditor?.saveFields.length) {
    reasons.push('no_executable_features');
  }

  for (const feature of memoryFeatures) {
    const level = feature.certificationLevel ?? 'L0';
    if (compareCertLevel(level, minLevel) < 0) {
      reasons.push(`feature_${feature.id}_below_${minLevel}`);
    }
    const hasStaticPath =
      Boolean(feature.resolution.baseOffset) ||
      Boolean(feature.resolution.signature) ||
      (feature.resolution.pointerChain?.length ?? 0) > 0;
    if (feature.type !== 'scan_unknown' && feature.type !== 'scan_first' && !hasStaticPath) {
      reasons.push(`feature_${feature.id}_missing_resolution`);
    }
  }

  const feedback = getDefinitionFeedbackSummary(definition.id);
  if (feedback.positive < MIN_COMMUNITY_POSITIVE_FOR_PROMOTION) {
    reasons.push(`community_feedback_${feedback.positive}_of_${MIN_COMMUNITY_POSITIVE_FOR_PROMOTION}`);
  }

  return { eligible: reasons.length === 0, reasons };
}

const LEVEL_ORDER: CertificationLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4'];

function compareCertLevel(a: CertificationLevel, b: CertificationLevel): number {
  return LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b);
}

/**
 * Promotes a definition to 'verified'. P4-9: previously wrote directly via
 * `upsertDefinitionPayload` with a hardcoded `${id}-pack` packId and a
 * `sourceProvider: 'promotion'` that is not a real `ModPackSourceProvider`
 * (unranked by source-priority.ts, so it could silently lose every future
 * conflict-resolution read) — and would create a SEPARATE row instead of
 * updating the actual source row when the canonical definition came from
 * anywhere other than the original bundled convention. This now re-reads the
 * canonical winning row's own source, so the promoted payload lands back on
 * that same row (same packId, real sourceProvider) via the repository's
 * validate -> transaction -> verify-readback write path.
 */
export function promoteDefinitionToVerified(definition: SolithDefinitionV1): SolithDefinitionV1 {
  const eligibility = evaluatePromotionEligibility(definition);
  if (!eligibility.eligible) {
    throw new Error(`promotion_blocked: ${eligibility.reasons.join(',')}`);
  }

  const promoted: SolithDefinitionV1 = {
    ...definition,
    safety: { ...definition.safety, verificationStatus: 'verified' },
  };

  const canonical = getCanonicalTrainerDefinition(definition.id);
  const sourceProvider = canonical.success ? canonical.value.provenance.sourceProvider : 'user';
  const sourceId = canonical.success ? canonical.value.provenance.sourceId : null;

  const persisted = persistTrainerDefinition(promoted, {
    sourceProvider: sourceProvider as ModPackSourceProvider,
    sourceId,
  });
  if (persisted.success === false) {
    throw new Error(`promotion_write_failed: ${persisted.error.message}`);
  }

  const entry = getCatalogEntry(definition.id);
  if (entry) {
    upsertCatalogEntry({ ...entry, verificationStatus: 'verified', modPackId: persisted.value.packId });
  }

  return promoted;
}
