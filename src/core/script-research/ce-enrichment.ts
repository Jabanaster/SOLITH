import type { CtRawScriptCatalogEntry } from './types.js';

export interface AllocationRecord { name: string; size?: string; lineNumber: number }
export interface AssertionRecord { address: string; bytes: string; lineNumber: number }
export interface OffsetReference { expression: string; symbol?: string; offset: string; lineNumber: number }
export interface EnableDisableSummary { hasEnable: boolean; hasDisable: boolean; enableLine?: number; disableLine?: number; balanced: boolean }

export interface AobResearchRecord {
  scriptId: string;
  scriptName: string;
  allocations: AllocationRecord[];
  registeredSymbols: string[];
  unregisteredSymbols: string[];
  labels: string[];
  defines: Array<{ name: string; value: string; lineNumber: number }>;
  assertions: AssertionRecord[];
  readmem: Array<{ address: string; size: string; lineNumber: number }>;
  referencedOffsets: OffsetReference[];
  enableDisablePairing: EnableDisableSummary;
  warnings: string[];
}

function lineNumber(script: string, index: number): number {
  return script.slice(0, index).split(/\r?\n/).length;
}

function words(raw: string): string[] {
  return raw.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function scriptId(entry: CtRawScriptCatalogEntry, index: number): string {
  const slug = entry.path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `ct-script-${index}-${slug || `script-${index}`}`;
}

export function enrichCeScript(entry: CtRawScriptCatalogEntry, index = 0): AobResearchRecord {
  const script = entry.raw_script_content;
  const allocations: AllocationRecord[] = [];
  const assertions: AssertionRecord[] = [];
  const readmem: AobResearchRecord['readmem'] = [];
  const defines: AobResearchRecord['defines'] = [];
  const labels = new Set<string>();
  const registeredSymbols = new Set<string>();
  const unregisteredSymbols = new Set<string>();
  const referencedOffsets: OffsetReference[] = [];
  const warnings: string[] = [];

  for (const match of script.matchAll(/\balloc\s*\(\s*([^,\s)]+)\s*(?:,\s*([^)]+))?\)/gi)) {
    allocations.push({ name: match[1], size: match[2]?.trim(), lineNumber: lineNumber(script, match.index ?? 0) });
  }
  for (const match of script.matchAll(/\blabel\s*\(([^)]*)\)/gi)) {
    for (const label of words(match[1])) labels.add(label);
  }
  for (const match of script.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_.$@]*):/gm)) labels.add(match[1]);
  for (const match of script.matchAll(/\bdefine\s*\(\s*([^,\s]+)\s*,\s*([^)]+)\)/gi)) {
    defines.push({ name: match[1], value: match[2].trim(), lineNumber: lineNumber(script, match.index ?? 0) });
  }
  for (const match of script.matchAll(/\bregistersymbol\s*\(([^)]*)\)/gi)) {
    for (const symbol of words(match[1])) registeredSymbols.add(symbol);
  }
  for (const match of script.matchAll(/\bunregistersymbol\s*\(([^)]*)\)/gi)) {
    for (const symbol of words(match[1])) unregisteredSymbols.add(symbol);
  }
  for (const match of script.matchAll(/\bassert\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi)) {
    assertions.push({ address: match[1].trim(), bytes: match[2].trim(), lineNumber: lineNumber(script, match.index ?? 0) });
  }
  for (const match of script.matchAll(/\breadmem\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/gi)) {
    readmem.push({ address: match[1].trim(), size: match[2].trim(), lineNumber: lineNumber(script, match.index ?? 0) });
  }
  for (const match of script.matchAll(/\b([A-Za-z_][A-Za-z0-9_.$@]*)\s*\+\s*(0x[0-9A-Fa-f]+|[0-9A-Fa-f]{2,})/g)) {
    referencedOffsets.push({
      expression: match[0],
      symbol: match[1],
      offset: match[2],
      lineNumber: lineNumber(script, match.index ?? 0),
    });
  }

  const enableMatch = /\[ENABLE\]/i.exec(script);
  const disableMatch = /\[DISABLE\]/i.exec(script);
  const enableDisablePairing: EnableDisableSummary = {
    hasEnable: Boolean(enableMatch),
    hasDisable: Boolean(disableMatch),
    enableLine: enableMatch ? lineNumber(script, enableMatch.index) : undefined,
    disableLine: disableMatch ? lineNumber(script, disableMatch.index) : undefined,
    balanced: Boolean(enableMatch && disableMatch && enableMatch.index < disableMatch.index),
  };
  if (!enableDisablePairing.balanced) warnings.push('Script does not contain a balanced [ENABLE] before [DISABLE] pair.');

  const registered = [...registeredSymbols];
  const unregistered = [...unregisteredSymbols];
  for (const symbol of registered) {
    if (!unregisteredSymbols.has(symbol)) warnings.push(`Registered symbol "${symbol}" is not unregistered in the same script.`);
  }
  for (const symbol of unregistered) {
    if (!registeredSymbols.has(symbol)) warnings.push(`Unregistered symbol "${symbol}" was not registered in the same script.`);
  }

  return {
    scriptId: scriptId(entry, index),
    scriptName: entry.name,
    allocations,
    registeredSymbols: registered,
    unregisteredSymbols: unregistered,
    labels: [...labels],
    defines,
    assertions,
    readmem,
    referencedOffsets,
    enableDisablePairing,
    warnings,
  };
}

export function enrichCeScripts(entries: CtRawScriptCatalogEntry[]): AobResearchRecord[] {
  return entries.map((entry, index) => enrichCeScript(entry, index));
}
