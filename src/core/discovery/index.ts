import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ParsedSave, DiscoveryResult, ParsedNode, ParserDiagnostic } from '../../shared/types';
import { SAFE_KEYWORDS, RISKY_KEYWORDS, BLOCKED_KEYWORDS } from '../../shared/constants';
import { getAdapterForFile } from '../adapters/index';
import db from '../database/index';
import { generateId } from '../../shared/ids';
import { buildParsedDocument, buildParsedNode } from '../saves/normalization';

const MAX_DISCOVERY_COMPARE_BYTES = 8 * 1024 * 1024;

export interface DiscoveryReportFileEvidence {
  label: 'before' | 'after';
  fileName: string;
  sha256: string | null;
  sizeBytes: number | null;
}

export interface DiscoveryReportChange {
  path: string;
  confidence: number;
  reason: string;
}

export interface DiscoveryReport {
  comparedAt: string;
  files: DiscoveryReportFileEvidence[];
  changedPaths: DiscoveryReportChange[];
  unsupportedSections: string[];
}

export interface DiscoveryAdvisoryComparison {
  results: DiscoveryResult[];
  report: DiscoveryReport;
}

const NOISE_KEYS = [
  'timestamp', 'time', 'date', 'modified', 'created', 'updated', 'saved_at', 'utc',
  'save_count', 'savecount', 'autosave', 'checkpoint_count', 'session', 'session_id', 'sessionid',
  'playtime', 'play_time', 'run_time', 'elapsed', 'frame', 'tick', 'history', 'stats.total_',
  'statistics', 'analytics'
];

function diffNodes(
  nodeA: ParsedNode,
  nodeB: ParsedNode,
  adapterId: string,
  sourcePathA: string,
  sourcePathB: string
): DiscoveryResult[] {
  const diffs: DiscoveryResult[] = [];
  
  if (nodeA.valueType !== nodeB.valueType) {
    return diffs;
  }
  
  if (nodeA.valueType === 'object' || nodeA.valueType === 'array') {
    const childrenA = nodeA.children || [];
    const childrenB = nodeB.children || [];
    
    const keysA = childrenA.map(c => c.key || c.path);
    const keysB = childrenB.map(c => c.key || c.path);
    const allKeys = [...new Set([...keysA, ...keysB])].sort((a, b) => a.localeCompare(b));
    
    allKeys.forEach(key => {
      const childA = childrenA.find(c => (c.key || c.path) === key);
      const childB = childrenB.find(c => (c.key || c.path) === key);
      
      if (childA && childB) {
        diffs.push(...diffNodes(childA, childB, adapterId, sourcePathA, sourcePathB));
      }
    });
  } else {
    if (nodeA.value !== nodeB.value) {
      const isNoise = NOISE_KEYS.some(noise => nodeA.path.toLowerCase().includes(noise));
      
      let confidence = 50;
      if (nodeA.risk === 'safe') confidence = 70;
      else if (nodeA.risk === 'caution') confidence = 50;
      else if (nodeA.risk === 'risky') confidence = 30;
      else if (nodeA.risk === 'blocked') confidence = 0;

      diffs.push({
        path: nodeA.path,
        oldValue: nodeA.value,
        newValue: nodeB.value,
        confidence,
        description: generateDescription({ path: nodeA.path, oldValue: nodeA.value, newValue: nodeB.value, confidence, description: '' }),
        suggestedCategory: suggestCategory(nodeA.path),
        suggestedName: suggestName(nodeA.path),
        adapterId,
        sourceA: sourcePathA,
        sourceB: sourcePathB,
        valueType: nodeA.valueType,
        risk: nodeA.risk,
        noiseClassification: isNoise ? 'noise' : 'gameplay',
        evidence: nodeA.evidence.join(', '),
        explanation: `Modified from ${nodeA.value} to ${nodeB.value}.`
      });
    }
  }
  return diffs;
}

function isExistingLargeFile(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_DISCOVERY_COMPARE_BYTES;
  } catch {
    return true;
  }
}

function createFileEvidence(label: 'before' | 'after', filePath: string): DiscoveryReportFileEvidence {
  const fileName = path.basename(filePath);

  try {
    if (!fs.existsSync(filePath)) {
      return { label, fileName, sha256: null, sizeBytes: null };
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_DISCOVERY_COMPARE_BYTES) {
      return { label, fileName, sha256: null, sizeBytes: stats.size };
    }

    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    return { label, fileName, sha256, sizeBytes: stats.size };
  } catch {
    return { label, fileName, sha256: null, sizeBytes: null };
  }
}

function getDiscoveryReason(result: DiscoveryResult): string {
  return result.explanation || result.evidence || result.description || 'Changed value discovered.';
}

export function createDiscoveryReport(
  saveA: ParsedSave,
  saveB: ParsedSave,
  results: DiscoveryResult[],
  comparedAt: string = new Date().toISOString()
): DiscoveryReport {
  const unsupportedSections = [...new Set(results
    .filter(result => calculateScore(result) === 0 || result.risk === 'blocked')
    .map(result => result.path))]
    .sort((a, b) => a.localeCompare(b));

  const changedPaths = results
    .filter(result => result.risk !== 'blocked' && calculateScore(result) > 0)
    .map(result => ({
      path: result.path,
      confidence: calculateScore(result),
      reason: getDiscoveryReason(result)
    }))
    .sort((a, b) => {
      const byPath = a.path.localeCompare(b.path);
      if (byPath !== 0) return byPath;
      return a.reason.localeCompare(b.reason);
    });

  return {
    comparedAt,
    files: [
      createFileEvidence('before', saveA.path),
      createFileEvidence('after', saveB.path)
    ],
    changedPaths,
    unsupportedSections
  };
}

export function compareSavesWithReport(
  saveA: ParsedSave,
  saveB: ParsedSave,
  gameId?: string,
  knownOldValue?: any,
  knownNewValue?: any
): DiscoveryAdvisoryComparison {
  const rawResults = compareSavesInternal(saveA, saveB, gameId, knownOldValue, knownNewValue);
  return {
    results: rankDiscoveries(rawResults),
    report: createDiscoveryReport(saveA, saveB, rawResults),
  };
}

function compareSavesInternal(
  saveA: ParsedSave,
  saveB: ParsedSave,
  gameId?: string,
  knownOldValue?: any,
  knownNewValue?: any
): DiscoveryResult[] {
  let results: DiscoveryResult[] = [];

  if (isExistingLargeFile(saveA.path) || isExistingLargeFile(saveB.path)) {
    return [];
  }
  
  const adapterA = getAdapterForFile(saveA.path);
  const adapterB = getAdapterForFile(saveB.path);
  
  if (adapterA && adapterB && adapterA.id === adapterB.id) {
    try {
      if (saveA.format === 'json') {
        const cleanA = saveA.data;
        const cleanB = saveB.data;
        const docA = buildParsedDocument(adapterA.id, adapterA.version, saveA.path, 'json', cleanA);
        const docB = buildParsedDocument(adapterB.id, adapterB.version, saveB.path, 'json', cleanB);
        results = diffNodes(docA.root, docB.root, adapterA.id, saveA.path, saveB.path);
      } else {
        // Fallback for non-JSON or other formats
        const docA = { root: buildParsedNode('', undefined, 'SaveA', saveA.data) };
        const docB = { root: buildParsedNode('', undefined, 'SaveB', saveB.data) };
        results = diffNodes(docA.root, docB.root, adapterA.id, saveA.path, saveB.path);
      }
    } catch (e) {
      // Discovery remains advisory; fall through to generic comparison.
    }
  }

  // Fallback if results are still empty or adapter comparison was skipped
  if (results.length === 0) {
    if (saveA.format === 'binary' && saveB.format === 'binary') {
      const bufA = Buffer.from(saveA.data.rawBase64, 'base64');
      const bufB = Buffer.from(saveB.data.rawBase64, 'base64');
      
      const minLen = Math.min(bufA.length, bufB.length);
      let i = 0;
      
      while (i < minLen) {
        if (bufA[i] !== bufB[i]) {
          const startOffset = i;
          while (i < minLen && bufA[i] !== bufB[i] && (i - startOffset) < 4) {
            i++;
          }
          const length = i - startOffset;
          
          let valA = 0;
          let valB = 0;
          
          if (length === 1) {
            valA = bufA[startOffset];
            valB = bufB[startOffset];
          } else if (length === 2) {
            valA = bufA.readUInt16LE(startOffset);
            valB = bufB.readUInt16LE(startOffset);
          } else if (length === 4) {
            valA = bufA.readUInt32LE(startOffset);
            valB = bufB.readUInt32LE(startOffset);
          }
          
          results.push({
            path: `offset_0x${startOffset.toString(16).toUpperCase()}`,
            oldValue: valA,
            newValue: valB,
            confidence: 40,
            description: `Binary diff at offset 0x${startOffset.toString(16).toUpperCase()} (${length} bytes)`,
            suggestedCategory: 'DISCOVERY',
            suggestedName: `Value at Offset 0x${startOffset.toString(16).toUpperCase()}`,
            adapterId: 'binary-adapter',
            sourceA: saveA.path,
            sourceB: saveB.path,
            valueType: 'number',
            risk: 'caution',
            noiseClassification: 'gameplay',
            evidence: 'Contiguous byte difference in binary buffer',
            explanation: `Binary diff of ${length} bytes starting at offset 0x${startOffset.toString(16).toUpperCase()}.`
          });
        } else {
          i++;
        }
      }
      
      const stringsA: string[] = saveA.data.strings || [];
      const stringsB: string[] = saveB.data.strings || [];
      
      stringsB.forEach((strB, idx) => {
        if (!stringsA.includes(strB)) {
          const strA = stringsA[idx] || '';
          if (strA && strA !== strB) {
            results.push({
              path: `strings[${idx}]`,
              oldValue: strA,
              newValue: strB,
              confidence: 35,
              description: `Extracted string changed: "${strA}" -> "${strB}"`,
              suggestedCategory: 'DISCOVERY',
              suggestedName: `Extracted String [${idx}]`,
              adapterId: 'binary-adapter',
              sourceA: saveA.path,
              sourceB: saveB.path,
              valueType: 'string',
              risk: 'caution',
              noiseClassification: 'gameplay',
              evidence: 'Printable string mismatch in binary strings pool',
              explanation: `String pool value changed from "${strA}" to "${strB}".`
            });
          } else {
            results.push({
              path: `strings[${idx}]`,
              oldValue: undefined,
              newValue: strB,
              confidence: 30,
              description: `New extracted string: "${strB}"`,
              suggestedCategory: 'DISCOVERY',
              suggestedName: `New Extracted String [${idx}]`,
              adapterId: 'binary-adapter',
              sourceA: saveA.path,
              sourceB: saveB.path,
              valueType: 'string',
              risk: 'caution',
              noiseClassification: 'gameplay',
              evidence: 'New printable string found in binary strings pool',
              explanation: `New string pool entry added: "${strB}".`
            });
          }
        }
      });
    } else if (saveA.format === saveB.format) {
      // Generic JSON/Object comparison fallback
      const docA = { root: buildParsedNode('', undefined, 'SaveA', saveA.data) };
      const docB = { root: buildParsedNode('', undefined, 'SaveB', saveB.data) };
      results = diffNodes(docA.root, docB.root, 'generic-adapter', saveA.path, saveB.path);
    }
  }

  // 1. Repeated sessions check
  if (gameId) {
    try {
      const pastCandidates = db.prepare(`
        SELECT path, COUNT(*) as occurrenceCount 
        FROM discovery_candidates 
        WHERE sessionId IN (SELECT id FROM discovery_sessions WHERE gameId = ?)
        GROUP BY path
      `).all(gameId);
      
      const occurrences = new Map<string, number>();
      pastCandidates.forEach((row: any) => {
        occurrences.set(row.path, row.occurrenceCount);
      });

      results.forEach(res => {
        const count = occurrences.get(res.path) || 0;
        if (count > 0) {
          res.confidence = Math.min(100, res.confidence + 20);
          res.evidence = (res.evidence ? res.evidence + ', ' : '') + `Modified in ${count} past discovery sessions`;
        }
      });
    } catch (e) {
      console.error('Repeated session query failed:', e);
    }
  }

  // 2. Known-value guided check
  if (knownOldValue !== undefined && knownNewValue !== undefined) {
    results.forEach(res => {
      const matchOld = String(res.oldValue).trim() === String(knownOldValue).trim();
      const matchNew = String(res.newValue).trim() === String(knownNewValue).trim();
      
      if (matchOld && matchNew) {
        res.confidence = 98;
        res.evidence = (res.evidence ? res.evidence + ', ' : '') + 'Matches user-guided known values exactly';
      } else {
        res.confidence = Math.max(1, res.confidence - 30);
      }
    });
  }

  // 3. Save session & candidates to DB
  if (gameId && results.length > 0) {
    try {
      const sessionId = generateId();
      db.prepare(`
        INSERT INTO discovery_sessions (id, gameId, fileAPath, fileBPath)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, gameId, saveA.path, saveB.path);

      const insertCandidate = db.prepare(`
        INSERT INTO discovery_candidates (
          id, sessionId, path, oldValue, newValue, valueType, confidence, risk,
          noiseClassification, suggestedCategory, suggestedName, evidence, explanation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      results.forEach(res => {
        insertCandidate.run(
          generateId(),
          sessionId,
          res.path,
          res.oldValue !== undefined ? String(res.oldValue) : null,
          res.newValue !== undefined ? String(res.newValue) : null,
          res.valueType || typeof res.newValue,
          res.confidence,
          res.risk || 'safe',
          res.noiseClassification || 'gameplay',
          res.suggestedCategory || 'PLAYER',
          res.suggestedName || `Set ${res.path}`,
          res.evidence || '',
          res.explanation || ''
        );
      });
    } catch (e) {
      console.error('Failed to log discovery session:', e);
    }
  }

  return results;
}

export function compareSaves(
  saveA: ParsedSave,
  saveB: ParsedSave,
  gameId?: string,
  knownOldValue?: any,
  knownNewValue?: any
): DiscoveryResult[] {
  return rankDiscoveries(compareSavesInternal(saveA, saveB, gameId, knownOldValue, knownNewValue));
}

export function rankDiscoveries(results: DiscoveryResult[]): DiscoveryResult[] {
  const filtered = results.filter(r => {
    const score = calculateScore(r);
    return score > 0;
  });

  return filtered.sort((a, b) => {
    const aScore = calculateScore(a);
    const bScore = calculateScore(b);
    if (bScore !== aScore) return bScore - aScore;
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return String(a.sourceA || '').localeCompare(String(b.sourceA || ''));
  });
}

export function calculateScore(result: DiscoveryResult): number {
  let score = result.confidence;
  
  const pathParts = result.path.toLowerCase().split(/[.\[\]]/).filter(Boolean);
  const lowerPath = result.path.toLowerCase();
  const lowerOld = String(result.oldValue).toLowerCase();
  const lowerNew = String(result.newValue).toLowerCase();
  
  for (const block of BLOCKED_KEYWORDS) {
    if (lowerPath.includes(block) || lowerOld.includes(block) || lowerNew.includes(block)) {
      return 0;
    }
  }
  
  const blockPatterns = ['checksum', 'hash', 'signature', 'crc', 'token', 'auth', 'license'];
  for (const pattern of blockPatterns) {
    if (lowerPath.includes(pattern) || lowerOld.includes(pattern) || lowerNew.includes(pattern)) {
      return 0;
    }
  }

  if (result.oldValue !== undefined && result.newValue !== undefined) {
    score += 15;
  }

  let safeMatch = false;
  for (const keyword of SAFE_KEYWORDS) {
    if (lowerPath.includes(keyword) || lowerOld.includes(keyword) || lowerNew.includes(keyword)) {
      score += 25;
      safeMatch = true;
      break;
    }
  }
  
  for (const keyword of RISKY_KEYWORDS) {
    if (lowerPath.includes(keyword) || lowerOld.includes(keyword) || lowerNew.includes(keyword)) {
      score -= 30;
      break;
    }
  }

  const statMetadataKeys = ['history', 'stats', 'total', 'played', 'achievement', 'count', 'version', 'build'];
  for (const key of statMetadataKeys) {
    if (lowerPath.includes(key)) {
      score -= 20;
      break;
    }
  }

  const highConfidenceKeys = ['player', 'inventory', 'items', 'weapon', 'armor', 'ammo', 'gold', 'money', 'health', 'level', 'xp'];
  for (const key of highConfidenceKeys) {
    if (lowerPath.includes(key)) {
      score += 20;
      break;
    }
  }

  if (typeof result.oldValue === 'number' && typeof result.newValue === 'number') {
    score += 10;
  }

  const timestampAutosaveKeys = ['timestamp', 'session', 'autosave', 'utc', 'date'];
  for (const key of timestampAutosaveKeys) {
    if (lowerPath.includes(key)) {
      score -= 25;
      break;
    }
  }

  return Math.max(1, Math.min(score, 100));
}

export function generateDescription(result: DiscoveryResult): string {
  const lowerPath = result.path.toLowerCase();
  
  if (lowerPath.includes('health') || lowerPath.includes('hp')) {
    return 'Player Health modifier';
  }
  if (lowerPath.includes('money') || lowerPath.includes('gold') || lowerPath.includes('currency') || lowerPath.includes('coin')) {
    return 'In-game Currency';
  }
  if (lowerPath.includes('level') || lowerPath.includes('xp') || lowerPath.includes('experience')) {
    return 'Player Level/XP Progression';
  }
  if (lowerPath.includes('damage') || lowerPath.includes('defense') || lowerPath.includes('armor') || lowerPath.includes('stamina')) {
    return 'Combat attribute modifier';
  }
  if (lowerPath.includes('inventory') || lowerPath.includes('item') || lowerPath.includes('quantity')) {
    return 'Inventory item quantity';
  }
  
  return `Gameplay value modifier for ${result.path}`;
}

function suggestCategory(path: string): string {
  const lower = path.toLowerCase();
  if (lower.includes('health') || lower.includes('hp') || lower.includes('stamina') || lower.includes('mana')) {
    return 'PLAYER';
  }
  if (lower.includes('inventory') || lower.includes('item') || lower.includes('weapon') || lower.includes('ammo')) {
    return 'INVENTORY';
  }
  if (lower.includes('xp') || lower.includes('level') || lower.includes('experience') || lower.includes('gold') || lower.includes('money')) {
    return 'STATS';
  }
  if (lower.includes('unlock') || lower.includes('unlocked')) {
    return 'UNLOCKS';
  }
  return 'DISCOVERY';
}

function suggestName(path: string): string {
  const parts = path.split(/[.\[\]]/).filter(Boolean);
  const lastPart = parts[parts.length - 1] || 'Value';
  const formatted = lastPart.replace(/_/g, ' ')
                            .replace(/([A-Z])/g, ' $1')
                            .replace(/^./, str => str.toUpperCase())
                            .trim();
  return `Set ${formatted}`;
}
