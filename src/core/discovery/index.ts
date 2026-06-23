import fs from 'fs';
import { ParsedSave, DiscoveryResult, ParsedNode, ParserDiagnostic } from '../../shared/types';
import { SAFE_KEYWORDS, RISKY_KEYWORDS, BLOCKED_KEYWORDS } from '../../shared/constants';
import { getAdapterForFile } from '../adapters/index';
import db from '../database/index';
import { generateId } from '../../shared/ids';
import { buildParsedDocument, buildParsedNode } from '../saves/normalization';

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
    const allKeys = [...new Set([...keysA, ...keysB])];
    
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

export function compareSaves(
  saveA: ParsedSave,
  saveB: ParsedSave,
  gameId?: string,
  knownOldValue?: any,
  knownNewValue?: any
): DiscoveryResult[] {
  let results: DiscoveryResult[] = [];
  
  const adapterA = getAdapterForFile(saveA.path);
  const adapterB = getAdapterForFile(saveB.path);
  
  if (adapterA && adapterB && adapterA.id === adapterB.id) {
    // Standard adapter-based normalized comparison
    // Synchronously parse and normalize if possible, or execute via promises
    // Wait, parseAndNormalize returns a Promise. Since compareSaves is currently synchronous,
    // let's do synchronous read using fs.readFileSync and the adapter parser logic
    try {
      // Create parsed doc synchronously for comparison
      const rawA = fs.readFileSync(saveA.path, 'utf-8');
      const rawB = fs.readFileSync(saveB.path, 'utf-8');
      
      // Let's resolve the promise synchronously since we're in the electron main process thread or tests
      // We can use a trick or simply implement the sync version
      // Let's call the parseAndNormalize method synchronously
      // Wait, we can construct the normalized tree on the fly using buildParsedDocument
      let parsedA: any = {};
      let parsedB: any = {};
      
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
      console.error('Adapter comparison failed, using fallback:', e);
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

  return rankDiscoveries(results);
}

export function rankDiscoveries(results: DiscoveryResult[]): DiscoveryResult[] {
  const filtered = results.filter(r => {
    const score = calculateScore(r);
    return score > 0;
  });

  return filtered.sort((a, b) => {
    const aScore = calculateScore(a);
    const bScore = calculateScore(b);
    return bScore - aScore;
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
