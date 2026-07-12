import type { CertificationLevel } from '../definitions/schema.v1.js';
import type { SolithDefinitionV1 } from '../definitions/schema.v1.js';
import { getDefinitionFeedbackSummary } from './definition-feedback-store.js';
import { getCatalogEntry, upsertCatalogEntry, upsertDefinitionPayload } from './store.js';

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

export function promoteDefinitionToVerified(definition: SolithDefinitionV1): SolithDefinitionV1 {
  const eligibility = evaluatePromotionEligibility(definition);
  if (!eligibility.eligible) {
    throw new Error(`promotion_blocked: ${eligibility.reasons.join(',')}`);
  }

  const promoted: SolithDefinitionV1 = {
    ...definition,
    safety: { ...definition.safety, verificationStatus: 'verified' },
  };

  const payloadJson = JSON.stringify(promoted);
  upsertDefinitionPayload(
    `${definition.id}-pack`,
    definition.id,
    payloadJson,
    'verified',
    'promotion',
    new Date().toISOString(),
  );

  const entry = getCatalogEntry(definition.id);
  if (entry) {
    upsertCatalogEntry({ ...entry, verificationStatus: 'verified' });
  }

  return promoted;
}
