import type { SafetyClassification, TrainerContentClassification } from './types.js';

/**
 * Content types that are always treated as arbitrary executable/script
 * content. Per the Phase 1 online-foundation prompt, these must NEVER
 * auto-pass automated checks — they always require manual review before any
 * community trust progression can occur.
 */
const NEVER_AUTO_PASS: readonly TrainerContentClassification[] = ['autoassembler', 'lua', 'other-script'];

const REASON_BY_TYPE: Record<TrainerContentClassification, string | null> = {
  'native-resolver': null,
  pointer: null,
  'module-offset': null,
  aob: null,
  'save-backed': null,
  'registry-backed': null,
  'file-backed': null,
  autoassembler: 'contains AutoAssembler script content, which can execute arbitrary assembly and must be manually reviewed',
  lua: 'contains Lua script content, which can execute arbitrary code and must be manually reviewed',
  'other-script': 'contains unclassified script content, which cannot be safely assumed non-executable and must be manually reviewed',
};

/**
 * Pure classification of an artifact's declared content types into a safety
 * verdict. Never automatically treats arbitrary executable/script content as
 * trusted — any of 'autoassembler' | 'lua' | 'other-script' forces
 * `requiresManualReview: true`, with a plain-text reason for each.
 */
export function classifyTrainerContentSafety(contentTypes: TrainerContentClassification[]): SafetyClassification {
  const reasons: string[] = [];
  for (const type of contentTypes) {
    const reason = REASON_BY_TYPE[type];
    if (reason) reasons.push(reason);
  }

  const requiresManualReview = contentTypes.some((type) => NEVER_AUTO_PASS.includes(type));

  return {
    contentTypes: [...contentTypes],
    requiresManualReview,
    reasons,
  };
}
