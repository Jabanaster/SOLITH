/**
 * Phase 9 — score pointer-scan candidates (module roots preferred).
 * Does not run the scan itself — wrap session.pointerScan / scanForPointerPath results.
 */
import type { PointerPathCandidate } from '../pointer-scanner.js';

export type PointerConfidence = 'low' | 'medium' | 'high';

export interface ScoredPointerPath {
  moduleName: string;
  moduleOffset: string;
  offsets: number[];
  depth: number;
  score: number;
  moduleRoot: boolean;
}

export interface PointerCandidateReport {
  targetAddress: string;
  candidateCount: number;
  moduleRootOk: number;
  truncated?: boolean;
  bestPath: ScoredPointerPath | null;
  confidenceScore: PointerConfidence;
  ranked: ScoredPointerPath[];
}

/** Prefer main executable / UE shipping modules; DLLs alone are not "module root OK". */
function isModuleRootName(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith('.exe') || n.includes('shipping');
}

function scoreCandidate(c: PointerPathCandidate): ScoredPointerPath {
  const moduleRoot = isModuleRootName(c.moduleName);
  let score = 0;
  if (moduleRoot) score += 50;
  // Prefer shallower chains
  score += Math.max(0, 20 - c.depth * 4);
  score += Math.max(0, 16 - c.offsets.length * 3);
  // Prefer smaller first offsets (tight object fields)
  const first = c.offsets[0] ?? 0;
  if (first <= 0x200) score += 5;
  return {
    moduleName: c.moduleName,
    moduleOffset: `0x${c.moduleOffset.toString(16)}`,
    offsets: [...c.offsets],
    depth: c.depth,
    score,
    moduleRoot,
  };
}

export class PointerCandidateAnalyzer {
  analyze(
    targetAddress: string | bigint,
    discoveredPaths: PointerPathCandidate[],
    options: { truncated?: boolean } = {},
  ): PointerCandidateReport {
    const target =
      typeof targetAddress === 'bigint'
        ? `0x${targetAddress.toString(16)}`
        : targetAddress.trim().toLowerCase().startsWith('0x')
          ? targetAddress.trim().toLowerCase()
          : `0x${BigInt(targetAddress).toString(16)}`;

    if (!discoveredPaths || discoveredPaths.length === 0) {
      return {
        targetAddress: target,
        candidateCount: 0,
        moduleRootOk: 0,
        truncated: options.truncated,
        bestPath: null,
        confidenceScore: 'low',
        ranked: [],
      };
    }

    const ranked = discoveredPaths.map(scoreCandidate).sort((a, b) => b.score - a.score);
    const moduleRootOk = ranked.filter((r) => r.moduleRoot).length;
    const bestPath = ranked[0] ?? null;

    let confidenceScore: PointerConfidence = 'low';
    if (bestPath?.moduleRoot && bestPath.offsets.length <= 3 && bestPath.depth <= 3) {
      confidenceScore = 'high';
    } else if (bestPath?.moduleRoot) {
      confidenceScore = 'medium';
    }

    return {
      targetAddress: target,
      candidateCount: discoveredPaths.length,
      moduleRootOk,
      truncated: options.truncated,
      bestPath,
      confidenceScore,
      ranked: ranked.slice(0, 40),
    };
  }
}
