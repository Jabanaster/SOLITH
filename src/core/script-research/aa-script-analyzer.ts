import type { AaScriptAnalysis, AobScanExtract, ScriptReplicationStrategy } from './types.js';

const AOBSCANMODULE_RE =
  /aobscanmodule\s*\(\s*(\w+)\s*,\s*([^,]+)\s*,\s*([^\r\n)]+)\)/gi;
const AOBSCAN_RE = /aobscan\s*\(\s*(\w+)\s*,\s*([^\r\n)]+)\)/gi;
const REGISTERSYMBOL_RE = /registersymbol\s*\(\s*([^)]+)\)/gi;
const ALLOC_RE = /alloc\s*\(\s*(\w+)\s*,/gi;
const RAW_AOB_COMMENT_RE = /\/\/\s*raw AOB:\s*([0-9a-fA-F ?]+)/i;
const MEMORY_OPERAND_RE =
  /(?:mov|cmp)\s+(?:qword|dword|word|byte)\s+ptr\s+\[(\w+)\+([0-9a-fA-Fx]+)\]/gi;

export function normalizeCeAobPattern(patternRaw: string): string {
  return patternRaw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((token) => {
      if (/^\?+$/.test(token)) return '?';
      if (/^[0-9a-fA-F]{2}$/i.test(token)) return token.toUpperCase();
      if (/^\?\?$/i.test(token)) return '?';
      return token;
    })
    .join(' ');
}

function resolveModule(moduleToken: string, defaultExecutable: string): string {
  const token = moduleToken.trim();
  if (token === '$process' || token === '$PROCESS') return defaultExecutable;
  return token.replace(/^"+|"+$/g, '');
}

function extractAobScans(script: string, defaultExecutable: string): AobScanExtract[] {
  const scans: AobScanExtract[] = [];
  const rawAobMatch = script.match(RAW_AOB_COMMENT_RE);
  const rawAobComment = rawAobMatch?.[1]?.trim();

  for (const match of script.matchAll(AOBSCANMODULE_RE)) {
    const symbol = match[1];
    const module = resolveModule(match[2], defaultExecutable);
    const patternRaw = match[3].trim();
    scans.push({
      symbol,
      module,
      patternRaw,
      patternSolith: normalizeCeAobPattern(patternRaw),
      rawAobComment,
    });
  }

  for (const match of script.matchAll(AOBSCAN_RE)) {
    const symbol = match[1];
    const patternRaw = match[2].trim();
    scans.push({
      symbol,
      module: defaultExecutable,
      patternRaw,
      patternSolith: normalizeCeAobPattern(patternRaw),
      rawAobComment,
    });
  }

  return scans;
}

function extractSymbols(script: string): string[] {
  const symbols = new Set<string>();
  for (const match of script.matchAll(REGISTERSYMBOL_RE)) {
    for (const part of match[1].split(/\s+/)) {
      const name = part.trim();
      if (name) symbols.add(name);
    }
  }
  return [...symbols];
}

function extractAllocs(script: string): string[] {
  const labels = new Set<string>();
  for (const match of script.matchAll(ALLOC_RE)) {
    labels.add(match[1]);
  }
  return [...labels];
}

function extractMemoryOperands(script: string): AaScriptAnalysis['memoryOperandHints'] {
  const hints: AaScriptAnalysis['memoryOperandHints'] = [];
  for (const match of script.matchAll(MEMORY_OPERAND_RE)) {
    const register = match[1];
    const offset = parseInt(match[2].replace(/^0x/i, ''), 16);
    if (!Number.isFinite(offset)) continue;
    const opLine = match[0].toLowerCase();
    const operation = opLine.startsWith('cmp') ? 'compare' : 'write';
    const size = opLine.includes('qword') ? 8 : opLine.includes('dword') ? 4 : opLine.includes('word') ? 2 : 1;
    hints.push({ register, offset, size, operation });
  }
  return hints;
}

function extractInjectionHints(script: string): string[] {
  const hints: string[] = [];
  if (/alloc\s*\(\s*newmem/i.test(script)) hints.push('Allocates code cave (newmem) — Solith does not inject.');
  if (/jmp\s+far/i.test(script)) hints.push('Redirects execution via jmp — replicate via memory value diff instead.');
  for (const line of script.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(mov|cmp)\s+/i.test(trimmed) && !trimmed.startsWith('//')) {
      hints.push(trimmed);
    }
  }
  return hints.slice(0, 12);
}

function inferReplicationStrategy(
  analysis: Pick<
    AaScriptAnalysis,
    'usesCodeInjection' | 'registeredSymbols' | 'aobScans' | 'memoryOperandHints'
  >,
): ScriptReplicationStrategy {
  if (analysis.memoryOperandHints.length > 0 && analysis.usesCodeInjection) return 'mixed';
  if (analysis.registeredSymbols.length > 0 && analysis.usesCodeInjection) return 'pointer_scan_symbol';
  if (analysis.memoryOperandHints.length > 0) return 'memory_diff';
  if (analysis.aobScans.length > 0) return 'aob_signature_locate';
  return 'memory_diff';
}

function buildWorkflowSteps(
  cheatName: string,
  strategy: ScriptReplicationStrategy,
  analysis: Pick<AaScriptAnalysis, 'registeredSymbols' | 'aobScans' | 'memoryOperandHints' | 'usesCodeInjection'>,
): string[] {
  const steps: string[] = [
    `Run "${cheatName}" script in Cheat Engine externally (Solith never executes AssemblerScript).`,
  ];

  if (analysis.usesCodeInjection) {
    steps.push('Treat the script as a behavioral reference — do not replicate hooks inside Solith.');
  }

  switch (strategy) {
    case 'memory_diff':
    case 'mixed':
      steps.push('Disable the cheat → capture Research Lab baseline snapshot (memory diff step 1).');
      steps.push('Enable the cheat → scan for changed values (memory diff step 2).');
      if (analysis.memoryOperandHints[0]) {
        const hint = analysis.memoryOperandHints[0];
        steps.push(
          `Script touches [${hint.register}+0x${hint.offset.toString(16)}] — prioritize candidates near that struct offset.`,
        );
      }
      steps.push('Label the winning address and export as freeze or write_once in schema.v1.');
      break;
    case 'pointer_scan_symbol':
      steps.push(`Enable script so CE registers symbols: ${analysis.registeredSymbols.slice(0, 4).join(', ')}.`);
      steps.push('Use memory diff to find the gameplay value, then pointer-scan for restart-stable paths.');
      steps.push('Import verified pointer path into schema.v1 (freeze/write_once).');
      break;
    case 'aob_signature_locate':
      steps.push('Use read-only AOB scan in Research Lab to locate the signature in the game module.');
      steps.push('Combine with memory diff — signature alone is not a playable cheat.');
      break;
    case 'ue_dumpspace_member':
      steps.push('Cross-reference UEDumper Dumpspace class members for matching field names/offsets.');
      break;
    default:
      break;
  }

  if (analysis.aobScans[0]) {
    steps.push(`Primary AOB (${analysis.aobScans[0].symbol}): ${analysis.aobScans[0].patternSolith}`);
  }

  return steps;
}

export function analyzeAaScript(
  cheatName: string,
  scriptText: string,
  defaultExecutable: string,
): AaScriptAnalysis | null {
  const script = scriptText.trim();
  if (!script) return null;

  const aobScans = extractAobScans(script, defaultExecutable);
  const registeredSymbols = extractSymbols(script);
  const allocLabels = extractAllocs(script);
  const memoryOperandHints = extractMemoryOperands(script);
  const usesCodeInjection = /alloc\s*\(\s*newmem/i.test(script) || /jmp\s+far/i.test(script);
  const injectionHints = extractInjectionHints(script);

  const replicationStrategy = inferReplicationStrategy({
    usesCodeInjection,
    registeredSymbols,
    aobScans,
    memoryOperandHints,
  });

  const workflowSteps = buildWorkflowSteps(cheatName, replicationStrategy, {
    registeredSymbols,
    aobScans,
    memoryOperandHints,
    usesCodeInjection,
  });

  return {
    cheatName,
    scriptBytes: script.length,
    aobScans,
    registeredSymbols,
    allocLabels,
    usesCodeInjection,
    injectionHints,
    memoryOperandHints,
    replicationStrategy,
    workflowSteps,
  };
}
