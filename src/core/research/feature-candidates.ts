import type { CompiledCtRegistry } from '../registry/load-registry.js';

export type FeatureCandidateConfidence = 'low' | 'medium' | 'high';
export type FeatureCandidateStatus = 'unreviewed' | 'reviewed' | 'rejected' | 'confirmed';

export interface FeatureCandidate {
  id: string;
  name: string;
  category: string;
  sourceEntryIds: string[];
  pointerIds: string[];
  aobSignatureIds: string[];
  confidence: FeatureCandidateConfidence;
  evidence: string[];
  status: FeatureCandidateStatus;
}

const FEATURE_KEYWORDS: Array<{ key: string; name: string; category: string; terms: string[] }> = [
  { key: 'health', name: 'Health', category: 'Player', terms: ['health', 'hp', 'damage', 'god'] },
  { key: 'stamina', name: 'Stamina', category: 'Player', terms: ['stamina', 'breath'] },
  { key: 'essence', name: 'Essence', category: 'Player', terms: ['essence', 'mana'] },
  { key: 'inventory', name: 'Inventory', category: 'Inventory', terms: ['inventory', 'invitem', 'item', 'ingredient'] },
  { key: 'currency', name: 'Currency', category: 'Currency', terms: ['currency', 'coin', 'gold', 'money'] },
  { key: 'carry-weight', name: 'Carry Weight', category: 'Inventory', terms: ['weight', 'carry'] },
  { key: 'experience', name: 'Experience', category: 'Progression', terms: ['xp', 'experience'] },
  { key: 'skill-points', name: 'Skill / Ability Points', category: 'Progression', terms: ['abilitypoints', 'skill', 'attribute'] },
  { key: 'movement', name: 'Movement', category: 'Player', terms: ['move', 'jump', 'sneak', 'speed'] },
  { key: 'cooldowns', name: 'Cooldowns', category: 'Combat', terms: ['cooldown'] },
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'candidate';
}

function hasTerm(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

export function deriveFeatureCandidates(registry: CompiledCtRegistry): FeatureCandidate[] {
  const candidates: FeatureCandidate[] = [];

  for (const feature of FEATURE_KEYWORDS) {
    const pointerMatches = registry.pointers.accepted.filter((pointer) =>
      feature.terms.some((term) => hasTerm(`${pointer.name} ${pointer.category}`, term)),
    );
    const aobMatches = registry.aobSignatures.filter((signature) =>
      feature.terms.some((term) =>
        hasTerm(`${signature.symbol} ${signature.sourceEntryDescription} ${signature.sourcePath}`, term),
      ),
    );
    const scriptMatches = registry.scripts.scripts.filter((script) =>
      feature.terms.some((term) => hasTerm(`${script.name} ${script.path}`, term)),
    );

    if (pointerMatches.length === 0 && aobMatches.length === 0 && scriptMatches.length === 0) continue;

    const sourceEntryIds = [
      ...new Set([
        ...aobMatches.map((signature) => signature.sourceEntryId).filter((id): id is string => Boolean(id)),
        ...scriptMatches.map((script, index) => `ct-script-${index}-${slug(script.path)}`),
      ]),
    ];
    const evidence = [
      ...pointerMatches.map((pointer) => `Pointer row matched "${pointer.name}".`),
      ...aobMatches.map((signature) => `AOB symbol/source matched "${signature.symbol}" from "${signature.sourceEntryDescription}".`),
      ...scriptMatches.map((script) => `Script entry matched "${script.name}".`),
    ];
    const confidence: FeatureCandidateConfidence =
      pointerMatches.length + aobMatches.length >= 2
        ? 'high'
        : aobMatches.length > 0 && scriptMatches.length > 0
          ? 'medium'
          : pointerMatches.length > 0 || aobMatches.length > 0
            ? 'medium'
            : 'low';

    candidates.push({
      id: `candidate-${feature.key}`,
      name: feature.name,
      category: feature.category,
      sourceEntryIds,
      pointerIds: pointerMatches.map((pointer) => pointer.id),
      aobSignatureIds: aobMatches.map((signature) => signature.id),
      confidence,
      evidence,
      status: 'unreviewed',
    });
  }

  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}
